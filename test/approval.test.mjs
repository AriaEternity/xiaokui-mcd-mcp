// 独立纯合成资料；真实网络、真实账号及交易均禁止。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Writable} from 'node:stream';
import {runInNewContext} from 'node:vm';
import Fastify from 'fastify';
import {McdOrdersService} from '../dist/mcd/orders.js';
import {registerMcdOrderConfirmation} from '../dist/http/routes/mcd-order-confirm.js';
import {mcdFailure} from '../dist/mcp/mcd-policy.js';
process.umask(0o077);
globalThis.fetch=async()=>{throw Error('TEST_EXTERNAL_NETWORK_DENIED');};
const origin='https://synthetic.example.invalid',start=Date.parse('2030-01-02T03:04:00Z');
const binding={ownerId:'synthetic-owner',clientId:'synthetic-client',grantId:'synthetic-grant',resource:origin+'/api/mcd/orders/mcp'};
const ownerHeaders={cookie:'synthetic-cookie=owner',origin,'x-csrf-token':'synthetic-csrf'};
const draft={storeCode:'SYNTHETIC-STORE',orderType:1,beType:1,items:[{productCode:'SYNTHETIC-MEAL',quantity:1}],needTableware:false};
const code=r=>JSON.parse(r.content[0].text);
async function harness(t){
 const root=mkdtempSync(join(tmpdir(),'mcd-approval-regression-')),calls=[];let now=start,active=true,logs='',expireOnPrice=false;
 const success=data=>({isError:false,content:[{type:'text',text:JSON.stringify({success:true,code:200,data})}]});
 const options={root,publicOrigin:origin,createEnabled:true,now:()=>now,active:()=>active,reader:{call:async(name)=>{
  calls.push(name);
  if(name==='query-nearby-stores')return success([{storeCode:'SYNTHETIC-STORE',storeName:'合成餐厅',address:'合成地址'}]);
  if(name==='query-meal-detail')return success({code:'SYNTHETIC-MEAL',name:'合成餐品',supportModify:false,rounds:[]});
  if(name==='calculate-price'){if(expireOnPrice)now+=120001;return success({originalPrice:1700,discount:0,price:1700,productPrice:1700,productList:[{productCode:'SYNTHETIC-MEAL',productName:'合成餐品',quantity:1}],takeWayList:[{code:'SYNTHETIC-TAKE',title:'合成外带'}]});}
  throw Error('本组测试禁止调用官方创建或查询');
 }}};
 const service=new McdOrdersService(options);
 const app=Fastify({logger:{stream:new Writable({write(c,_e,done){logs+=c;done();}}),base:null,serializers:{req:()=>({}),err:()=>({})}},disableRequestLogging:true});
 const inspectSession=async cookie=>{if(cookie==='synthetic-cookie=throw')throw Error('SYNTHETIC-PRIVATE-ERROR');return cookie===ownerHeaders.cookie?{ownerId:binding.ownerId,csrfToken:ownerHeaders['x-csrf-token']}:cookie==='synthetic-cookie=other'?{ownerId:'synthetic-other',csrfToken:ownerHeaders['x-csrf-token']}:undefined;};
 registerMcdOrderConfirmation(app,{publicOrigin:origin,service,inspectSession});await app.ready();
 t.after(async()=>{await app.close();rmSync(root,{recursive:true,force:true});});
 const preview=async()=>{await service.call(binding,'query-nearby-stores',{searchType:1,beType:1});const q=await service.call(binding,'calculate-price',draft);assert.equal(q.isError,false);const p=await service.call(binding,'prepare-order',{quoteId:q.structuredContent.quoteId,takeWayCode:'SYNTHETIC-TAKE'});assert.equal(p.isError,false);return service.store.get(p.structuredContent.intentId);};
 return {app,service,calls,preview,logs:()=>logs,advance:ms=>now+=ms,revoke:()=>active=false,expireOnPrice:()=>expireOnPrice=true,restore:()=>new McdOrdersService(options)};
}
test('本地未提交、报价过期、批准期限及复核后到期分别返回；持久化状态不被查询改写',async t=>{
 const h=await harness(t),v=await h.preview();
 assert.equal(code(await h.service.call(binding,'prepare-order',{quoteId:v.id,takeWayCode:'SYNTHETIC-TAKE'})).code,'MCD_INTENT_ALREADY_PREPARED');
 let r=code(await h.service.call(binding,'create-order',{intentId:v.id}));assert.equal(r.code,'MCD_APPROVAL_REQUIRED');assert.equal(r.creationRequestStatus,'not_sent');assert(!r.message.includes('UNKNOWN')&&!r.message.includes('结果未知'));
 h.advance(300001);let q=(await h.service.call(binding,'query-order',{intentId:v.id})).structuredContent;
 assert.equal(q.state,'PREVIEWED');assert.equal(q.quoteExpired,true);assert.equal(q.creationStatus,'not_submitted');assert.equal(q.nextAction,'recalculate');assert.equal(q.confirmationUrl,undefined);assert(!q.notice.includes('UNKNOWN'));assert.equal(h.service.store.get(v.id).state,'PREVIEWED');
 assert.equal(code(await h.service.call(binding,'create-order',{intentId:v.id})).code,'MCD_QUOTE_EXPIRED');
 const approved=await h.preview();await h.service.approve(approved.id,binding.ownerId,approved.nonce);
 assert.equal(h.restore().store.get(approved.id).state,'APPROVED');h.advance(120001);
 assert.equal(code(await h.service.call(binding,'create-order',{intentId:approved.id})).code,'MCD_APPROVAL_EXPIRED');
 const next=await h.preview();await h.service.approve(next.id,binding.ownerId,next.nonce);h.expireOnPrice();
 assert.equal(code(await h.service.call(binding,'create-order',{intentId:next.id})).code,'MCD_APPROVAL_EXPIRED');
 assert.equal(h.calls.filter(n=>n==='create-order').length,0);
});
test('UNKNOWN与SUBMITTING即使过期仍阻断重建；所有本地阶段返回明确下一步',async t=>{
 const h=await harness(t),base=await h.preview();
 for(const [state,nextAction,approvalStatus] of [['QUOTED','prepare','not_requested'],['PREVIEWED','approve','required'],['APPROVED','submit','approved'],['REQUOTE_REQUIRED','recalculate','consumed']]){
  const v={...base,id:randomUUID(),state,approvedUntil:start+10000};h.service.store.create(v);
  const q=(await h.service.call(binding,'query-order',{intentId:v.id})).structuredContent;
  assert.equal(q.nextAction,nextAction);assert.equal(q.approvalStatus,approvalStatus);assert.equal(q.officialOrderKnown,false);assert.equal(q.creationStatus,'not_submitted');assert.equal('nonce' in q,false);
 }
 for(const state of ['UNKNOWN','SUBMITTING']){
  const v={...base,id:randomUUID(),state,expires:start-1};h.service.store.create(v);
  const q=(await h.service.call(binding,'query-order',{intentId:v.id})).structuredContent;
  assert.equal(q.state,'UNKNOWN');assert.equal(q.creationStatus,'unknown');assert.equal(q.nextAction,'owner_reconciliation');assert.equal(q.confirmationUrl,undefined);
  assert.equal(code(await h.service.call(binding,'create-order',{intentId:v.id})).creationRequestStatus,'unknown');
  assert.equal(h.service.store.get(v.id).state,state);
 }
 assert.equal(code(await h.service.call(binding,'calculate-price',draft)).code,'MCD_UNKNOWN_ORDER_REQUIRES_OWNER_RECONCILIATION');
 assert.equal(h.calls.filter(n=>n==='create-order').length,0);
 const busy=code(mcdFailure('MCD_BUSY'));assert(busy.message.includes('两个在途'));assert(!busy.message.includes('创建结果未知'));
});
test('状态回读受真实宿主校验边界保护且不含nonce；批准记录仅有摘要与固定结果码',async t=>{
 const h=await harness(t),v=await h.preview(),url='/api/mcd/orders/confirm/'+v.id;
 assert.equal((await h.app.inject({url:url+'/status'})).statusCode,403);
 assert.equal((await h.app.inject({url:url+'/status',headers:{cookie:'synthetic-cookie=other'}})).statusCode,404);
 assert.equal((await h.app.inject({url:url+'/status',headers:{cookie:'synthetic-cookie=throw'}})).statusCode,503);
 assert.equal((await h.app.inject({url:url+'/status',headers:{...ownerHeaders,origin:'https://attacker.invalid'}})).statusCode,403);
 const get=()=>h.app.inject({url:url+'/status',headers:ownerHeaders});
 const s=(await get()).json();assert.equal(s.state,'PREVIEWED');assert(!JSON.stringify(s).includes(v.nonce));assert.equal(s.shop,undefined);
 const post=(headers,payload={nonce:v.nonce})=>h.app.inject({method:'POST',url:url+'/approve',headers,payload});
 for(const headers of [{...ownerHeaders,origin:'https://attacker.invalid'},{...ownerHeaders,cookie:'synthetic-cookie=other'},{...ownerHeaders,'x-csrf-token':'bad'}])assert((await post(headers)).statusCode>=400);
 assert.equal((await post(ownerHeaders,{nonce:'wrong'})).statusCode,409);
 for(const payload of [null,[],{nonce:v.nonce,extra:true}])assert.equal((await post(ownerHeaders,payload)).statusCode,400);
 const approved=await post(ownerHeaders);assert.equal(approved.statusCode,200);assert.equal(approved.json().approvalExpiresAt,new Date(start+120000).toISOString());
 assert.equal((await post(ownerHeaders)).statusCode,409);assert.equal((await get()).json().approvalStatus,'approved');
 const events=h.logs().trim().split('\n').map(s=>JSON.parse(s)).filter(e=>e.event==='mcd_approval');
 assert(events.some(e=>e.result==='approved'));assert(events.some(e=>e.result==='csrf_denied'));assert(events.some(e=>e.result==='origin_denied'));assert(events.some(e=>e.result==='nonce_invalid'));
 for(const e of events){assert.equal(e.intentRef,createHash('sha256').update(v.id).digest('hex').slice(0,24));assert.deepEqual(Object.keys(e).sort(),['event','intentRef','level','msg','result','time'].sort());}
 for(const value of [v.id,v.nonce,ownerHeaders.cookie,ownerHeaders['x-csrf-token'],'SYNTHETIC-PRIVATE-ERROR',binding.ownerId])assert(!h.logs().includes(value));
 h.revoke();assert.equal((await get()).statusCode,404);assert.equal((await post(ownerHeaders)).statusCode,409);
 assert.equal(h.calls.filter(n=>n==='create-order').length,0);
});

