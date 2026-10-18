import Database from "better-sqlite3";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, lstatSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
type Code = { client: string; challenge: string; redirect: string; resource: string; owner: string; expires: number };
type Grant = { id: string; client: string; owner: string; resource: string; scope: string; expires: number; revoked: number };
type Token = Grant & { kind: string; token_expires: number; consumed: number };
export type OAuthResourcePolicy = { resource: string; scope: string; client: string; owner: string };

// 只存 OAuth 授权与令牌摘要；不接触宿主的业务数据库，也不存令牌明文。
export class OAuthStore {
  readonly #db: Database.Database;
  readonly #now: () => number;
  readonly resource: string;
  readonly scope: string;
  readonly #additional: ReadonlyMap<string, OAuthResourcePolicy>;
  constructor(root: string, resource: string, scope: string, now = Date.now, additional: readonly OAuthResourcePolicy[] = []) {
    this.#additional = new Map(additional.map(policy => [policy.resource, Object.freeze({ ...policy })]));
    if (this.#additional.size !== additional.length || additional.some(p => p.resource === resource || !p.owner || !p.client || !p.scope)) throw new Error("OAUTH_POLICY_INVALID");
    if (!isAbsolute(root)) throw new Error("OAUTH_ROOT_INVALID");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const info = lstatSync(root);
    if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== "win32" && (info.mode & 0o077) !== 0)) throw new Error("OAUTH_ROOT_INVALID");
    const file = join(root, "oauth.sqlite");
    this.#db = new Database(file);
    this.#db.pragma("journal_mode = WAL"); this.#db.pragma("foreign_keys = ON"); this.#db.pragma("synchronous = FULL");
    this.#db.pragma("busy_timeout = 5000");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS codes(digest TEXT PRIMARY KEY,client TEXT NOT NULL,challenge TEXT NOT NULL,redirect TEXT NOT NULL,resource TEXT NOT NULL,owner TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY,client TEXT NOT NULL,owner TEXT NOT NULL,resource TEXT NOT NULL,scope TEXT NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS tokens(digest TEXT PRIMARY KEY,grant_id TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,kind TEXT NOT NULL,expires INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS token_grant ON tokens(grant_id);
    `);
    this.resource = resource; this.scope = scope; this.#now = now;
  }
  #scope(resource: string, client: string, owner: string): string {
    if (resource === this.resource) return this.scope;
    const policy = this.#additional.get(resource);
    if (!policy || policy.client !== client || policy.owner !== owner) throw new InvalidGrantError("授权资源无效。");
    return policy.scope;
  }
  #seconds() { return Math.floor(this.#now() / 1000); }
  #prune() {
    const now = this.#seconds();
    this.#db.prepare("DELETE FROM codes WHERE expires<=?").run(now);
    this.#db.prepare("DELETE FROM grants WHERE expires<=?").run(now);
  }
  issueCode(code: Omit<Code, "expires">): string {
    this.#scope(code.resource,code.client,code.owner);
    this.#prune();
    if ((this.#db.prepare("SELECT count(*) n FROM codes").get() as { n: number }).n >= 100) throw new Error("OAUTH_CAPACITY");
    const value = secret();
    this.#db.prepare("INSERT INTO codes VALUES(?,?,?,?,?,?,?)").run(hash(value),code.client,code.challenge,code.redirect,code.resource,code.owner,this.#seconds()+60);
    return value;
  }
  code(client: string, value: string): Code {
    const row = this.#db.prepare("SELECT client,challenge,redirect,resource,owner,expires FROM codes WHERE digest=?").get(hash(value)) as Code | undefined;
    if (!row || row.client !== client || row.expires <= this.#seconds()) throw new InvalidGrantError("授权码无效或已过期。");
    return row;
  }
  exchange(client: string, value: string, redirect?: string, resource?: URL) {
    return this.#db.transaction(() => {
      const code = this.code(client, value);
      if (redirect !== code.redirect || resource?.href !== code.resource) throw new InvalidGrantError("授权绑定不匹配。");
      const scope = this.#scope(code.resource,client,code.owner);
      this.#prune();
      if ((this.#db.prepare("SELECT count(*) n FROM grants WHERE revoked=0").get() as { n: number }).n >= 128) throw new InvalidGrantError("授权数量已达上限，请先撤销旧授权。");
      this.#db.prepare("DELETE FROM codes WHERE digest=?").run(hash(value));
      const grant: Grant = { id: randomUUID(), client, owner: code.owner, resource: code.resource, scope, expires: this.#seconds()+30*86400, revoked: 0 };
      this.#db.prepare("INSERT INTO grants VALUES(?,?,?,?,?,?,0)").run(grant.id,grant.client,grant.owner,grant.resource,grant.scope,grant.expires);
      return this.#issue(grant);
    })();
  }
  #token(value: string): Token | undefined {
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return undefined;
    return this.#db.prepare("SELECT g.*,t.kind,t.expires token_expires,t.consumed FROM tokens t JOIN grants g ON g.id=t.grant_id WHERE t.digest=?").get(hash(value)) as Token | undefined;
  }
  #issue(grant: Grant) {
    const access = secret(), refresh = secret();
    this.#db.prepare("DELETE FROM tokens WHERE grant_id=? AND kind='access'").run(grant.id);
    this.#db.prepare("INSERT INTO tokens VALUES(?,?,?, ?,0)").run(hash(access),grant.id,"access",Math.min(grant.expires,this.#seconds()+900));
    this.#db.prepare("INSERT INTO tokens VALUES(?,?,?, ?,0)").run(hash(refresh),grant.id,"refresh",grant.expires);
    return { access_token: access, token_type: "Bearer", expires_in: Math.min(900,grant.expires-this.#seconds()), refresh_token: refresh, scope: grant.scope };
  }
  refresh(client: string, value: string, scopes?: string[], resource?: URL) {
    const row = this.#token(value);
    if (!row || row.kind !== "refresh" || row.client !== client || row.revoked || row.expires <= this.#seconds() || row.token_expires <= this.#seconds()) throw new InvalidGrantError("刷新授权无效或已过期。");
    // 重用旧刷新令牌时撤销整条授权链；撤销必须提交，不能随异常回滚。
    if (row.consumed) { this.#db.prepare("UPDATE grants SET revoked=1 WHERE id=?").run(row.id); throw new InvalidGrantError("刷新令牌已使用，请重新授权。"); }
    const allowedScope = this.#scope(row.resource,row.client,row.owner);
    if (row.scope !== allowedScope || (resource && resource.href !== row.resource) || (scopes && (scopes.length !== 1 || scopes[0] !== row.scope))) throw new InvalidGrantError("授权范围或目标资源不匹配。");
    return this.#db.transaction(() => {
      this.#db.prepare("UPDATE tokens SET consumed=1 WHERE digest=?").run(hash(value));
      return this.#issue(row);
    })();
  }
  verify(value: string, expectedResource = this.resource) { return this.#verify(value,expectedResource); }
  verifyAny(value: string) { return this.#verify(value); }
  #verify(value: string, expectedResource?: string) {
    const row = this.#token(value);
    if (!row || row.kind !== "access" || row.revoked || row.consumed || row.token_expires <= this.#seconds() || row.expires <= this.#seconds() || (expectedResource !== undefined && row.resource !== expectedResource))
      throw new InvalidTokenError("只读访问授权无效或已过期。");
    try { if (row.scope !== this.#scope(row.resource,row.client,row.owner)) throw new Error(); }
    catch { throw new InvalidTokenError("只读访问授权无效或已过期。"); }
    return { token: value, clientId: row.client, scopes: [row.scope], expiresAt: row.token_expires, resource: new URL(row.resource), extra: { ownerId: row.owner } };
  }
  // 新订单资源的内部身份绑定；既有verify返回及OAuth表结构不变。
  binding(value:string,resource:string){this.#verify(value,resource);const row=this.#token(value)!;return {ownerId:row.owner,clientId:row.client,grantId:row.id,resource:row.resource};}
  grantActive(binding:{ownerId:string;clientId:string;grantId:string;resource:string}):boolean{
    const row=this.#db.prepare("SELECT * FROM grants WHERE id=?").get(binding.grantId) as Grant|undefined;
    if(!row||row.revoked||row.expires<=this.#seconds()||row.owner!==binding.ownerId||row.client!==binding.clientId||row.resource!==binding.resource)return false;
    try{return row.scope===this.#scope(row.resource,row.client,row.owner);}catch{return false;}
  }
  revoke(client: string, value: string) {
    const row = this.#token(value);
    if (row && row.client === client) this.#db.prepare("UPDATE grants SET revoked=1 WHERE id=?").run(row.id);
  }
  revokeResource(owner: string, resource: string) {
    this.#db.transaction(() => {
      this.#db.prepare("UPDATE grants SET revoked=1 WHERE owner=? AND resource=?").run(owner,resource);
      this.#db.prepare("DELETE FROM codes WHERE owner=? AND resource=?").run(owner,resource);
    })();
  }
  revokeAll(owner: string) {
    this.#db.transaction(() => {
      this.#db.prepare("UPDATE grants SET revoked=1 WHERE owner=?").run(owner);
      this.#db.prepare("DELETE FROM codes WHERE owner=?").run(owner);
    })();
  }
  close() { this.#db.close(); }
}
