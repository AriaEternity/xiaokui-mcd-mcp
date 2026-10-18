// 直接复用瑞幸v4本人会话/Origin/CSRF/私有nonce批准流程。
import type {FastifyInstance} from 'fastify';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import type {McdOrdersService} from '../../mcd/orders.js';
import type {SessionInspector} from '../../oauth/server.js';
import {mcdIntentPattern as intentPattern} from '../../mcp/mcd-policy.js';
function page(id:string,nonce:string){return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小葵 · 确认本笔麦当劳订单</title>
<style>body{font:17px/1.7 system-ui;background:#fff7fb;color:#30212c;margin:0}main{max-width:620px;margin:5vh auto;padding:24px}button,input{font:inherit;padding:12px;margin:8px 0}input{display:block;box-sizing:border-box;width:100%}button{cursor:pointer}#allow{background:#76264e;color:white;border:0;border-radius:8px}pre{white-space:pre-wrap}small{color:#5a4550}</style>
<main><h1>确认本笔麦当劳订单</h1><p>核对门店、规格、数量和实际应付后，批准小葵提交这笔订单。此页面不会付款。</p><p id="status">正在核验本人登录…</p><form id="login" hidden><label>本站账号<input id="user" autocomplete="username" required></label><label>密码<input id="password" type="password" autocomplete="current-password" required></label><button>使用原账户登录</button></form><section id="review" hidden><h2 id="shop"></h2><p id="address"></p><ul id="items"></ul><p id="money"></p><p id="discount"></p><small id="expires"></small><p>优惠券和套餐配置以本笔快照为准。报价变化会要求重新确认。批准后由本人打开官方付款链接自行支付。</p><button id="allow">确认本笔，允许小葵创建订单</button></section></main>
<script nonce="${nonce}">
const root='/api/mcd/orders/confirm/'+${JSON.stringify(id)},status=document.querySelector('#status'),login=document.querySelector('#login'),review=document.querySelector('#review');let csrf='',approvalNonce='';
async function load(){const session=await fetch('/api/v1/auth/session',{credentials:'same-origin',cache:'no-store'});if(!session.ok){login.hidden=false;review.hidden=true;status.textContent='请本人使用现有本站账户登录。';return;}csrf=(await session.json()).csrfToken;login.hidden=true;const response=await fetch(root+'/details',{credentials:'same-origin',cache:'no-store'});if(!response.ok){status.textContent='此确认链接无效、已过期、已处理或不属于当前账户。请回到ChatGPT重新预览。';review.hidden=true;return;}const data=await response.json();approvalNonce=data.nonce;document.querySelector('#shop').textContent=data.shop.name;document.querySelector('#address').textContent=data.shop.address;const items=document.querySelector('#items');items.replaceChildren();for(const item of data.products){const li=document.createElement('li');li.textContent=item.name+' × '+item.quantity+' · '+(item.configuration.length?item.configuration.join(' / '):'默认配置');items.append(li);}document.querySelector('#money').textContent='实际应付：¥'+data.payable.toFixed(2);document.querySelector('#discount').textContent='面价 ¥'+data.totalPrice.toFixed(2)+'，优惠 ¥'+data.discount.toFixed(2)+'，餐具费 ¥'+data.tablewareFee.toFixed(2)+'，打包费 ¥'+data.packingFee.toFixed(2)+'，取餐方式 '+data.takeWay.name;document.querySelector('#expires').textContent='报价有效至 '+new Date(data.expiresAt).toLocaleString();review.hidden=false;status.textContent='请核对本笔订单。批准后回到ChatGPT，让小葵继续提交。';}
login.addEventListener('submit',async event=>{event.preventDefault();const p=document.querySelector('#password');try{const response=await fetch('/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({username:document.querySelector('#user').value,password:p.value})});p.value='';if(!response.ok){status.textContent='登录未完成，请检查原账户信息。';return;}await load();}catch{p.value='';status.textContent='登录暂不可用。';}});
document.querySelector('#allow').addEventListener('click',async event=>{event.target.disabled=true;try{const response=await fetch(root+'/approve',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({nonce:approvalNonce})});if(!response.ok){status.textContent='批准未完成或报价已过期，请回到ChatGPT重新预览。';return;}review.hidden=true;status.textContent='本笔已批准，请在两分钟内回到ChatGPT让小葵继续提交。尚未创建或付款。';}catch{status.textContent='结果暂不可用，请刷新确认；不要重复创建订单。';}});load().catch(()=>{status.textContent='核验暂不可用，请稍后重试。';});
</script></html>`;}
export function registerMcdOrderConfirmation(app:FastifyInstance,options:{publicOrigin:string;service:McdOrdersService;inspectSession:SessionInspector}){
 app.register(async scope=>{
  await scope.register(rateLimit,{max:60,timeWindow:60000});
  scope.addHook('onSend',async(_req,reply)=>{reply.header('Cache-Control','no-store');reply.header('Referrer-Policy','no-referrer');});
  const root='/api/mcd/orders/confirm/:intentId';
  scope.get<{Params:{intentId:string}}>(root,async(req,reply)=>{if(!intentPattern.test(req.params.intentId))return reply.code(404).send({error:'not_found'});const nonce=randomBytes(24).toString('base64url');reply.header('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);return reply.type('text/html; charset=utf-8').send(page(req.params.intentId,nonce));});
  scope.get<{Params:{intentId:string}}>(root+'/details',async(req,reply)=>{
   const owner=await options.inspectSession(typeof req.headers.cookie==='string'?req.headers.cookie:'');if(!owner)return reply.code(403).send({error:'access_denied'});
   try{return options.service.review(req.params.intentId,owner.ownerId);}catch{return reply.code(404).send({error:'confirmation_unavailable'});}
  });
  scope.post<{Params:{intentId:string};Body:{nonce?:unknown}}>(root+'/approve',{bodyLimit:8192},async(req,reply)=>{
   if(req.headers.origin!==options.publicOrigin)return reply.code(403).send({error:'access_denied'});
   const owner=await options.inspectSession(typeof req.headers.cookie==='string'?req.headers.cookie:'');const supplied=req.headers['x-csrf-token'];
   if(!owner||typeof supplied!=='string'||supplied.length>256)return reply.code(403).send({error:'access_denied'});
   const a=Buffer.from(supplied),b=Buffer.from(owner.csrfToken);if(a.length!==b.length||!timingSafeEqual(a,b))return reply.code(403).send({error:'access_denied'});
   if(!req.body||Object.keys(req.body).length!==1||!Object.hasOwn(req.body,'nonce'))return reply.code(400).send({error:'invalid_request'});
   try{return await options.service.approve(req.params.intentId,owner.ownerId,req.body.nonce);}catch{return reply.code(409).send({error:'confirmation_not_completed'});}
  });
 });
}
