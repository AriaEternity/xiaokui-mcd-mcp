// 只解释已核实的query-order字段；不得把履约进展当作独立支付核验。
// 2026-10-19官方Schema说明数字字符串，实际只读返回同时使用中文orderStatus和另一套status编码。
type Data=Record<string,unknown>;
type OrderState='PENDING_PAYMENT'|'PREPARING'|'DELIVERING'|'COMPLETED'|'CANCELLED'|'REVIEWED'|'RESTAURANT_CONFIRMED'|'UNKNOWN';
const states:Record<string,{state:OrderState;name:string}>={
 '1':{state:'PENDING_PAYMENT',name:'待支付'},
 '2':{state:'PREPARING',name:'餐厅配餐中'},
 '4':{state:'DELIVERING',name:'配送中'},
 '6':{state:'COMPLETED',name:'订单已完成'},
 '7':{state:'CANCELLED',name:'已取消'},
 '8':{state:'REVIEWED',name:'已评价'},
 '10':{state:'RESTAURANT_CONFIRMED',name:'餐厅确认配餐中'},
 '待支付':{state:'PENDING_PAYMENT',name:'待支付'},
 '餐厅配餐中':{state:'PREPARING',name:'餐厅配餐中'},
 '订单已完成':{state:'COMPLETED',name:'订单已完成'},
 // 官方数字说明中的完整状态名称；不做包含匹配或猜测其他品牌枚举。
 '配餐中-已支付':{state:'PREPARING',name:'餐厅配餐中'},
 '配餐中-餐厅确认配餐中':{state:'RESTAURANT_CONFIRMED',name:'餐厅确认配餐中'},
 '配送中':{state:'DELIVERING',name:'配送中'},
 '已完成':{state:'COMPLETED',name:'订单已完成'},
 '已取消':{state:'CANCELLED',name:'已取消'},
 '已评价':{state:'REVIEWED',name:'已评价'},
 '餐厅确认配餐中':{state:'RESTAURANT_CONFIRMED',name:'餐厅确认配餐中'},
};
function rawStatus(value:unknown):string|number|null {
 if(typeof value==='string'&&value.trim()&&value.length<=128&&!/[\u0000-\u001f\u007f]/.test(value)&&!value.includes('[REDACTED]'))return value;
 if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=999)return value;
 return null;
}
const valueType=(v:unknown)=>v===null?'null':Array.isArray(v)?'array':typeof v;
// 取餐码只接受有界普通文字/数字；不返回HTML、控制字符或被脱敏的凭据片段。
const code=(v:unknown):string|undefined=>typeof v==='string'&&/^[\p{L}\p{N}][\p{L}\p{N} -]{0,127}$/u.test(v)&&!v.includes('[REDACTED]')?v:undefined;
const pickupStates=new Set<OrderState>(['PREPARING','DELIVERING','COMPLETED','REVIEWED','RESTAURANT_CONFIRMED']);
// 只供服务端在成功封装、绑定的订单号和授权归属均通过校验后调用。
// status不是orderStatus的同一枚举，不参与映射；payId、金额、用户声明不作为支付凭证。
// 当前官方契约没有独立支付确认字段。不接受自行猜测的paymentStatus/paid等额外字段。
export function mcdOrderQuerySummary(data:Data,officialQrUrl:(v:unknown)=>string|undefined) {
 const officialOrderStatus=rawStatus(data.orderStatus),officialStatus=rawStatus(data.status);
 const key=officialOrderStatus===null?'':String(officialOrderStatus).trim();
 const mapped=Object.hasOwn(states,key)?states[key]:undefined;
 const normalizedOrderStatus:OrderState=mapped?.state??'UNKNOWN';
 const hint=normalizedOrderStatus==='PENDING_PAYMENT'?'pending':key==='2'||key==='配餐中-已支付'?'paid':'not_provided';
 const fields=['pickupCode','lockerCode','lockerQrCode'] as const;
 const supplied=fields.some(k=>data[k]!==undefined&&data[k]!==null&&data[k]!=='');
 const pickup:Record<string,string>={};
 if(pickupStates.has(normalizedOrderStatus))for(const field of fields){
  const valid=field==='lockerQrCode'?officialQrUrl(data[field]):code(data[field]);
  if(valid)pickup[field]=valid;
 }
 const pickupInformationStatus=Object.keys(pickup).length?'available':!supplied?'not_provided':!pickupStates.has(normalizedOrderStatus)?'withheld':'invalid';
 const pickupNotice=pickupInformationStatus==='available'
  ?'取餐信息来自本次官方同一订单查询；不代表独立支付核验成功，已完成订单也不代表仍有餐品待取。'
  :pickupInformationStatus==='not_provided'?'本次官方查询未提供非空取餐码、柜码或柜二维码；请在麦当劳官方App或门店核实。'
  :pickupInformationStatus==='withheld'?'当前官方订单状态不满足取餐信息展示条件，已隐藏上游取餐字段；请在官方App或门店核实。'
  :'官方取餐字段未通过格式或官方HTTPS地址校验，已隐藏；请在官方App或门店核实。';
 return {
  officialOrderStatus,officialOrderStatusType:valueType(data.orderStatus),
  officialStatus,officialStatusType:valueType(data.status),
  normalizedOrderStatus,orderStatusName:mapped?.name??'未知状态',
  paymentStatus:normalizedOrderStatus==='PENDING_PAYMENT'?'pending':'unverified',
  paymentVerification:{status:'unverified',source:'not_provided'},
  orderStatusPaymentHint:hint,
  pickupInformationStatus,pickupInformationSource:'official_query_order',
  ...pickup,
  notice:'状态依据本次官方查询。query-order未提供独立支付确认字段，无法独立核验支付；这不代表用户未付款。'+
   (hint==='paid'?'官方状态说明含“已支付”，仅作为订单状态中的支付提示。':'')+pickupNotice,
 };
}
