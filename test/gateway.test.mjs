import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {Writable} from 'node:stream';
import {createServer} from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import Fastify from 'fastify';
import {registerMcdGateway} from '../dist/index.js';
import {readMcdConfiguration} from '../deploy/mcd-credentials.mjs';
import {McdMcpClient} from '../dist/mcp/mcd-client.js';
import {mcdPaymentUrl} from '../dist/mcd/orders.js';
const origin='https://synthetic.example',base='/api/mcd/oauth',callback='https://chatgpt.com/connector_platform_oauth_redirect';
const mcd={path:'/api/mcd/orders/mcp',scope:'mcd:orders:create',client:'xiaokui-chatgpt-mcd'},secret='SYNTHETIC-MCD-CREDENTIAL-NOT-REAL';
const ownerHeaders={cookie:'synthetic-owner=session',origin,'x-csrf-token':'synthetic-csrf'};
const context={storeCode:'SYNTHETIC-STORE',orderType:1,beType:1};
const draft={...context,items:[{productCode:'SYNTHETIC-BURGER',quantity:1}],needTableware:false};
const shop={storeCode:context.storeCode,storeName:'合成测试餐厅',address:'合成地址，不是真实地点',businessStatus:true};
const detail=()=>({code:'SYNTHETIC-BURGER',name:'合成汉堡',price:'16',rounds:[],supportModify:false});
const quote=()=>({productOriginalPrice:1600,productPrice:1600,deliveryOriginalPrice:0,deliveryPrice:0,originalPrice:1600,discount:0,price:1600,tablewarePrice:0,productList:[{productCode:'SYNTHETIC-BURGER',productName:'合成汉堡',quantity:1,originalSubtotal:1600,subtotal:1600}],takeWayList:[{code:'SYNTHETIC-TAKEOUT',title:'合成外带'}]});
const success=data=>({content:[{type:'text',text:JSON.stringify({success:true,code:200,message:'请求成功',data})}],isError:false});
async function harness(t,options={}) {
 const root=mkdtempSync(join(tmpdir(),'kuinest-mcd-')),calls=[];let logs='',now=Date.now(),priced=0,status='1';
 const transport=async(url,init)=>{
  assert.equal(String(url),'https://mcp.mcd.cn/');assert.equal(new Headers(init.headers).get('authorization'),'Bearer '+secret);
  if(init.method==='GET')return new Response(null,{status:405});const b=JSON.parse(init.body);
  if(b.method==='initialize')return Response.json({jsonrpc:'2.0',id:b.id,result:{protocolVersion:'2025-06-18',serverInfo:{name:'synthetic-mcd',version:'1'},capabilities:{tools:{}}}});
  if(b.method==='notifications/initialized')return new Response(null,{status:202});
  if(b.method==='tools/list')return Response.json({jsonrpc:'2.0',id:b.id,result:{tools:[{name:'query-meals',inputSchema:{type:'object'}}]}});
  assert.equal(b.method,'tools/call');const {name,arguments:args}=b.params;calls.push(structuredClone(b.params));let d;
  if(name==='query-nearby-stores')d=[shop];
  else if(name==='query-meal-detail')d=options.detail?options.detail():detail();
  else if(name==='calculate-price'){priced++;d=options.quote?options.quote(priced):quote();}
  else if(name==='create-order'){
   assert(readdirSync(join(root,'mcd-orders')).filter(p=>p.endsWith('.json')).some(p=>JSON.parse(readFileSync(join(root,'mcd-orders',p),'utf8')).state==='SUBMITTING'));
   if(options.unknown)throw Error('SYNTHETIC-FAILURE '+secret);
   d={orderId:'SYNTHETIC-ORDER-1',payH5Url:'https://m.mcd.cn/mcp/scanToPay?orderId=SYNTHETIC-ORDER-1',orderDetail:{realTotalAmount:'16'}};
  }else if(name==='query-order')d={orderId:'SYNTHETIC-ORDER-1',orderStatus:status,pickupCode:'SYNTHETIC-PICKUP',mobilePhone:'SYNTHETIC-PRIVATE-PHONE'};
  else d=[];
  const envelope={jsonrpc:'2.0',id:b.id,result:success(d)};
  return options.sse?new Response('data: '+JSON.stringify(envelope)+'\n\n',{headers:{'content-type':'text/event-stream'}}):Response.json(envelope);
 };
 const inspectSession=async cookie=>cookie===ownerHeaders.cookie?{ownerId:'synthetic-owner',csrfToken:'synthetic-csrf'}:cookie==='other=session'?{ownerId:'synthetic-other',csrfToken:'synthetic-csrf'}:undefined;
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const start=async()=>{
  const app=Fastify({logger:{stream:new Writable({write(c,_e,done){logs+=c;done();}})}});
  if(!options.disabled)registerMcdGateway(app,{dataRoot:root,publicOrigin:origin,ownerId:'synthetic-owner',inspectSession,
   token:options.invalidToken?'\n':secret,transport,createEnabled:options.createEnabled!==false,now:()=>now,...(options.sse?{responseMode:'sse'}:{})});
  await app.listen({port,host:'127.0.0.1'});return app;
 };
 let app=await start();t.after(async()=>{await app.close();rmSync(root,{recursive:true,force:true});});
 const inject=opt=>app.inject(opt);
 const grant=async(kind=mcd)=>{
  const verifier='p'.repeat(48),challenge=createHash('sha256').update(verifier).digest('base64url');
  const a=await inject({url:base+'/authorize?'+new URLSearchParams({client_id:kind.client,redirect_uri:callback,response_type:'code',scope:kind.scope,resource:origin+kind.path,state:'synthetic',code_challenge:challenge,code_challenge_method:'S256'})});assert.equal(a.statusCode,303);
  const request=new URL(a.headers.location).searchParams.get('request');const page=await inject({url:new URL(a.headers.location).pathname+new URL(a.headers.location).search});if(kind===mcd)assert(page.body.includes('麦当劳点单'));
  const c=await inject({method:'POST',url:base+'/consent',headers:ownerHeaders,payload:{request,decision:'allow'}});assert.equal(c.statusCode,200);
  const code=new URL(c.json().redirectUrl).searchParams.get('code');const port=app.server.address().port;
  const r=await fetch('http://127.0.0.1:'+port+base+'/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',connection:'close'},body:new URLSearchParams({grant_type:'authorization_code',client_id:kind.client,redirect_uri:callback,resource:origin+kind.path,code,code_verifier:verifier})});assert.equal(r.status,200);return r.json();
 };
 const rpc=(token,name,args,kind=mcd)=>inject({method:'POST',url:kind.path,headers:{authorization:'Bearer '+token,accept:'application/json, text/event-stream','content-type':'application/json','mcp-protocol-version':'2025-06-18'},payload:{jsonrpc:'2.0',id:1,method:name==='tools/list'?'tools/list':'tools/call',...(name==='tools/list'?{}:{params:{name,arguments:args}})}});
 const call=async(token,name,args)=>{const r=await rpc(token,name,args);assert.equal(r.statusCode,200);const body=r.headers['content-type'].startsWith('text/event-stream')?JSON.parse(r.body.split('data: ')[1].split('\n')[0]):r.json();return body.result;};
 const prepare=async token=>{const nearby=await call(token,'query-nearby-stores',{searchType:2,beType:1,city:'合成市',keyword:'合成地点'});assert.equal(nearby.isError,false,JSON.stringify(nearby));const q=await call(token,'calculate-price',draft);assert.equal(q.isError,false,JSON.stringify(q));const p=await call(token,'prepare-order',{quoteId:q.structuredContent.quoteId,takeWayCode:'SYNTHETIC-TAKEOUT'});assert.equal(p.isError,false);return p.structuredContent;};
 const confirm=async(id,headers=ownerHeaders)=>{const d=await inject({url:'/api/mcd/orders/confirm/'+id+'/details',headers});assert.equal(d.statusCode,200);return inject({method:'POST',url:'/api/mcd/orders/confirm/'+id+'/approve',headers,payload:{nonce:d.json().nonce}});};
 return {root,calls,port:()=>app.server.address().port,inject,grant,rpc,call,prepare,confirm,read:id=>JSON.parse(readFileSync(join(root,'mcd-orders',id+'.json'),'utf8')),logs:()=>logs,status:s=>{status=s;},restart:async()=>{await app.close();app=await start();},advance:ms=>{now+=ms;}};
}
test('OAuth拒绝错误资源/scope/本人，工具仅8个，撤销后访问失效',async t=>{
 const h=await harness(t),token=(await h.grant()).access_token;
 assert.equal((await h.rpc(token,'tools/list',{})).json().result.tools.length,8);
 const verifier='v'.repeat(48);
 for(const [resource,scope] of [[origin+'/other/mcp',mcd.scope],[origin+mcd.path,'other:read']]){
  const r=await h.inject({url:base+'/authorize?'+new URLSearchParams({client_id:mcd.client,redirect_uri:callback,response_type:'code',resource,scope,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'})});assert(!r.headers.location?.includes('/consent'));
 }
 const a=await h.inject({url:base+'/authorize?'+new URLSearchParams({client_id:mcd.client,redirect_uri:callback,response_type:'code',scope:mcd.scope,resource:origin+mcd.path,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'})});
 const request=new URL(a.headers.location).searchParams.get('request');
 assert.equal((await h.inject({method:'POST',url:base+'/consent',headers:{...ownerHeaders,cookie:'other=session'},payload:{request,decision:'allow'}})).statusCode,403);
 assert.equal((await h.inject({method:'POST',url:base+'/revoke-mcd-orders',headers:ownerHeaders,payload:{}})).statusCode,200);
 assert.equal((await h.rpc(token,'tools/list',{})).statusCode,401);assert.equal(h.calls.length,0);
});
for(const sse of [false,true])test('SDK真实传输合成：报价→取餐方式→本人批准→创建一次→官方付款链接→官方原文状态 '+sse,async t=>{
 const h=await harness(t,{sse}),token=(await h.grant()).access_token;const p=await h.prepare(token);assert.equal(p.payable,16);assert(!JSON.stringify(p).includes('nonce'));
 const client=new Client({name:'synthetic-chatgpt',version:'1'},{capabilities:{}});
 await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+h.port()+mcd.path),{requestInit:{headers:{authorization:'Bearer '+token}}}));assert.equal((await client.listTools()).tools.length,8);assert.equal((await client.callTool({name:'query-meal-detail',arguments:{...context,code:'SYNTHETIC-BURGER'}})).isError,false);await client.close();
 assert((await h.call(token,'create-order',{intentId:p.intentId})).isError);assert.equal(h.calls.filter(c=>c.name==='create-order').length,0);
 assert.equal((await h.confirm(p.intentId)).statusCode,200);await h.restart();
 const results=await Promise.all([h.call(token,'create-order',{intentId:p.intentId}),h.call(token,'create-order',{intentId:p.intentId})]);assert(results.some(x=>x.isError===false));
 const c=await h.call(token,'create-order',{intentId:p.intentId});assert.equal(c.structuredContent.payH5Url,'https://m.mcd.cn/mcp/scanToPay?orderId=SYNTHETIC-ORDER-1');assert.equal(c.structuredContent.paymentStatus,'unverified');
 assert.deepEqual(h.calls.find(c=>c.name==='create-order').arguments,{storeCode:context.storeCode,orderType:1,beType:1,items:draft.items,needTableware:false,takeWayCode:'SYNTHETIC-TAKEOUT'});
 let q=(await h.call(token,'query-order',{intentId:p.intentId})).structuredContent;assert.equal(q.paymentStatus,'pending');assert.equal(q.pickupCode,undefined);
 h.status('未公开的新状态');q=(await h.call(token,'query-order',{intentId:p.intentId})).structuredContent;assert.equal(q.paymentStatus,'unverified');assert.equal(q.pickupCode,undefined);
 h.status('2');q=(await h.call(token,'query-order',{intentId:p.intentId})).structuredContent;assert.equal(q.paymentStatus,'confirmed');assert.equal(q.pickupCode,'SYNTHETIC-PICKUP');assert(!JSON.stringify(q).includes('SYNTHETIC-PRIVATE-PHONE'));
 const again=await h.prepare(token);await h.confirm(again.intentId);const denied=await h.call(token,'create-order',{intentId:again.intentId});assert(denied.content[0].text.includes('MCD_DUPLICATE_RECENT_ORDER'));
 assert.equal(h.calls.filter(c=>c.name==='create-order').length,1);assert(!h.logs().includes(secret)&&!h.logs().includes(token));
});
test('受保护确认页不能以GET/聊天/OAuth/错误本人、Origin、CSRF、nonce绕过；未知工具与改写订单在上游前拒绝',async t=>{
 const h=await harness(t),token=(await h.grant()).access_token,p=await h.prepare(token),url='/api/mcd/orders/confirm/'+p.intentId;
 const page=await h.inject({url});assert.equal(page.statusCode,200);assert(page.headers['content-security-policy'].includes("frame-ancestors 'none'"));assert(!page.body.includes(shop.storeName));assert.equal(h.read(p.intentId).state,'PREVIEWED');
 assert.equal((await h.inject({url:url+'/details'})).statusCode,403);assert.equal((await h.inject({url:url+'/details',headers:{cookie:'other=session'}})).statusCode,404);
 const d=(await h.inject({url:url+'/details',headers:ownerHeaders})).json();for(const headers of [{...ownerHeaders,origin:'https://attacker.invalid'},{...ownerHeaders,'x-csrf-token':'wrong'},{...ownerHeaders,cookie:'other=session'}])assert.equal((await h.inject({method:'POST',url:url+'/approve',headers,payload:{nonce:d.nonce}})).statusCode,403+Number(headers.cookie==='other=session')*6);
 assert.equal((await h.inject({method:'POST',url:url+'/approve',headers:ownerHeaders,payload:{nonce:'wrong'}})).statusCode,409);
 const before=h.calls.length;for(const [name,args] of [['create-order',{intentId:p.intentId,confirmed:true}],['query-order',{orderId:'arbitrary'}],['cancel-order',{}],['auto-bind-coupons',{}],['__inspectTools',{}],['calculate-price',{...draft,withOrder:{membershipCode:'test'}}]])assert.equal((await h.rpc(token,name,args)).json().error.code,-32602);assert.equal(h.calls.length,before);
 assert.equal((await h.confirm(p.intentId)).statusCode,200);assert.equal((await h.inject({method:'POST',url:url+'/approve',headers:ownerHeaders,payload:{nonce:d.nonce}})).statusCode,409);
});
test('创建结果UNKNOWN持久化，重启与新intent均禁止重建；批准过期及总开关拒绝',async t=>{
 const h=await harness(t,{unknown:true}),token=(await h.grant()).access_token,p=await h.prepare(token);await h.confirm(p.intentId);
 assert((await h.call(token,'create-order',{intentId:p.intentId})).isError);assert.equal(h.read(p.intentId).state,'UNKNOWN');await h.restart();
 assert((await h.call(token,'create-order',{intentId:p.intentId})).isError);assert((await h.call(token,'calculate-price',draft)).isError);assert.equal(h.calls.filter(c=>c.name==='create-order').length,1);
 const disabled=await harness(t,{createEnabled:false}),dtoken=(await disabled.grant()).access_token,dp=await disabled.prepare(dtoken);await disabled.confirm(dp.intentId);assert((await disabled.call(dtoken,'create-order',{intentId:dp.intentId})).isError);assert.equal(disabled.calls.filter(c=>c.name==='create-order').length,0);
 const expired=await harness(t),etoken=(await expired.grant()).access_token,ep=await expired.prepare(etoken);await expired.confirm(ep.intentId);expired.advance(120001);assert((await expired.call(etoken,'create-order',{intentId:ep.intentId})).content[0].text.includes('MCD_APPROVAL_REQUIRED'));assert.equal(expired.calls.filter(c=>c.name==='create-order').length,0);
});
test('报价变更消耗批准，商品不一致/无法核实套餐不会生成确认；同主人不同授权链不能消费批准',async t=>{
 const h=await harness(t,{quote:n=>{const q=quote();if(n>1){q.price=1500;q.discount=100;q.productPrice=1500;q.productList[0].subtotal=1500;}return q;}}),token=(await h.grant()).access_token,other=(await h.grant()).access_token,p=await h.prepare(token);await h.confirm(p.intentId);
 assert((await h.call(other,'create-order',{intentId:p.intentId})).isError);const changed=await h.call(token,'create-order',{intentId:p.intentId});assert(changed.content[0].text.includes('MCD_QUOTE_CHANGED_RECONFIRM'));assert.equal(h.read(p.intentId).state,'REQUOTE_REQUIRED');assert.equal(h.calls.filter(c=>c.name==='create-order').length,0);
 const bad=await harness(t,{detail:()=>({...detail(),code:'WRONG'})}),btoken=(await bad.grant()).access_token;await bad.call(btoken,'query-nearby-stores',{searchType:1,beType:1});assert((await bad.call(btoken,'calculate-price',draft)).isError);
});
test('官方rounds.id/choices和同code不同key冰量：补齐默认子项、替换及特制，确认与提交快照一致',async t=>{
 const h=await harness(t,{detail:()=>({...detail(),rounds:[
  {id:1,name:'合成主食',quantity:1,minQuantity:1,maxQuantity:1,choices:[{code:'SYNTHETIC-MAIN',name:'合成主食',quantity:1,maxQuantity:-1,supportModify:false}]},
  {id:2,name:'合成饮料',quantity:1,minQuantity:1,maxQuantity:1,choices:[{code:'SYNTHETIC-COLA',name:'合成可乐',quantity:1,maxQuantity:-1,supportModify:true,modification:{items:[{minValues:1,maxValues:1,values:[
   {code:'SYNTHETIC-ICE',name:'标准',minQuantity:0,maxQuantity:1,selectedQuantity:1,selectedKey:'0-1'},
   {code:'SYNTHETIC-ICE',name:'去冰',minQuantity:0,maxQuantity:1,selectedQuantity:0,selectedKey:'0-0'}
  ]}]}}]}
 ]})}),token=(await h.grant()).access_token;
 await h.call(token,'query-nearby-stores',{searchType:1,beType:1});
 const chosen={...draft,items:[{productCode:'SYNTHETIC-BURGER',quantity:1,roundList:[{round:'2',comboItemList:[{code:'SYNTHETIC-COLA',quantity:1,modification:{values:[{code:'SYNTHETIC-ICE',quantity:1,key:'0-0'}]}}]}]}]};
 const q=await h.call(token,'calculate-price',chosen);assert.equal(q.isError,false,JSON.stringify(q));const v=h.read(q.structuredContent.quoteId);assert.equal(v.draft.items[0].roundList.length,2);assert(v.quote.products[0].configuration.includes('去冰 × 1'));
 const p=await h.call(token,'prepare-order',{quoteId:v.id,takeWayCode:'SYNTHETIC-TAKEOUT'});assert.equal(p.isError,false);await h.confirm(v.id);assert.equal((await h.call(token,'create-order',{intentId:v.id})).isError,false);
 assert.deepEqual(h.calls.find(c=>c.name==='create-order').arguments.items,v.draft.items);
});
test('上游固定地址白名单、凭据转义脱敏、官方200封装、独立systemd凭据与默认关闭',async t=>{
 let sent=0;const reader=new McdMcpClient({token:secret,transport:async(_u,init)=>{sent++;const b=JSON.parse(init.body);if(b.method==='initialize')return Response.json({jsonrpc:'2.0',id:b.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1'}}});if(b.method==='notifications/initialized')return new Response(null,{status:202});if(b.method==='tools/list')return Response.json({jsonrpc:'2.0',id:b.id,result:{tools:[{name:'query-meals',inputSchema:{type:'object'}}]}});return Response.json({jsonrpc:'2.0',id:b.id,result:success({echo:secret,bearer:'Bearer '+secret,nested:JSON.stringify({echo:secret})})});}});
 await assert.rejects(()=>reader.call('cancel-order',{}));assert.equal(sent,0);const result=await reader.call('query-meals',context);assert.equal(result.isError,false,JSON.stringify(result));assert(!JSON.stringify(result).includes(secret));assert((await reader.call('__inspectTools',{})).content[0].text.includes('inputSchema'));
 const root=mkdtempSync(join(tmpdir(),'mcd-cred-'));t.after(()=>rmSync(root,{recursive:true,force:true}));writeFileSync(join(root,'luckin-token'),secret,{mode:0o400});const env={MCP_OAUTH_ENABLED:'true',MCD_MCP_ENABLED:'true',MCD_OWNER_ID:'synthetic-owner'};assert.equal(readMcdConfiguration(env,root),undefined);writeFileSync(join(root,'mcd-token'),secret,{mode:0o400});assert.equal(readMcdConfiguration({...env,MCD_MCP_ENABLED:'false'},root),undefined);assert.equal(readMcdConfiguration(env,root).orderCreateEnabled,false);
 assert.equal(mcdPaymentUrl('https://m-sit.mcdchina.net/mcp/scanToPay'),undefined);assert.equal(mcdPaymentUrl('https://attacker.invalid/pay'),undefined);
 const h=await harness(t,{disabled:true});assert.equal((await h.inject({url:mcd.path})).statusCode,404);assert.equal((await h.inject({url:'/.well-known/oauth-protected-resource'+mcd.path})).statusCode,404);
});