async function browser(h,v,mode){
 const elements=new Map(),counts={approve:0,details:0};let failStatus=false,loggedIn=true;
 const node=()=>({hidden:false,disabled:false,value:'',textContent:'',handlers:{},addEventListener(k,f){this.handlers[k]=f;},replaceChildren(){},append(){}});
 for(const id of ['status','login','review','allow','refresh','shop','address','items','money','discount','expires','user','password'])elements.set('#'+id,node());
 const html=(await h.app.inject({url:'/api/mcd/orders/confirm/'+v.id})).body,script=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
 const fetch=async(url,options={})=>{
  if(url==='/api/v1/auth/session')return new Response(JSON.stringify({csrfToken:ownerHeaders['x-csrf-token']}),{status:loggedIn?200:401});
  if(url.endsWith('/details'))counts.details++;
  if(url.endsWith('/status')&&failStatus)throw Error('合成读回失败');
  if(url.endsWith('/approve')){
   counts.approve++;
   if(mode==='before-send'){mode='normal';throw Error('合成发送前断网');}
   if(mode==='unverified'){mode='normal';failStatus=true;throw Error('合成断网');}
   if(mode==='logout'){loggedIn=false;mode='normal';}
  }
  const r=await h.app.inject({url,method:options.method??'GET',headers:{...ownerHeaders,...options.headers,...(!loggedIn?{cookie:''}:{})},...(options.body?{payload:options.body}:{})});
  if(url.endsWith('/approve')&&mode==='lost-response'){mode='normal';throw Error('批准已保存，合成响应丢失');}
  return new Response(r.body,{status:r.statusCode});
 };
 await runInNewContext(script,{document:{querySelector:k=>elements.get(k),createElement:node},fetch,Date,JSON,AbortSignal});
 return {get:id=>elements.get('#'+id),counts,click:()=>elements.get('#allow').handlers.click(),refresh:()=>elements.get('#refresh').handlers.click(),recover:()=>{failStatus=false;loggedIn=true;}};
}
test('页面在失败后只回读；响应丢失可恢复已批准状态，过期显示实际期限，无自动批准或创建',async t=>{
 for(const mode of ['before-send','lost-response','unverified','logout']){
  const h=await harness(t),v=await h.preview(),b=await browser(h,v,mode);
  assert.equal(b.get('allow').disabled,false);await Promise.all([b.click(),b.click()]);assert.equal(b.counts.approve,1);
  if(mode==='lost-response'){
   assert.equal(h.service.store.get(v.id).state,'APPROVED');assert.match(b.get('status').textContent,/服务器已保存/);assert.equal(b.get('review').hidden,true);
  }else{
   assert.equal(h.service.store.get(v.id).state,'PREVIEWED');
   if(mode==='before-send')assert.equal(b.get('allow').disabled,false);
   if(mode==='unverified'){assert.equal(b.get('allow').disabled,true);assert.equal(b.get('refresh').disabled,false);}
   if(mode==='logout')assert.equal(b.get('login').hidden,false);
   b.recover();await b.refresh();assert.equal(b.get('allow').disabled,false);assert.equal(b.counts.approve,1);
  }
  assert.equal(h.calls.filter(n=>n==='create-order').length,0);
 }
 const h=await harness(t),v=await h.preview();h.advance(290000);const b=await browser(h,v,'normal');await b.click();
 assert.equal(h.service.store.get(v.id).approvedUntil,v.expires);assert(!b.get('status').textContent.includes('两分钟'));assert(b.get('status').textContent.includes(new Date(v.expires).toLocaleString()));
 h.advance(10001);const details=b.counts.details;await b.refresh();assert.equal(b.counts.details,details);assert.equal(b.get('allow').disabled,true);assert.match(b.get('status').textContent,/重新计价/);assert.equal(b.counts.approve,1);
});
