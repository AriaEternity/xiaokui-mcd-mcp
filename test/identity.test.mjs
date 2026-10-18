import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync,chmodSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {initializeOwner} from '../scripts/owner-record.mjs';
import {createStandaloneGateway} from '../dist/standalone.js';
import {readOwner} from '../dist/identity.js';
const origin='https://synthetic.example',password='SYNTHETIC-OWNER-PASSWORD-ONLY',token='SYNTHETIC-NOT-A-REAL-MCD-TOKEN';
process.umask(0o077);
function files(t,cleanup=true){const root=mkdtempSync(join(tmpdir(),'mcd-identity-'));if(cleanup)t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,file:join(root,'owner.json')};}
async function fixture(t){
 const {root,file}=files(t,false);initializeOwner(file,'owner',password,password);let now=Date.now(),app;
 const start=()=>createStandaloneGateway({root,publicOrigin:origin,ownerFile:file,token,now:()=>now,transport:async()=>{throw Error('NO_UPSTREAM_EXPECTED');}});
 app=start();await app.ready();t.after(async()=>{await app.close();rmSync(root,{recursive:true,force:true});});
 return {root,file,inject:o=>app.inject(o),advance:ms=>{now+=ms;},restart:async()=>{await app.close();app=start();await app.ready();}};
}
const login=(h,extra={})=>h.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username:'owner',password},...extra});
test('主人初始化拒绝短密码/不匹配/覆盖；只保存随机salt与scrypt哈希，非交互初始化失败关闭',t=>{
 const {root,file}=files(t);
 for(const [p,c] of [['short','short'],[password,'different']])assert.throws(()=>initializeOwner(file,'owner',p,c));
 initializeOwner(file,'owner',password,password);const raw=readFileSync(file,'utf8'),owner=readOwner(file);assert(!raw.includes(password));assert.equal(owner.hash.length,128);
 assert.throws(()=>initializeOwner(file,'owner',password,password));assert.equal(readFileSync(file,'utf8'),raw);
 const other=join(root,'other.json');initializeOwner(other,'owner',password,password);assert.notEqual(readOwner(other).salt,owner.salt);assert.notEqual(readOwner(other).ownerId,owner.ownerId);
 const failed=spawnSync(process.execPath,['scripts/owner-init.mjs'],{cwd:process.cwd(),env:{...process.env,OWNER_FILE:join(root,'not-created.json')},encoding:'utf8'});assert.notEqual(failed.status,0);assert(!failed.stdout.includes(password));
});
test('真实密码校验、Origin及输入边界；MCP Bearer和自报Cookie不能充当本人会话',async t=>{
 const h=await fixture(t);
 assert.equal((await h.inject({url:'/api/v1/auth/session',headers:{authorization:'Bearer '+token,cookie:'owner=owner'}})).statusCode,401);
 assert.equal((await login(h,{headers:{origin:'https://attacker.invalid'}})).statusCode,403);
 assert.equal((await login(h,{payload:{username:'someone-else',password}})).statusCode,401);
 assert.equal((await login(h,{payload:{username:'owner',password:'wrong'}})).statusCode,401);
 assert.equal((await login(h,{payload:{username:'owner',password,ownerId:'forged'}})).statusCode,400);
 assert.equal((await h.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username:'owner',password:'x'.repeat(3000)}})).statusCode,413);
});
test('安全Cookie、持久会话摘要、重启恢复、过期、CSRF与退出撤销',async t=>{
 const h=await fixture(t),r=await login(h);assert.equal(r.statusCode,200);
 const value=r.headers['set-cookie'];for(const part of ['__Host-mcd-session=','HttpOnly','Secure','SameSite=Lax','Path=/','Max-Age=28800'])assert(value.includes(part));assert(!value.includes('Domain='));
 const cookie=value.split(';')[0],secret=cookie.split('=')[1];
 let session=await h.inject({url:'/api/v1/auth/session',headers:{cookie}});assert.equal(session.statusCode,200);const csrf=session.json().csrfToken;
 for(const f of readdirSync(join(h.root,'identity')))assert(!readFileSync(join(h.root,'identity',f)).includes(Buffer.from(secret)));
 await h.restart();assert.equal((await h.inject({url:'/api/v1/auth/session',headers:{cookie}})).statusCode,200);
 assert.equal((await h.inject({url:'/api/v1/auth/session',headers:{cookie:cookie+'; '+cookie}})).statusCode,401);
 for(const headers of [{cookie,origin,'x-csrf-token':'wrong'},{cookie,origin:'https://attacker.invalid','x-csrf-token':csrf}])assert.equal((await h.inject({method:'POST',url:'/api/v1/auth/logout',headers,payload:{}})).statusCode,403);
 assert.equal((await h.inject({method:'POST',url:'/api/v1/auth/logout',headers:{cookie,origin,'x-csrf-token':csrf},payload:{}})).statusCode,200);
 await h.restart();assert.equal((await h.inject({url:'/api/v1/auth/session',headers:{cookie}})).statusCode,401);
 const second=await login(h),secondCookie=second.headers['set-cookie'].split(';')[0];h.advance(28800001);assert.equal((await h.inject({url:'/api/v1/auth/session',headers:{cookie:secondCookie}})).statusCode,401);
});
test('固定单主人登录限流，不信任伪造转发IP，耗尽返回429',async t=>{
 const h=await fixture(t);for(let n=0;n<5;n++)assert.equal((await login(h,{headers:{origin,'x-forwarded-for':'SYNTHETIC-'+n},payload:{username:'owner',password:'wrong'}})).statusCode,401);
 assert.equal((await login(h)).statusCode,429);
});
test('Linux私有权限和链接边界；Windows不冒充POSIX权限验证',{skip:process.platform==='win32'?'需要Linux实际文件权限':false},async t=>{
 const {root,file}=files(t);initializeOwner(file,'owner',password,password);
 chmodSync(file,0o644);assert.throws(()=>readOwner(file));chmodSync(file,0o400);
 const link=join(root,'linked.json');symlinkSync(file,link);assert.throws(()=>readOwner(link));
 chmodSync(root,0o777);assert.throws(()=>createStandaloneGateway({root,publicOrigin:origin,ownerFile:file,token}));chmodSync(root,0o700);
});
test('独立启动入口使用合成凭据完成启动与健康检查；无主人文件时拒绝启动',async t=>{
 const {root,file}=files(t);initializeOwner(file,'owner',password,password);writeFileSync(join(root,'mcd-token'),token,{mode:0o400});
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const env={...process.env,PUBLIC_ORIGIN:origin,DATA_ROOT:root,OWNER_FILE:file,MCD_CREDENTIAL_ROOT:root,MCD_OWNER_ID:'',MCD_MCP_ENABLED:'true',MCP_OAUTH_ENABLED:'true',MCD_ORDER_CREATE_ENABLED:'false',PORT:String(port)};
 const child=spawn(process.execPath,['--import','./test/network-guard.mjs','dist/main.js'],{env,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';const exited=new Promise(r=>child.once('exit',r));t.after(async()=>{if(child.exitCode===null){child.kill();await exited;}});
 child.stderr.on('data',c=>{stderr+=c;});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('STARTUP_TIMEOUT')),10000);child.stdout.on('data',c=>{stdout+=c;if(stdout.includes('MCD_GATEWAY_READY')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('STARTUP_FAILED'));});});
 const health=await fetch('http://127.0.0.1:'+port+'/health/ready');assert.equal(health.status,200);assert.equal((await health.json()).status,'ready');
 assert.equal((await fetch('http://127.0.0.1:'+port+'/api/mcd/orders/mcp')).status,401);assert(!stdout.includes(token)&&!stderr.includes(token)&&!stdout.includes(password));
 child.kill();await exited;
 const failed=spawnSync(process.execPath,['dist/main.js'],{env:{...env,OWNER_FILE:join(root,'missing.json')},encoding:'utf8'});assert.notEqual(failed.status,0);assert(failed.stderr.includes('MCD_START_FAILED'));assert(!failed.stderr.includes(token));
});
