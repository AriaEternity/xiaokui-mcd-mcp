// 沿用瑞幸v4的Streamable HTTP、OAuth、取消、JSON/SSE与超时处理。
import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import rateLimit from "@fastify/rate-limit";
import { mcdMcp } from "../../contracts/mcd-mcp.js";
type AppConfig = {publicOrigin:string};
import type { McpAuthorization } from "../../mcp/authorization.js";
import type { McdReader } from "../../mcp/mcd-policy.js";

export type McdMcpOptions={authorization:McpAuthorization;reader?:McdReader;responseMode?:"json"|"sse";readerForRequest?:(header:string|undefined)=>Promise<McdReader>};
const rpcError=(code:number,message:string,id:unknown=null)=>({jsonrpc:"2.0",id:typeof id==="number"||typeof id==="string"?id:null,error:{code,message}});
export function registerMcdMcp(app:FastifyInstance,config:AppConfig,options?:McdMcpOptions):void {
  if(!options) return;
  const profile=mcdMcp;
  app.register(async scope=>{
    const {parseMcdCall}=await import("../../mcp/mcd-policy.js");
    scope.addHook("onRequest",async(request,reply)=>{
      request.raw.socket?.setTimeout?.(28000);
      if(request.headers.origin!==undefined&&request.headers.origin!==config.publicOrigin) return reply.code(403).send(rpcError(-32000,"Origin 不被允许。"));
      try {await options.authorization.authorize(request.headers.authorization);}
      catch {return reply.header("WWW-Authenticate",options.authorization.challenge).code(401).send(rpcError(-32000,"麦当劳点单OAuth授权无效或已过期。"));}
      if(Object.keys(request.query as object).length) return reply.code(400).send(rpcError(-32600,"MCP 入口不接受查询参数。"));
      if(request.method!=="POST") return reply.header("Allow","POST").code(405).send(rpcError(-32000,"本入口仅接受 POST。"));
    });
    await scope.register(rateLimit,{max:60,timeWindow:60000,keyGenerator:()=>"mcd-orders-single-owner",
      errorResponseBuilder:()=>Object.assign(new Error("MCD_RATE_LIMITED"),{statusCode:429})});
    scope.setErrorHandler((error,_request,reply)=>{
      const status=typeof error==="object"&&error!==null&&"statusCode" in error?error.statusCode:500;
      if(status===413) return reply.code(413).send(rpcError(-32000,"MCP 请求过大。"));
      if(status===415) return reply.code(415).send(rpcError(-32000,"需要 application/json。"));
      if(status===400) return reply.code(400).send(rpcError(-32700,"JSON 解析失败。"));
      if(status===429) return reply.code(429).send(rpcError(-32000,"请求过于频繁。"));
      return reply.code(500).send(rpcError(-32603,"麦当劳 MCP 暂不可用。"));
    });
    const {createMcdMcpServer}=await import("../../mcp/mcd.js");
    const {WebStandardStreamableHTTPServerTransport}=await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
    scope.route({method:["POST","GET","DELETE","PUT","PATCH","OPTIONS","HEAD"],url:profile.path,bodyLimit:32768,
      async handler(request,reply) {
        if(!options.reader&&!options.readerForRequest) return reply.code(503).send(rpcError(-32000,"麦当劳查询能力未就绪。"));
        if(Array.isArray(request.body)) return reply.code(400).send(rpcError(-32600,"不支持批量 JSON-RPC。"));
        const body=request.body as {method?:unknown;params?:unknown;id?:unknown}|null;
        if(body&&typeof body==="object"&&body.method==="tools/call") {
          try {
            const params=body.params as {name?:unknown;arguments?:unknown}|null;
            parseMcdCall(params?.name,params?.arguments);
          }catch {return reply.code(200).send(rpcError(-32602,"仅允许麦当劳点餐工具及有效参数；创建只接受已批准intentId。",body.id));}
        }
        const abort=new AbortController();
        const reader=options.readerForRequest?await options.readerForRequest(request.headers.authorization):options.reader!;
        const server=createMcdMcpServer({call:(name,args,signal)=>reader.call(name,args,signal?AbortSignal.any([abort.signal,signal]):abort.signal)},options.authorization.securitySchemes);
        const transport=new WebStandardStreamableHTTPServerTransport({enableJsonResponse:options.responseMode!=="sse"});
        let streamed=false,closed=false;
        const close=async()=>{
          if(closed)return;closed=true;abort.abort();request.raw.off("aborted",onAbort);reply.raw.off("close",onAbort);
          await server.close().catch(()=>{});
        };
        const onAbort=()=>{abort.abort();void close();};
        request.raw.once("aborted",onAbort);reply.raw.once("close",onAbort);
        try {
          await server.connect(transport);
          const headers=new Headers();
          for(const name of ["accept","content-type","mcp-protocol-version"]){
            const value=request.headers[name];if(typeof value==="string") headers.set(name,value);
          }
          const response=await transport.handleRequest(new Request(config.publicOrigin+profile.path,{method:"POST",headers,signal:abort.signal}),{parsedBody:request.body});
          reply.code(response.status);
          const type=response.headers.get("content-type");if(type)reply.header("Content-Type",type);
          if(type?.startsWith("text/event-stream")&&response.body) {
            streamed=true;
            reply.raw.once("finish",()=>{void close();});
            // 流完成或断开后再释放 SDK；Readable 桥接保留背压和取消行为。
            return reply.send(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>));
          }
          return reply.send(await response.text());
        }finally {if(!streamed)await close();}
      },
    });
  });
}
