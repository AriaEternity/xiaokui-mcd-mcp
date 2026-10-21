import {McpError,ErrorCode} from '@modelcontextprotocol/sdk/types.js';
import {mcdTools} from '../contracts/mcd-mcp.js';
import type {McdToolFailure} from '../contracts/mcd-mcp.js';
export type McdResult = {content:{type:'text';text:string}[];structuredContent?:Record<string,unknown>;isError:boolean};
export interface McdReader {call(name:unknown,args:unknown,signal?:AbortSignal):Promise<McdResult>}
export const mcdIntentPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const failures:Record<string,Omit<McdToolFailure,'code'>>={
 MCD_APPROVAL_REQUIRED:{message:'本笔尚未取得有效的服务器逐笔批准，本次未发送官方创建请求。请先查询本笔状态，由本人在有效确认页核对并批准；聊天或OAuth确认不能代替。',creationRequestStatus:'not_sent'},
 MCD_QUOTE_EXPIRED:{message:'本笔报价已过期，本次未发送官方创建请求。请重新计价、预览，并由本人逐笔批准。',creationRequestStatus:'not_sent'},
 MCD_APPROVAL_EXPIRED:{message:'本笔批准已到期，本次未发送官方创建请求。请重新计价、预览，并由本人逐笔批准。',creationRequestStatus:'not_sent'},
 MCD_CREATE_DISABLED:{message:'服务端尚未启用真实创建，本次未发送官方创建请求。',creationRequestStatus:'not_sent'},
 MCD_QUOTE_CHANGED_RECONFIRM:{message:'提交前复核发现报价或配置变化，本次未发送官方创建请求。请重新计价并由本人核对批准。',creationRequestStatus:'not_sent'},
 MCD_SUBMISSION_CANCELLED:{message:'本次提交在发送官方创建请求前已取消或超时。请先查询本笔状态，不自动重试创建。',creationRequestStatus:'not_sent'},
 MCD_DUPLICATE_RECENT_ORDER:{message:'已有近期相同餐单的创建记录，本次未发送新的创建请求。请核实已有订单，不要重复下单。',creationRequestStatus:'not_sent'},
 MCD_BUSY:{message:'本地上游适配器已有两个在途请求。请串行或最多并行两次只读查询；不要将只读重试策略用于创建订单。'},
 MCD_INTENT_ALREADY_PREPARED:{message:'本笔已进入确认或提交阶段，不能再次prepare-order。请先query-order核实本笔状态，不要重复创建或直接另建订单。'},
 MCD_RESULT_UNKNOWN_DO_NOT_RETRY:{message:'官方创建请求可能已被受理，但结果无法核实。必须本人核实官方账户，禁止重试创建、另建intent或删除状态与锁。',creationRequestStatus:'unknown'},
 MCD_UNKNOWN_ORDER_REQUIRES_OWNER_RECONCILIATION:{message:'该本人有尚未核实的提交或UNKNOWN记录，必须先核实官方账户；禁止重试创建或另建intent绕过。',creationRequestStatus:'unknown'},
 INTENT_BUSY_OR_UNCERTAIN:{message:'本笔记录繁忙或存在未解决的锁，不能据此判断创建结果。请查询状态并由本人核实，禁止删除锁或自动重试创建。'},
 MCD_AUTH_REVOKED:{message:'本笔绑定的OAuth授权已失效，请检查连接授权；新的OAuth授权不能代替逐笔批准。'},
};
export const mcdFailure=(code:string):McdResult=>({isError:true,content:[{type:'text',text:JSON.stringify({code,...(Object.hasOwn(failures,code)?failures[code]:{message:'麦当劳请求未完成。请先查询本笔状态，再判断下一步；不要自动重试创建订单。'})})}]});
type Schema={type?:string;properties?:Record<string,Schema>;required?:string[];additionalProperties?:boolean;enum?:unknown[];minimum?:number;maximum?:number;minLength?:number;maxLength?:number;format?:string;items?:Schema;minItems?:number;maxItems?:number;anyOf?:Schema[]};
// 同一份有界公开 Schema 用于路由、SDK handler 和固定上游白名单，不作参数转换。
function valid(s:Schema,v:unknown):boolean {
  if(s.anyOf)return s.anyOf.some(x=>valid(x,v));
  if(s.enum&&!s.enum.includes(v))return false;
  if(s.type==='object')return !!v&&typeof v==='object'&&!Array.isArray(v)&&(s.required??[]).every(k=>Object.hasOwn(v,k))&&Object.entries(v).every(([k,x])=>Object.hasOwn(s.properties??{},k)&&valid(s.properties![k]!,x));
  if(s.type==='array')return Array.isArray(v)&&v.length>=(s.minItems??0)&&v.length<=(s.maxItems??100)&&v.every(x=>valid(s.items!,x));
  if(s.type==='string')return typeof v==='string'&&v.trim().length>=(s.minLength??0)&&v.length<=(s.maxLength??1024)&&!/[\u0000-\u001f\u007f]/.test(v)&&(s.format!=='uuid'||mcdIntentPattern.test(v));
  if(s.type==='number'||s.type==='integer')return typeof v==='number'&&Number.isFinite(v)&&(s.type!=='integer'||Number.isSafeInteger(v))&&v>=(s.minimum??-Infinity)&&v<=(s.maximum??Infinity);
  if(s.type==='boolean')return typeof v==='boolean';
  return false;
}
export function parseMcdCall(name:unknown,value:unknown,upstream=false):{name:string;args:Record<string,unknown>} {
  const fail=():never=>{throw new McpError(ErrorCode.InvalidParams,'仅允许即时到店点餐白名单；创建与查询仅接受intentId。');};
  if(typeof name!=='string')return fail();
  let schema=mcdTools.find(t=>t.name===name)?.inputSchema as Schema|undefined;
  if(upstream){
    if(name==='prepare-order')return fail();
    if(name==='query-order')schema={type:'object',properties:{orderId:{type:'string',minLength:1,maxLength:128}},required:['orderId']};
    if(name==='create-order'){
      const price=mcdTools.find(t=>t.name==='calculate-price')!.inputSchema;
      const properties=price.properties;
      schema={type:'object',properties:{...properties,takeWayCode:{type:'string',minLength:1,maxLength:128}},required:['storeCode','orderType','beType','items','takeWayCode']} as Schema;
    }
  }
  if(!schema||!valid(schema,value))return fail();
  const args=structuredClone(value) as Record<string,unknown>;
  if(name==='query-nearby-stores'&&((args.searchType===2&&(!args.city||!args.keyword))||(args.searchType===3&&(args.longitude===undefined||args.latitude===undefined))))return fail();
  return {name,args};
}
