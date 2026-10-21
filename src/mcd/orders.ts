import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {McdIntentStore} from './intent-store.js';
import {mcdOrderQuerySummary} from './order-status.js';
import {parseMcdCall,mcdFailure} from '../mcp/mcd-policy.js';
import type {McdReader,McdResult} from '../mcp/mcd-policy.js';
import type {McdIntentState,McdIntentStatus} from '../contracts/mcd-mcp.js';
export type McdBinding={ownerId:string;clientId:string;grantId:string;resource:string};
type Obj=Record<string,any>;
type Quote={shop:{storeCode:string;beCode?:string;name:string;address:string};products:{code:string;name:string;quantity:number;configuration:string[]}[];originalMinor:number;discountMinor:number;payableMinor:number;deliveryMinor:number;tablewareMinor:number;packingMinor:number;takeWays:unknown[];digest:string};
type Creation={orderId:string;payH5Url?:string;actualPayableMinor?:number;priceChanged:boolean};
export type McdIntent={version:1;id:string;binding:McdBinding;draft:Record<string,unknown>;quote:Quote;fingerprint:string;takeWayCode?:string;state:McdIntentState;createdAt:number;expires:number;nonce?:string;approvedUntil?:number;creation?:Creation};
const object=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max=512):string=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f]/.test(v))throw Error('MCD_RESPONSE_INVALID');return v;};
const minor=(v:unknown):number=>{if(!Number.isSafeInteger(v)||Number(v)<0)throw Error('MCD_AMOUNT_INVALID');return Number(v);};
const yuan=(v:unknown):number=>{if(typeof v!=='string'&&typeof v!=='number')throw Error('MCD_AMOUNT_INVALID');const m=/^(0|[1-9]\d{0,10})(?:\.(\d{1,2}))?$/.exec(String(v));if(!m)throw Error('MCD_AMOUNT_INVALID');const n=Number(m[1])*100+Number((m[2]??'').padEnd(2,'0'));if(!Number.isSafeInteger(n))throw Error('MCD_AMOUNT_INVALID');return n;};
function stable(v:unknown):string {if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
const digest=(v:unknown)=>createHash('sha256').update(stable(v)).digest('hex');
const same=(a:McdBinding,b:McdBinding)=>['ownerId','clientId','grantId','resource'].every(k=>a[k as keyof McdBinding]===b[k as keyof McdBinding]);
const takeWay=(q:Quote,code:string|undefined)=>{const w=q.takeWays.find(w=>object(w)&&(w.code===code));return object(w)?{code,name:text(w.title,128)}:undefined;};
const ok=(data:Obj):McdResult=>({isError:false,content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data});
export function mcdData(result:McdResult):unknown {
 if(result.isError)throw Error('MCD_UPSTREAM_FAILED');const candidates=new Map<string,unknown>();
 const add=(v:unknown)=>{if(object(v)&&v.success===true&&v.code===200&&Object.hasOwn(v,'data'))candidates.set(stable(v.data),v.data);};
 for(const block of result.content)try{add(JSON.parse(block.text));}catch{}
 add(result.structuredContent);if(candidates.size!==1)throw Error('MCD_RESPONSE_INVALID');return [...candidates.values()][0];
}
export function mcdPaymentUrl(v:unknown):string|undefined {
 if(typeof v!=='string'||v.length>8192||/[\u0000-\u0020<>"'`]/.test(v)||v.includes('[REDACTED]'))return;
 try{const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443'))return;
 // 生产仅放行麦当劳官方HTTPS域；文档中的sit/uat示例不作为可付款入口。
 if(/(?:^|[.-])(sit|uat|test)(?:[.-]|$)/i.test(u.hostname))return;
 if(!['mcd.cn','mcdchina.net'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))return;
 return v;}catch{return;}
}
// 将默认选项和用户更改解析为官方明确的完整请求；code重复的冰量选项由key区分。
function modifications(detail:Obj,selected:unknown):{request?:Obj;labels:string[]} {
 if(detail.supportModify!==true){if(selected!==undefined)throw Error('MCD_SELECTION_INVALID');return {labels:[]};}
 const groups=detail.modification?.items;if(!Array.isArray(groups))throw Error('MCD_SELECTION_UNVERIFIED');
 if(selected!==undefined&&(!object(selected)||!Array.isArray(selected.values)))throw Error('MCD_SELECTION_INVALID');
 const supplied:Obj[]=selected===undefined?[]:(selected as Obj).values,used=new Set<number>(),values:Obj[]=[],labels:string[]=[];
 for(const group of groups){
  if(!Array.isArray(group.values)||!Number.isSafeInteger(group.minValues)||!Number.isSafeInteger(group.maxValues))throw Error('MCD_SELECTION_UNVERIFIED');
  const choices:Obj[]=group.values;
  const matching=supplied.map((v,i)=>({v,i,options:choices.filter(o=>o.code===v.code&&(v.quantity>0?o.selectedKey===v.key:o.unselectedKey===v.key))})).filter(x=>x.options.length);
  if(matching.some(x=>x.options.length!==1||used.has(x.i)))throw Error('MCD_SELECTION_INVALID');
  const configured=matching.length>0;let total=0;
  for(const option of choices){
   const matches=matching.filter(x=>x.options[0]===option);if(matches.length>1)throw Error('MCD_SELECTION_INVALID');
   const picked=matches[0];if(picked)used.add(picked.i);
   const q=picked?picked.v.quantity:configured?0:option.selectedQuantity;
   if(!Number.isSafeInteger(q)||!Number.isSafeInteger(option.minQuantity)||!Number.isSafeInteger(option.maxQuantity)||q<option.minQuantity||q>option.maxQuantity)throw Error('MCD_SELECTION_INVALID');
   total+=q;
   const key=q>0?option.selectedKey:option.unselectedKey;
   if(q>0||(typeof key==='string'&&key.length>0)){values.push({code:text(option.code,128),quantity:q,key:text(key,128)});labels.push(text(option.name)+' × '+q);}
  }
  if(total<group.minValues||total>group.maxValues)throw Error('MCD_SELECTION_INVALID');
 }
 if(used.size!==supplied.length)throw Error('MCD_SELECTION_INVALID');
 return {request:{values},labels};
}
function productSummary(detail:Obj,item:Obj):Quote['products'][number] {
 if(detail.code!==item.productCode)throw Error('MCD_PRODUCT_MISMATCH');
 const main=modifications(detail,item.modification);if(main.request)item.modification=main.request;
 const configuration=[...main.labels];
 if(!Array.isArray(detail.rounds))throw Error('MCD_COMBO_CONTRACT_UNVERIFIED');
 if(item.roundList!==undefined&&!Array.isArray(item.roundList))throw Error('MCD_SELECTION_INVALID');
 const supplied:Obj[]=item.roundList??[],roundList:Obj[]=[],seen=new Set<string>();
 for(const group of detail.rounds){
  if(!Number.isSafeInteger(group.id)||!Array.isArray(group.choices)||!Number.isSafeInteger(group.minQuantity)||!Number.isSafeInteger(group.maxQuantity))throw Error('MCD_COMBO_CONTRACT_UNVERIFIED');
  const round=String(group.id),requested=supplied.filter(r=>r.round===round);if(requested.length>1||seen.has(round))throw Error('MCD_SELECTION_INVALID');seen.add(round);
  const selection:Obj[]=requested[0]?.comboItemList??group.choices.filter((c:Obj)=>c.quantity>0).map((c:Obj)=>({code:c.code,quantity:c.quantity}));
  const codes=new Set<string>(),comboItemList:Obj[]=[];let count=0;
  for(const choice of selection){
   if(codes.has(choice.code))throw Error('MCD_SELECTION_INVALID');codes.add(choice.code);
   const options=group.choices.filter((o:Obj)=>o.code===choice.code);if(options.length!==1)throw Error('MCD_SELECTION_UNVERIFIED');const option=options[0];
   if(!Number.isSafeInteger(choice.quantity)||choice.quantity<1||!Number.isSafeInteger(option.maxQuantity)||(option.maxQuantity!==-1&&choice.quantity>option.maxQuantity))throw Error('MCD_SELECTION_INVALID');count+=choice.quantity;
   const mod=modifications(option,choice.modification);comboItemList.push({code:choice.code,quantity:choice.quantity,...(mod.request?{modification:mod.request}:{})});
   configuration.push(text(group.name)+'：'+text(option.name)+' × '+choice.quantity,...mod.labels);
  }
  if(count<group.minQuantity||count>group.maxQuantity)throw Error('MCD_SELECTION_INVALID');roundList.push({round,comboItemList});
 }
 if(supplied.some(r=>!seen.has(r.round)))throw Error('MCD_SELECTION_INVALID');
 if(roundList.length)item.roundList=roundList;
 return {code:item.productCode,name:text(detail.name),quantity:item.quantity,configuration};
}
export class McdOrdersService {
 readonly store:McdIntentStore;readonly origin:string;readonly #stores=new Map<string,Quote['shop']>();
 constructor(private options:{root:string;publicOrigin:string;reader:McdReader;active:(binding:McdBinding)=>boolean;createEnabled?:boolean;now?:()=>number}){this.store=new McdIntentStore(options.root);this.origin=options.publicOrigin;}
 private now(){return (this.options.now??Date.now)();}
 private active(binding:McdBinding){if(!this.options.active(binding))throw Error('MCD_AUTH_REVOKED');}
 private owned(id:string,binding:McdBinding){this.active(binding);const v=this.store.get(id);if(!same(v.binding,binding))throw Error('MCD_INTENT_NOT_FOUND');return v;}
 private storeKey(b:McdBinding,code:unknown){return b.ownerId+'/'+b.grantId+'/'+String(code);}
 private status(v:McdIntent):McdIntentStatus {
  const now=this.now(),quoteExpired=v.expires<=now;
  const unknown=v.state==='SUBMITTING'||v.state==='UNKNOWN',created=v.state==='CREATED'&&!!v.creation;
  const approvalStatus:McdIntentStatus['approvalStatus']=unknown||created||v.state==='REQUOTE_REQUIRED'?'consumed':v.state==='APPROVED'?(quoteExpired||!v.approvedUntil||v.approvedUntil<=now?'expired':'approved'):v.state==='PREVIEWED'?(quoteExpired?'expired':'required'):'not_requested';
  return {state:v.state==='SUBMITTING'?'UNKNOWN':v.state,serverTime:new Date(now).toISOString(),quoteExpired,approvalStatus,
   ...(v.approvedUntil?{approvalExpiresAt:new Date(v.approvedUntil).toISOString()}:{}),
   creationStatus:unknown?'unknown':created?'created':'not_submitted',officialOrderKnown:!!v.creation?.orderId,
   nextAction:unknown?'owner_reconciliation':created?'query_official_order':quoteExpired||v.state==='REQUOTE_REQUIRED'||approvalStatus==='expired'?'recalculate':approvalStatus==='approved'?'submit':v.state==='PREVIEWED'?'approve':'prepare'};
 }
 private statusNotice(s:McdIntentStatus):string {
  if(s.creationStatus==='unknown')return '创建结果未知或提交尚未完成，必须本人核实官方账户；禁止重试创建、另建intent或删除状态与锁。';
  if(s.creationStatus==='created')return '已有创建结果，请查询本笔官方订单；不得重新创建。';
  if(s.nextAction==='recalculate')return '本笔报价、批准已过期或快照需更新；本笔未提交创建，请重新计价、预览并由本人逐笔批准。';
  if(s.nextAction==='submit')return '本笔已由本人批准，请在实际批准截止时间前提交同一intent；尚未创建或付款，提交时仍会复核报价。';
  if(s.nextAction==='prepare')return '本笔仅完成计价，尚未批准或创建；请从报价返回的取餐方式选择后prepare-order。';
  return '本笔尚未批准或创建；请核对门店、每个套餐配置、数量、优惠、费用与实际应付，由本人打开受保护页面逐笔批准。';
 }
 private summary(v:McdIntent):Obj {const status=this.status(v);return {intentId:v.id,quoteId:v.id,...status,expiresAt:new Date(v.expires).toISOString(),currency:'CNY',unit:'yuan',shop:v.quote.shop,products:v.quote.products,totalPrice:v.quote.originalMinor/100,discount:v.quote.discountMinor/100,payable:v.quote.payableMinor/100,deliveryFee:v.quote.deliveryMinor/100,tablewareFee:v.quote.tablewareMinor/100,packingFee:v.quote.packingMinor/100,needTableware:v.draft.needTableware??false,takeWayCode:v.takeWayCode,takeWay:takeWay(v.quote,v.takeWayCode),orderType:1,beType:1,creationEnabled:this.options.createEnabled===true,...(status.nextAction==='approve'?{confirmationUrl:this.origin+'/api/mcd/orders/confirm/'+v.id}:{}),notice:this.statusNotice(status)};}
 private created(v:McdIntent):Obj {const c=v.creation!;return {...this.summary(v),orderId:c.orderId,...(c.payH5Url?{payH5Url:c.payH5Url}:{}),paymentLinkUnavailable:!c.payH5Url,actualPayable:c.actualPayableMinor===undefined?undefined:c.actualPayableMinor/100,priceChanged:c.priceChanged,paymentStatus:'unverified',notice:!c.payH5Url?'订单已创建，但官方付款链接未返回或未通过校验；请在麦当劳App核实本笔订单，不得重新创建。':c.priceChanged?'订单已创建，但返回金额与批准报价不同或无法核实；请在官方付款页核对，禁止重新创建。':'订单已创建。请本人打开官方付款链接完成支付，再查询官方订单状态。不得把建单当作已支付。'};}
 private fingerprint(binding:McdBinding,draft:Record<string,unknown>){const items=[...(draft.items as Obj[])].sort((a,b)=>stable(a).localeCompare(stable(b)));return digest({ownerId:binding.ownerId,draft:{...draft,items}});}
 private preventUnknown(binding:McdBinding){if(this.store.list().some(v=>v.binding.ownerId===binding.ownerId&&(v.state==='SUBMITTING'||v.state==='UNKNOWN')))throw Error('MCD_UNKNOWN_ORDER_REQUIRES_OWNER_RECONCILIATION');}
 private async quote(binding:McdBinding,draft:Record<string,unknown>,signal?:AbortSignal,savedShop?:Quote['shop']):Promise<Quote> {
  const shop=savedShop??this.#stores.get(this.storeKey(binding,draft.storeCode));if(!shop||shop.storeCode!==draft.storeCode)throw Error('MCD_REFRESH_STORE_REQUIRED');
  const products:Quote['products']=[];
  for(const item of draft.items as Obj[]){const raw=mcdData(await this.options.reader.call('query-meal-detail',{storeCode:draft.storeCode,orderType:1,beType:1,code:item.productCode},signal));if(!object(raw))throw Error('MCD_RESPONSE_INVALID');products.push(productSummary(raw,item));}
  const d=mcdData(await this.options.reader.call('calculate-price',draft,signal));if(!object(d)||!Array.isArray(d.productList))throw Error('MCD_RESPONSE_INVALID');
  const basket=(rows:Obj[],field:string)=>stable(rows.map(p=>({code:p[field],quantity:p.quantity})).sort((a,b)=>stable(a).localeCompare(stable(b))));
  if(basket(d.productList,'productCode')!==basket(draft.items as Obj[],'productCode'))throw Error('MCD_PRODUCT_MISMATCH');
  if(d.productList.some((p:Obj)=>products.find(x=>x.code===p.productCode)?.name!==p.productName))throw Error('MCD_PRODUCT_MISMATCH');
  const originalMinor=minor(d.originalPrice),discountMinor=minor(d.discount),payableMinor=minor(d.price),deliveryMinor=d.deliveryPrice===undefined?0:minor(d.deliveryPrice),tablewareMinor=d.tablewarePrice===undefined?0:minor(d.tablewarePrice);
  if(originalMinor-discountMinor!==payableMinor||deliveryMinor!==0)throw Error('MCD_AMOUNT_MISMATCH');
  if(!Array.isArray(d.takeWayList)||!d.takeWayList.length||d.takeWayList.length>30)throw Error('MCD_TAKEWAY_CONTRACT_UNVERIFIED');
  const packingMinor=d.packingPrice===undefined?0:minor(d.packingPrice);
  if(minor(d.productPrice)+deliveryMinor+tablewareMinor+packingMinor!==payableMinor)throw Error('MCD_AMOUNT_MISMATCH');
  const basis={shop,products,originalMinor,discountMinor,payableMinor,deliveryMinor,tablewareMinor,packingMinor,takeWays:d.takeWayList};
  return {...basis,digest:digest({draft,...basis})};
 }
 async call(binding:McdBinding,name:unknown,args:unknown,signal?:AbortSignal):Promise<McdResult> {
  const checked=parseMcdCall(name,args);signal=signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000);
  try{this.active(binding);
   if(checked.name==='calculate-price'){
    this.preventUnknown(binding);const quote=await this.quote(binding,checked.args,signal);this.active(binding);
    const v:McdIntent={version:1,id:randomUUID(),binding:{...binding},draft:checked.args,quote,fingerprint:this.fingerprint(binding,checked.args),state:'QUOTED',createdAt:this.now(),expires:this.now()+300000};this.store.create(v);
    return ok({...this.summary(v),takeWayList:quote.takeWays,notice:'从此报价返回的takeWayList选择takeWayCode，再调用prepare-order；尚未批准或创建。'});
   }
   if(checked.name==='prepare-order')return ok(await this.prepare(String(checked.args.quoteId),String(checked.args.takeWayCode),binding));
   if(checked.name==='create-order')return ok(await this.submit(String(checked.args.intentId),binding,signal));
   if(checked.name==='query-order')return ok(await this.query(String(checked.args.intentId),binding,signal));
   const result=await this.options.reader.call(checked.name,checked.args,signal);this.active(binding);
   if(checked.name==='query-nearby-stores'&&!result.isError){const rows=mcdData(result);if(!Array.isArray(rows))throw Error('MCD_RESPONSE_INVALID');for(const row of rows){if(!object(row))continue;const shop={storeCode:text(row.storeCode,128),name:text(row.storeName),address:typeof row.address==='string'?row.address:''};if(this.#stores.size>=256)this.#stores.delete(this.#stores.keys().next().value!);this.#stores.set(this.storeKey(binding,shop.storeCode),shop);}}
   return result;
  }catch(e){const code=e instanceof Error&&/^(MCD|INTENT)_[A-Z_]+$/.test(e.message)?e.message:'MCD_TEMPORARILY_UNAVAILABLE';return mcdFailure(code);}
 }
 private async prepare(id:string,code:string,binding:McdBinding){return this.store.lock(id,async()=>{this.preventUnknown(binding);const v=this.owned(id,binding);if(v.state!=='QUOTED')throw Error('MCD_INTENT_ALREADY_PREPARED');if(v.expires<=this.now())throw Error('MCD_QUOTE_EXPIRED');
  const matches=v.quote.takeWays.filter(w=>object(w)&&w.code===code);if(matches.length!==1||!takeWay(v.quote,code))throw Error('MCD_TAKEWAY_INVALID');
  v.takeWayCode=code;v.state='PREVIEWED';v.nonce=randomBytes(32).toString('base64url');this.store.put(v);return this.summary(v);
 });}
 confirmationStatus(id:string,ownerId:string):McdIntentStatus&{notice:string}{const v=this.store.get(id);this.active(v.binding);if(v.binding.ownerId!==ownerId)throw Error('MCD_CONFIRMATION_UNAVAILABLE');const status=this.status(v);return {...status,notice:this.statusNotice(status)};}
 private confirmable(v:McdIntent,ownerId:string){this.active(v.binding);if(v.binding.ownerId!==ownerId||v.state!=='PREVIEWED')throw Error('MCD_CONFIRMATION_UNAVAILABLE');if(v.expires<=this.now())throw Error('MCD_QUOTE_EXPIRED');}
 review(id:string,ownerId:string){const v=this.store.get(id);this.confirmable(v,ownerId);return {...this.summary(v),nonce:v.nonce};}
 async approve(id:string,ownerId:string,nonce:unknown){return this.store.lock(id,async()=>{const v=this.store.get(id);this.confirmable(v,ownerId);if(typeof nonce!=='string'||!v.nonce||Buffer.byteLength(nonce)!==Buffer.byteLength(v.nonce)||!timingSafeEqual(Buffer.from(nonce),Buffer.from(v.nonce)))throw Error('MCD_CONFIRMATION_INVALID');v.state='APPROVED';v.approvedUntil=Math.min(v.expires,this.now()+120000);delete v.nonce;this.store.put(v);return this.status(v);});}
 private submissionApproval(v:McdIntent){if(v.expires<=this.now())throw Error('MCD_QUOTE_EXPIRED');if(v.state!=='APPROVED'||!v.approvedUntil)throw Error('MCD_APPROVAL_REQUIRED');if(v.approvedUntil<=this.now())throw Error('MCD_APPROVAL_EXPIRED');}
 private async submit(id:string,binding:McdBinding,signal?:AbortSignal){
  // 主人级锁串行化所有本品牌提交，防止另一个intent绕过未知结果或并发重建同一餐单。
  return this.store.lock('00000000-0000-4000-8000-000000000000',async()=>this.store.lock(id,async()=>{
   const v=this.owned(id,binding);if(v.state==='CREATED'&&v.creation)return this.created(v);this.preventUnknown(binding);
   if(this.options.createEnabled!==true)throw Error('MCD_CREATE_DISABLED');this.submissionApproval(v);
   const duplicate=this.store.list().find(x=>x.id!==id&&x.binding.ownerId===binding.ownerId&&x.fingerprint===v.fingerprint&&x.state==='CREATED'&&this.now()-x.createdAt<300000);if(duplicate)throw Error('MCD_DUPLICATE_RECENT_ORDER');
   const current=await this.quote(binding,v.draft,signal,v.quote.shop);if(current.digest!==v.quote.digest){v.state='REQUOTE_REQUIRED';delete v.approvedUntil;this.store.put(v);throw Error('MCD_QUOTE_CHANGED_RECONFIRM');}
   this.active(binding);this.submissionApproval(v);if(signal?.aborted)throw Error('MCD_SUBMISSION_CANCELLED');
   const upstream=parseMcdCall('create-order',{...v.draft,takeWayCode:v.takeWayCode},true).args;
   v.state='SUBMITTING';delete v.approvedUntil;this.store.put(v);
   try{const d=mcdData(await this.options.reader.call('create-order',upstream,signal));if(!object(d))throw Error('MCD_RESPONSE_INVALID');const orderId=text(d.orderId,128);if(!/^[A-Za-z0-9_-]+$/.test(orderId))throw Error('MCD_ORDER_ID_INVALID');
    const payH5Url=mcdPaymentUrl(d.payH5Url);let actual:number|undefined;try{actual=yuan(d.orderDetail?.realTotalAmount);}catch{}
    v.creation={orderId,...(payH5Url?{payH5Url}:{}),...(actual===undefined?{}:{actualPayableMinor:actual}),priceChanged:actual===undefined||actual!==v.quote.payableMinor};v.state='CREATED';this.store.put(v);return this.created(v);
   }catch{v.state='UNKNOWN';this.store.put(v);throw Error('MCD_RESULT_UNKNOWN_DO_NOT_RETRY');}
  }));
 }
 private async query(id:string,binding:McdBinding,signal?:AbortSignal){const v=this.owned(id,binding);if(v.state!=='CREATED'||!v.creation)return this.summary(v);
  const d=mcdData(await this.options.reader.call('query-order',{orderId:v.creation.orderId},signal));if(!object(d)||d.orderId!==v.creation.orderId)throw Error('MCD_ORDER_ID_MISMATCH');
  return {intentId:id,orderId:v.creation.orderId,...mcdOrderQuerySummary(d,mcdPaymentUrl)};
 }
}
