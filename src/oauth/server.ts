import express from "express";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { authorizationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/authorize.js";
import { tokenHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/token.js";
import { revocationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/revoke.js";
import { InvalidScopeError, InvalidTargetError, InvalidRequestError, TooManyRequestsError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpAuthorization } from "../mcp/authorization.js";
import {mcdMcp} from "../contracts/mcd-mcp.js";
import { OAuthStore } from "./store.js";
import { consentPage } from "./page.js";

export const oauthScope = mcdMcp.scope;
export const oauthClientId = mcdMcp.clientId;
const base = "/api/mcd/oauth";
export interface OwnerSession { ownerId: string; csrfToken: string }
export type SessionInspector = (cookie: string) => Promise<OwnerSession | undefined>;
type Pending = { client: string; name: string; params: AuthorizationParams; expires: number };
const random = () => randomBytes(32).toString("base64url");

export function createMcdOAuth(options: {root:string; publicOrigin:string; inspectSession:SessionInspector; ownerId:string; now?:()=>number}) {
  const now = options.now ?? Date.now;
  const origin = new URL(options.publicOrigin).origin;
  if (origin !== options.publicOrigin || !origin.startsWith("https://")) throw new Error("OAUTH_ORIGIN_INVALID");
  const resource=origin+mcdMcp.path, issuer=origin, mcdResource=resource;
  const metadataPath='/.well-known/oauth-protected-resource'+mcdMcp.path;
  if(!options.ownerId.trim()||options.ownerId.length>128)throw new Error('OAUTH_POLICY_INVALID');
  const store=new OAuthStore(options.root,resource,oauthScope,now);
  const clients=new Map<string,OAuthClientInformationFull>([[oauthClientId,{
    client_id:oauthClientId,client_name:'ChatGPT · 麦当劳点单（逐笔确认）',
    redirect_uris:['https://chatgpt.com/connector_platform_oauth_redirect'],token_endpoint_auth_method:'none',
    grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:oauthScope,
  }]]);
  const pending = new Map<string, Pending>();
  const redirectUrl = (entry: Pending, response: { code: string } | { error: string }) => {
    const url = new URL(entry.params.redirectUri);
    Object.entries(response).forEach(([key,value]) => url.searchParams.set(key,value));
    if (entry.params.state !== undefined) url.searchParams.set("state",entry.params.state);
    url.searchParams.set("iss",issuer); return url.href;
  };
  const provider: OAuthServerProvider = {
    clientsStore: { getClient: id => clients.get(id) },
    async authorize(client, params, response) {
      const target=resource;
      const requiredScope=oauthScope;
      if(params.resource?.href!==target)throw new InvalidTargetError("只允许独立麦当劳点单资源。");
      if(params.scopes?.length&&(params.scopes.length!==1||params.scopes[0]!==requiredScope))throw new InvalidScopeError("只允许麦当劳点单权限，逐笔提交仍需本人批准。");
      if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge) || (params.state?.length ?? 0) > 1024) throw new InvalidRequestError("授权参数无效。");
      for (const [key,value] of pending) if (value.expires <= now()) pending.delete(key);
      if (pending.size >= 100) throw new TooManyRequestsError("待确认连接过多，请稍后再试。");
      const key = random();
      pending.set(key, { client: client.client_id, name: client.client_name ?? "本站连接", params, expires: now()+600000 });
      response.redirect(303,origin+base+"/consent?request="+key);
    },
    async challengeForAuthorizationCode(client, code) { return store.code(client.client_id,code).challenge; },
    async exchangeAuthorizationCode(client, code, _verifier, redirect, target) { return store.exchange(client.client_id,code,redirect,target); },
    async exchangeRefreshToken(client, token, scopes, target) { return store.refresh(client.client_id,token,scopes,target); },
    async verifyAccessToken(token) { return store.verifyAny(token); },
    async revokeToken(client, request) { store.revoke(client.client_id,request.token); },
  };
  const mcdAuthorization={
    challenge: `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource${mcdMcp.path}", scope="${mcdMcp.scope}"`,
    securitySchemes:[{type:"oauth2" as const,scopes:[mcdMcp.scope]}],
    async authorize(header:string|undefined){store.verify(header?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1]??"",mcdResource);},
    async identify(header:string|undefined){return store.binding(header?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1]??"",mcdResource);},
    active:(binding:{ownerId:string;clientId:string;grantId:string;resource:string})=>store.grantActive(binding),
  };
  const oauth = express(); oauth.disable("x-powered-by"); oauth.set("trust proxy","loopback");
  oauth.use((_req,res,next) => {
    res.setHeader("Cache-Control","no-store");res.setHeader("Referrer-Policy","no-referrer");res.setHeader("X-Content-Type-Options","nosniff");
    // SDK的授权错误重定向同样携带iss，满足已声明的RFC9207回调识别。
    const original = res.redirect.bind(res);
    res.redirect = ((status: number | string, location?: string) => {
      const value = typeof status === "string" ? status : location!;
      const url = new URL(value,origin);
      if ([...clients.values()].some(client => client.redirect_uris.some(uri => { const known = new URL(uri); return known.origin===url.origin && known.pathname===url.pathname; }))) url.searchParams.set("iss",issuer);
      return original(typeof status === "number" ? status : 302,url.href);
    }) as typeof res.redirect;
    next();
  });
  oauth.use(express.urlencoded({ extended: false, limit: "8kb", parameterLimit: 16 }));
  oauth.use(base+"/token",(req,res,next) => {
    if (req.method === "POST" && req.body?.grant_type === "authorization_code" && !/^[A-Za-z0-9._~-]{43,128}$/.test(req.body?.code_verifier ?? "")) { res.status(400).json({ error: "invalid_grant" }); return; }
    next();
  });
  oauth.use(base+"/authorize",authorizationHandler({ provider }));
  oauth.use(base+"/token",tokenHandler({ provider }));
  oauth.use(base+"/revoke",revocationHandler({ provider }));
  oauth.use((_req,res) => { res.status(404).json({ error: "invalid_request" }); });
  oauth.use(((error: { status?: number },_req: unknown,res: express.Response,_next: unknown) => { res.status(error.status===413?413:400).json({ error: "invalid_request" }); }) as express.ErrorRequestHandler);

  function register(app: FastifyInstance) {
    app.register(async scope => {
      await scope.register(rateLimit,{max:60,timeWindow:60000});
      scope.addHook("onSend",async (_req,reply) => { reply.header("Referrer-Policy","no-referrer"); });
      scope.get("/.well-known/oauth-authorization-server",async () => ({
        issuer, authorization_endpoint: origin+base+"/authorize", token_endpoint: origin+base+"/token", revocation_endpoint: origin+base+"/revoke",
        response_types_supported: ["code"], grant_types_supported: ["authorization_code","refresh_token"],
        token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"], scopes_supported: [oauthScope], authorization_response_iss_parameter_supported: true,
      }));
      const metadata={resource,authorization_servers:[issuer],scopes_supported:[oauthScope],bearer_methods_supported:['header'],resource_name:'麦当劳点单（本人逐笔确认）'};
      scope.get(metadataPath,async()=>metadata);
      scope.get('/.well-known/oauth-protected-resource',async()=>metadata);
      for (const path of ["/authorize","/token","/revoke"]) scope.route({
        method: ["GET","POST","OPTIONS","HEAD"], url: base+path,
        async onRequest(request,reply) {
          reply.hijack();
          await new Promise<void>(resolve => {
            reply.raw.once("finish",resolve);reply.raw.once("close",resolve);
            oauth(request.raw,reply.raw);
          });
        },
        async handler() {},
      });
      scope.get<{ Querystring: { request?: string } }>(base+"/consent",async (request,reply) => {
        const entry = pending.get(request.query.request ?? "");
        if (!entry || entry.expires <= now()) return reply.code(400).send({ error: "authorization_expired" });
        const nonce = random();
        reply.header("Content-Security-Policy",`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
        return reply.type("text/html; charset=utf-8").send(consentPage(request.query.request!,entry.name,nonce));
      });
      const authenticateOwner = async (request: { headers: Record<string, unknown> }): Promise<OwnerSession | undefined> => {
        if (request.headers.origin !== origin) return undefined;
        const cookie = typeof request.headers.cookie === "string" ? request.headers.cookie : "";
        const session = await options.inspectSession(cookie);
        const supplied = request.headers["x-csrf-token"];
        if (!session || typeof supplied !== "string" || supplied.length>256) return undefined;
        const actual = Buffer.from(supplied),expected = Buffer.from(session.csrfToken);
        return actual.length===expected.length && timingSafeEqual(actual,expected) ? session : undefined;
      };
      scope.post<{ Body: { request?: string; decision?: string } }>(base+"/consent",{ bodyLimit:8192 },async (request,reply) => {
        const owner = await authenticateOwner(request);
        if (!owner) return reply.code(403).send({ error: "access_denied" });
        const key = request.body?.request ?? "",entry = pending.get(key);
        if (!entry || entry.expires <= now() || !["allow","deny"].includes(request.body?.decision ?? "")) return reply.code(400).send({ error:"invalid_request" });
        if(owner.ownerId!==options.ownerId)return reply.code(403).send({error:"access_denied"});
        pending.delete(key);
        const response = request.body.decision==="deny" ? { error:"access_denied" } : { code:store.issueCode({ client:entry.client,challenge:entry.params.codeChallenge,redirect:entry.params.redirectUri,resource:entry.params.resource!.href,owner:owner.ownerId }) };
        return { redirectUrl:redirectUrl(entry,response) };
      });
      scope.post(base+'/revoke-mcd-orders',{bodyLimit:8192},async(request,reply)=>{
        const owner=await authenticateOwner(request);
        if(!owner||owner.ownerId!==options.ownerId)return reply.code(403).send({error:'access_denied'});
        store.revokeResource(owner.ownerId,resource);return {status:'revoked'};
      });
    });
    app.addHook("onClose",async()=>store.close());
  }
  return {authorization:mcdAuthorization,register,store};
}
