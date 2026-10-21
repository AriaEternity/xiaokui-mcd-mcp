// 沿用本人会话、Origin、CSRF、私有nonce；状态回读不会批准或创建。
import type {FastifyInstance} from 'fastify';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import type {McdOrdersService} from '../../mcd/orders.js';
import type {SessionInspector} from '../../oauth/server.js';
import {mcdIntentPattern as intentPattern} from '../../mcp/mcd-policy.js';
type ApprovalResult='approved'|'origin_denied'|'session_required'|'session_unavailable'|'csrf_denied'|'invalid_request'|'quote_expired'|'nonce_invalid'|'authorization_revoked'|'busy_or_uncertain'|'confirmation_not_completed';
function page(id:string,nonce:string){return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小葵 · 确认本笔麦当劳订单</title>
<style>body{font:17px/1.7 system-ui;background:#fff7fb;color:#30212c;margin:0}main{max-width:620px;margin:5vh auto;padding:24px}button,input{font:inherit;padding:12px;margin:8px 0}input{display:block;box-sizing:border-box;width:100%}button{cursor:pointer}button:disabled{opacity:.55;cursor:wait}#allow{background:#76264e;color:white;border:0;border-radius:8px}small{color:#5a4550}</style>
<main><h1>确认本笔麦当劳订单</h1><p>核对门店、规格、数量和实际应付后，批准小葵提交这笔订单。此页面不会付款。</p><p id="status" role="status">正在核验本人登录…</p><form id="login" hidden><label>本站主人账号<input id="user" autocomplete="username" required></label><label>密码<input id="password" type="password" autocomplete="current-password" required></label><button>使用原账户登录</button></form><section id="review" hidden><h2 id="shop"></h2><p id="address"></p><ul id="items"></ul><p id="money"></p><p id="discount"></p><small id="expires"></small><p>优惠券和套餐配置以本笔快照为准。报价变化会要求重新确认。批准后由本人打开官方付款链接自行支付。</p><button id="allow" disabled>确认本笔，允许小葵创建订单</button></section><button id="refresh" hidden>重新核验本笔状态</button></main>
<script nonce="${nonce}">
const root='/api/mcd/orders/confirm/'+${JSON.stringify(id)},status=document.querySelector('#status'),login=document.querySelector('#login'),review=document.querySelector('#review'),allow=document.querySelector('#allow'),refresh=document.querySelector('#refresh');let csrf='',approvalNonce='',busy=false;
const request=(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(10000)});
async function load(afterAttempt=false,reason=''){
 allow.disabled=true;review.hidden=true;approvalNonce='';refresh.hidden=false;
 const session=await request('/api/v1/auth/session',{credentials:'same-origin',cache:'no-store'});
 if(!session.ok){const missing=session.status===401||session.status===403;login.hidden=!missing;status.textContent=missing?'登录已失效或尚未登录，请本人使用现有本站账户登录，再核验本笔状态。':'本人会话服务暂不可用，请重新核验本笔状态；尚未确认批准结果。';return;}
 const identity=await session.json();if(typeof identity.csrfToken!=='string'||!identity.csrfToken)throw Error('session_invalid');csrf=identity.csrfToken;login.hidden=true;
 const response=await request(root+'/status',{credentials:'same-origin',cache:'no-store'});
 if(!response.ok){if(response.status===403){login.hidden=false;status.textContent='本人会话未通过校验，请重新登录后核验。';}else status.textContent=response.status===503?'本人会话服务暂不可用，请重新核验；尚未确认批准结果。':'无法核验本笔确认，链接可能无效、当前授权失效或不属于此账户。请回到ChatGPT检查连接；不要自动重试创建。';return;}
 const state=await response.json();
 if(state.creationStatus==='unknown'){status.textContent='本笔提交中或创建结果未知，必须本人核实官方账户；禁止重试创建或另建订单。';return;}
 if(state.creationStatus==='created'){status.textContent='本笔已有创建结果，请回到ChatGPT查询官方订单；不要重复创建。';return;}
 if(state.nextAction==='recalculate'){status.textContent='本笔报价或批准已到期，或快照需要更新；本笔未提交创建。请回到ChatGPT重新计价、预览并逐笔批准。';return;}
 if(state.state==='APPROVED'&&state.approvalStatus==='approved'&&typeof state.approvalExpiresAt==='string'&&Number.isFinite(Date.parse(state.approvalExpiresAt))){status.textContent='服务器已保存本笔批准，请在 '+new Date(state.approvalExpiresAt).toLocaleString()+' 前回到ChatGPT提交同一笔。尚未创建或付款；以服务器截止时间为准。';return;}
 if(state.state!=='PREVIEWED'||state.nextAction!=='approve'){status.textContent='本笔尚未准备好确认，请回到ChatGPT查询状态并预览。';return;}
 const details=await request(root+'/details',{credentials:'same-origin',cache:'no-store'});
 if(!details.ok){status.textContent='本笔状态刚刚变化或确认已不可用，请重新核验；不要自动重试创建。';return;}
 const data=await details.json();if(data.state!=='PREVIEWED'||data.quoteExpired||typeof data.nonce!=='string'||!data.nonce)throw Error('confirmation_invalid');approvalNonce=data.nonce;
 document.querySelector('#shop').textContent=data.shop.name;document.querySelector('#address').textContent=data.shop.address;
 const items=document.querySelector('#items');items.replaceChildren();for(const item of data.products){const li=document.createElement('li');li.textContent=item.name+' × '+item.quantity+' · '+(item.configuration.length?item.configuration.join(' / '):'默认配置');items.append(li);}
 document.querySelector('#money').textContent='实际应付：¥'+data.payable.toFixed(2);
 document.querySelector('#discount').textContent='面价 ¥'+data.totalPrice.toFixed(2)+'，优惠 ¥'+data.discount.toFixed(2)+'，餐具费 ¥'+data.tablewareFee.toFixed(2)+'，打包费 ¥'+data.packingFee.toFixed(2)+'，取餐方式 '+data.takeWay.name;
 document.querySelector('#expires').textContent='报价有效至 '+new Date(data.expiresAt).toLocaleString()+'；批准最迟也在此时到期。';
 review.hidden=false;allow.disabled=false;status.textContent=afterAttempt?reason+'服务器尚未保存本笔批准。请重新核对后再点击批准；尚未创建或付款。':'请核对本笔订单。批准成功后会显示服务器保存的实际截止时间。';
}
function unavailable(){allow.disabled=true;review.hidden=true;refresh.hidden=false;status.textContent='暂时无法核实服务器状态，请点击重新核验。不要自动重试创建；若已提交须先核实官方账户。';}
async function verify(){if(busy)return;busy=true;refresh.disabled=true;try{await load();}catch{unavailable();}finally{busy=false;refresh.disabled=false;}}
refresh.addEventListener('click',verify);
login.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;refresh.disabled=true;const p=document.querySelector('#password');try{const response=await request('/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({username:document.querySelector('#user').value,password:p.value})});p.value='';if(!response.ok){status.textContent='登录未完成，请检查原账户信息。';return;}await load();}catch{p.value='';unavailable();}finally{busy=false;refresh.disabled=false;}});
allow.addEventListener('click',async()=>{
 if(busy||allow.disabled)return;busy=true;allow.disabled=true;refresh.disabled=true;status.textContent='正在提交本笔批准并核验保存结果…';
 try{
  // 即使响应丢失，也只回读持久化状态；不自动重复批准，不触发创建。
  let reason='';try{const response=await request(root+'/approve',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({nonce:approvalNonce})});if(!response.ok)reason=response.status===403?'登录或安全校验未通过。':response.status===429?'确认请求过于频繁，请稍后再试。':'本次批准未完成。';await response.arrayBuffer();}catch{reason='未收到批准响应。';}
  await load(true,reason);
 }catch{unavailable();}finally{busy=false;refresh.disabled=false;}
});verify();
</script></html>`;}
export function registerMcdOrderConfirmation(app:FastifyInstance,options:{publicOrigin:string;service:McdOrdersService;inspectSession:SessionInspector}){
 app.register(async scope=>{
  await scope.register(rateLimit,{max:60,timeWindow:60000});
  scope.addHook('onSend',async(_req,reply)=>{reply.header('Cache-Control','no-store');reply.header('Referrer-Policy','no-referrer');});
  // 固定事件/结果码；不使用request.log，不输出路径、原始intent、身份或异常正文。
  const audit=(id:string,result:ApprovalResult)=>scope.log.info({event:'mcd_approval',intentRef:createHash('sha256').update(id).digest('hex').slice(0,24),result},'麦当劳逐笔批准结果。');
  const root='/api/mcd/orders/confirm/:intentId';
  scope.get<{Params:{intentId:string}}>(root,async(req,reply)=>{if(!intentPattern.test(req.params.intentId))return reply.code(404).send({error:'not_found'});const nonce=randomBytes(24).toString('base64url');reply.header('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);return reply.type('text/html; charset=utf-8').send(page(req.params.intentId,nonce));});
  for(const path of ['details','status'] as const)scope.get<{Params:{intentId:string}}>(root+'/'+path,async(req,reply)=>{
   if(!intentPattern.test(req.params.intentId))return reply.code(404).send({error:'confirmation_unavailable'});
   if(req.headers.origin!==undefined&&req.headers.origin!==options.publicOrigin)return reply.code(403).send({error:'origin_denied'});
   let owner;try{owner=await options.inspectSession(typeof req.headers.cookie==='string'?req.headers.cookie:'');}catch{return reply.code(503).send({error:'session_unavailable'});}
   if(!owner)return reply.code(403).send({error:'access_denied'});
   try{return path==='status'?options.service.confirmationStatus(req.params.intentId,owner.ownerId):options.service.review(req.params.intentId,owner.ownerId);}catch{return reply.code(404).send({error:'confirmation_unavailable'});}
  });
  scope.post<{Params:{intentId:string};Body:{nonce?:unknown}}>(root+'/approve',{bodyLimit:8192},async(req,reply)=>{
   const id=req.params.intentId;if(!intentPattern.test(id))return reply.code(404).send({error:'confirmation_unavailable'});
   const reject=(status:number,code:ApprovalResult)=>{audit(id,code);return reply.code(status).send({error:code});};
   if(req.headers.origin!==options.publicOrigin)return reject(403,'origin_denied');
   let owner;try{owner=await options.inspectSession(typeof req.headers.cookie==='string'?req.headers.cookie:'');}catch{return reject(503,'session_unavailable');}
   if(!owner)return reject(403,'session_required');
   const supplied=req.headers['x-csrf-token'];if(typeof supplied!=='string'||supplied.length>256)return reject(403,'csrf_denied');
   const a=Buffer.from(supplied),b=Buffer.from(owner.csrfToken);if(a.length!==b.length||!timingSafeEqual(a,b))return reject(403,'csrf_denied');
   if(!req.body||Array.isArray(req.body)||typeof req.body!=='object'||Object.keys(req.body).length!==1||!Object.hasOwn(req.body,'nonce'))return reject(400,'invalid_request');
   try{const result=await options.service.approve(id,owner.ownerId,req.body.nonce);audit(id,'approved');return result;}
   catch(e){const code=e instanceof Error?e.message:'';const result=code==='MCD_QUOTE_EXPIRED'?'quote_expired':code==='MCD_CONFIRMATION_INVALID'?'nonce_invalid':code==='MCD_AUTH_REVOKED'?'authorization_revoked':code==='INTENT_BUSY_OR_UNCERTAIN'?'busy_or_uncertain':'confirmation_not_completed';return reject(409,result);}
  });
 });
}
