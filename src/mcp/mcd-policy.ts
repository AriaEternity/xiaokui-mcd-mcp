import {McpError,ErrorCode} from '@modelcontextprotocol/sdk/types.js';
import {mcdTools} from '../contracts/mcd-mcp.js';
export type McdResult = {content:{type:'text';text:string}[];structuredContent?:Record<string,unknown>;isError:boolean};
export interface McdReader {call(name:unknown,args:unknown,signal?:AbortSignal):Promise<McdResult>}
export const mcdIntentPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const mcdFailure=(code:string):McdResult=>({isError:true,content:[{type:'text',text:JSON.stringify({code,message:'麦当劳接口暂不可用；创建结果未知时请本人核实官方账户，禁止自动重试。'})}]});
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
