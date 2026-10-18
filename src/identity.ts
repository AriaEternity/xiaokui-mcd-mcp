import type {FastifyInstance} from 'fastify';
import rateLimit from '@fastify/rate-limit';
import Database from 'better-sqlite3';
import {createHash,randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {constants,openSync,closeSync,fstatSync,mkdirSync,lstatSync} from 'node:fs';
import {isAbsolute,join,dirname} from 'node:path';
import {readPrivateFile} from './private-file.js';
import type {SessionInspector} from './oauth/server.js';

// 密码校验沿用瑞幸公开版；本实例的会话摘要独立落盘，重启后仍逐次验证。
const scrypt=promisify(scryptCallback),cookieName='__Host-mcd-session';
const random=()=>randomBytes(32).toString('base64url');
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const same=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export type OwnerRecord={version:1;ownerId:string;username:string;salt:string;hash:string};
export function readOwner(file:string):OwnerRecord {
 const raw=readPrivateFile(file,16384);
 try{
  const v=JSON.parse(raw.toString('utf8')) as OwnerRecord;
  if(v.version!==1||typeof v.ownerId!=='string'||!/^[-\w]{1,128}$/.test(v.ownerId)||typeof v.username!=='string'||!v.username.trim()||v.username.length>128||!/^[a-f0-9]{32}$/.test(v.salt)||!/^[a-f0-9]{128}$/.test(v.hash))throw Error('OWNER_RECORD_INVALID');
  return v;
 }finally{raw.fill(0);}
}
export function privateDirectory(root:string){
 if(!isAbsolute(root))throw Error('DATA_ROOT_ABSOLUTE_REQUIRED');
 mkdirSync(root,{recursive:true,mode:0o700});const info=lstatSync(root);
 if(!info.isDirectory()||info.isSymbolicLink()||(process.platform!=='win32'&&((info.mode&0o077)!==0||info.uid!==process.getuid?.())))throw Error('DATA_ROOT_PRIVATE_REQUIRED');
 if(process.platform!=='win32')for(let path=dirname(root);;path=dirname(path)){
  const s=lstatSync(path),stickyRoot=s.uid===0&&(s.mode&0o1000)!==0;
  if(!s.isDirectory()||s.isSymbolicLink()||![0,process.getuid?.()].includes(s.uid)||((s.mode&0o022)!==0&&!stickyRoot))throw Error('DATA_PARENT_UNTRUSTED');
  if(path==='/')break;
 }
}
export function localOwnerIdentity(options:{file:string;root:string;publicOrigin:string;now?:()=>number}) {
 if(process.platform!=='win32'&&(process.umask()&0o077)!==0o077)throw Error('PRIVATE_UMASK_REQUIRED');
 const url=new URL(options.publicOrigin);
 if(url.protocol!=='https:'||url.origin!==options.publicOrigin||url.username||url.password)throw Error('PUBLIC_ORIGIN_HTTPS_REQUIRED');
 const owner=readOwner(options.file),now=options.now??Date.now;
 privateDirectory(options.root);
 const file=join(options.root,'owner-sessions.sqlite');
 const fd=openSync(file,constants.O_RDWR|constants.O_CREAT|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0),0o600);
 try{const info=fstatSync(fd);if(!info.isFile()||info.nlink!==1||(process.platform!=='win32'&&((info.mode&0o077)!==0||info.uid!==process.getuid?.())))throw Error('SESSION_FILE_PRIVATE_REQUIRED');}finally{closeSync(fd);}
 const db=new Database(file);db.pragma('journal_mode = WAL');db.pragma('synchronous = FULL');db.pragma('busy_timeout = 5000');
 db.exec('CREATE TABLE IF NOT EXISTS sessions(digest TEXT PRIMARY KEY,owner TEXT NOT NULL,identity_digest TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL)');
 const identityDigest=digest(JSON.stringify(owner));
 const prune=()=>db.prepare('DELETE FROM sessions WHERE expires<=? OR identity_digest<>?').run(now(),identityDigest);
 prune();
 const cookieToken=(header:string)=>{
  if(header.length>4096)return;
  const values=header.split(';').map(v=>v.trim()).filter(v=>v.startsWith(cookieName+'='));
  if(values.length!==1)return;const value=values[0]!.slice(cookieName.length+1);
  return /^[A-Za-z0-9_-]{43}$/.test(value)?value:undefined;
 };
 const inspectSession:SessionInspector=async header=>{
  const token=cookieToken(header);if(!token)return;
  const row=db.prepare('SELECT csrf,expires FROM sessions WHERE digest=? AND owner=? AND identity_digest=?').get(digest(token),owner.ownerId,identityDigest) as {csrf:string;expires:number}|undefined;
  if(!row||row.expires<=now())return;
  return {ownerId:owner.ownerId,csrfToken:row.csrf};
 };
 const csrfOwner=async(req:{headers:Record<string,unknown>})=>{
  if(req.headers.origin!==options.publicOrigin)return;
  const session=await inspectSession(typeof req.headers.cookie==='string'?req.headers.cookie:'');
  const csrf=req.headers['x-csrf-token'];
  return session&&typeof csrf==='string'&&csrf.length<=256&&same(csrf,session.csrfToken)?session:undefined;
 };
 return {ownerId:owner.ownerId,inspectSession,close:()=>{db.close();},register(app:FastifyInstance){
  app.register(async scope=>{
   await scope.register(rateLimit,{max:120,timeWindow:60000,keyGenerator:()=> 'single-owner-auth'});
   scope.addHook('onSend',async(_req,reply)=>{reply.header('Cache-Control','no-store');reply.header('Referrer-Policy','no-referrer');});
   scope.get('/api/v1/auth/session',async(req,reply)=>(await inspectSession(req.headers.cookie??''))??reply.code(401).send({error:'login_required'}));
   scope.post<{Body:{username?:unknown;password?:unknown}}>('/api/v1/auth/login',{
    bodyLimit:2048,config:{rateLimit:{max:5,timeWindow:900000,keyGenerator:()=> 'single-owner-login'}},
   },async(req,reply)=>{
    if(req.headers.origin!==options.publicOrigin)return reply.code(403).send({error:'access_denied'});
    if(!req.body||Object.keys(req.body).length!==2||typeof req.body.username!=='string'||typeof req.body.password!=='string'||req.body.username.length>128||req.body.password.length>512)return reply.code(400).send({error:'invalid_request'});
    const computed=Buffer.from(await scrypt(req.body.password,owner.salt,64) as Buffer);req.body.password='';
    const valid=same(req.body.username,owner.username)&&timingSafeEqual(computed,Buffer.from(owner.hash,'hex'));computed.fill(0);
    if(!valid)return reply.code(401).send({error:'login_failed'});
    const token=random(),csrf=random();
    const inserted=db.transaction(()=>{prune();if((db.prepare('SELECT count(*) n FROM sessions').get() as {n:number}).n>=32)return false;db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(digest(token),owner.ownerId,identityDigest,csrf,now()+8*60*60*1000);return true;})();
    if(!inserted)return reply.code(429).send({error:'session_capacity'});
    // 使用固定 __Host- 前缀：Secure、HttpOnly、无 Domain，Path 固定为根。
    reply.header('Set-Cookie',`${cookieName}=${token}; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Lax`);
    return {status:'logged_in'};
   });
   scope.post('/api/v1/auth/logout',async(req,reply)=>{
    if(!await csrfOwner(req))return reply.code(403).send({error:'access_denied'});
    const token=cookieToken(req.headers.cookie??'');if(token)db.prepare('DELETE FROM sessions WHERE digest=?').run(digest(token));
    reply.header('Set-Cookie',`${cookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);return {status:'logged_out'};
   });
  });
 }};
}
