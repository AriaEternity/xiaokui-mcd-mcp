// 固定地址、SDK传输、有界结果与凭据清理由已上线瑞幸v4适配器复用。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { mcdMcp } from "../contracts/mcd-mcp.js";
import { parseMcdCall, mcdFailure } from "./mcd-policy.js";
import type { McdReader, McdResult } from "./mcd-policy.js";

const MAX_WIRE=512*1024, MAX_RESULT=256*1024;
const jsonEscapes:Readonly<Record<string,string>>={'"':'"',"\\":"\\","/":"/",b:"\b",f:"\f",n:"\n",r:"\r",t:"\t"};
function containsCredential(text:string,token:string):boolean {
  // 只在检查副本中逐层解码 JSON 转义，覆盖不完整 JSON 和 Unicode 回显；不改写商品文本。
  for(let depth=0;depth<=20;depth++) {
    if(text.includes(token)) return true;
    const decoded=text.replace(/\\(?:u([0-9a-fA-F]{4})|(["\\/bfnrt]))/g,(_match,unicode:string|undefined,short:string|undefined)=>unicode!==undefined?String.fromCharCode(Number.parseInt(unicode,16)):jsonEscapes[short!]!);
    if(decoded===text) return false;
    text=decoded;
  }
  throw new Error("MCD_RESULT_INVALID");
}
function clean(value: unknown, token: string, depth=0): unknown {
  if(depth>64) throw new Error("MCD_RESULT_INVALID");
  if(typeof value==="string") {
    // 上游文本可再次包装 JSON；先解开合法对象、数组或字符串，逐层清理后保留文本形态。
    let decoded: unknown;
    if(/^[\s]*[\[{"]/.test(value)) {
      try {decoded=JSON.parse(value);}catch{/* 非 JSON 商品文本仍按字符串清理。 */}
      if(typeof decoded==="string" || (decoded!==null && typeof decoded==="object")) return JSON.stringify(clean(decoded,token,depth+1));
    }
    return value.split(token).join("[REDACTED]").replace(/Bearer\s+[^\s"<>]+/gi,"Bearer [REDACTED]");
  }
  if(Array.isArray(value)) return value.map(v=>clean(v,token,depth+1));
  // 丢弃含凭据的键而不重命名，避免清理后键冲突覆盖正常商品数据。
  if(value && typeof value==="object") return Object.fromEntries(Object.entries(value).filter(([k])=>!k.includes(token) && !/token|authorization|secret|password|cookie|session/i.test(k)).map(([k,v])=>[k,clean(v,token,depth+1)]));
  return value;
}
function businessFailed(value: unknown, depth=0): boolean {
  if(depth>15) return true;
  if(typeof value==="string" && /^[\s]*[{[]/.test(value)) {
    try { return businessFailed(JSON.parse(value),depth+1); } catch { return false; }
  }
  if(Array.isArray(value)) return value.some(v=>businessFailed(v,depth+1));
  if(value && typeof value==="object") {
    const v=value as Record<string,unknown>;
    if(v.success===false || (typeof v.code==="number" && v.code!==200 && (Object.hasOwn(v,"msg")||Object.hasOwn(v,"message")))) return true;
    return Object.values(v).some(item=>businessFailed(item,depth+1));
  }
  return false;
}
export class McdMcpClient implements McdReader {
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #timeout: number;
  #active=0;
  constructor(options: {token:string; transport?:typeof fetch; timeoutMs?:number}) {
    if(!/^[\x21-\x7e]{1,8192}$/.test(options.token)) throw new Error("MCD_CREDENTIAL_INVALID");
    const timeout=options.timeoutMs??20000;
    if(!Number.isSafeInteger(timeout)||timeout<1||timeout>25000) throw new Error("MCD_CONFIG_INVALID");
    this.#token=options.token;this.#fetch=options.transport??fetch;this.#timeout=timeout;
  }
  async call(name: unknown, args: unknown, signal?: AbortSignal): Promise<McdResult> {
    const parse=(name:unknown,args:unknown)=>parseMcdCall(name,args,true);
    const inspect=name==='__inspectTools';
    const checked=inspect?{name:'__inspectTools',args:{}}:parse(name,args);
    if(this.#active>=2) return mcdFailure("MCD_BUSY");
    this.#active++;
    const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),this.#timeout);
    const total=signal?AbortSignal.any([signal,deadline.signal]):deadline.signal;
    let failure="MCD_UPSTREAM_UNAVAILABLE";
    const client=new Client({name:"xiaokui-mcd-gateway",version:"1.0.0"},{capabilities:{}});
    // SDK 发出的每个请求仍必须命中固定地址；不允许鉴权发现、重定向或任意工具。
    let createSent=false;
    const guardedFetch: typeof fetch=async(input,init)=>{
      const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
      if(url!==mcdMcp.endpoint) throw new Error("MCD_TARGET_DENIED");
      const method=init?.method??"GET";
      if(method!=="GET"&&method!=="POST") throw new Error("MCD_METHOD_DENIED");
      if(method==="POST") {
        const body=typeof init?.body==="string"?JSON.parse(init.body) as Record<string,unknown>:null;
        if(!body || Array.isArray(body) || body.jsonrpc!=="2.0") throw new Error("MCD_METHOD_DENIED");
        const protocolReply = body.method===undefined && (typeof body.id==="number"||typeof body.id==="string") && (Object.hasOwn(body,"result")||Object.hasOwn(body,"error"));
        if(!protocolReply && !["initialize","notifications/initialized",...(inspect?["tools/list"]:[]),"tools/call","ping","notifications/cancelled"].includes(String(body.method))) throw new Error("MCD_METHOD_DENIED");
        if(body.method==="tools/call") {
          const p=body.params as Record<string,unknown>;
          const call=parse(p?.name,p?.arguments);
          if(call.name!==checked.name || JSON.stringify(call.args)!==JSON.stringify(checked.args)) throw new Error("MCD_TOOL_DENIED");
          if(call.name==='create-order'){
            if(createSent)throw new Error('MCD_DUPLICATE_SEND_DENIED');
            createSent=true;
          }
        }
      }
      const headers=new Headers(init?.headers);
      headers.set("Authorization","Bearer "+this.#token);
      const combined=init?.signal?AbortSignal.any([total,init.signal]):total;
      const response=await this.#fetch(url,{...init,method,headers,redirect:"error",signal:combined});
      if(response.status===401||response.status===403) failure="MCD_UPSTREAM_AUTH_FAILED";
      else if(response.status===429) failure="MCD_UPSTREAM_RATE_LIMITED";
      if(response.status>=300 && !(method==="GET"&&response.status===405)) {
        await response.body?.cancel();throw new Error(failure);
      }
      if(!response.body) return response;
      let bytes=0;
      const reader=response.body.getReader();
      return new Response(new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk=await reader.read();
            if(chunk.done) {controller.close();return;}
            bytes+=chunk.value.byteLength;
            if(bytes>MAX_WIRE) {failure="MCD_RESPONSE_TOO_LARGE";await reader.cancel();throw new Error(failure);}
            controller.enqueue(chunk.value);
          } catch {controller.error(new Error("MCD_STREAM_FAILED"));}
        },
        async cancel(){await reader.cancel();},
      }),{status:response.status,statusText:response.statusText,headers:response.headers});
    };
    // SDK 1.32.1 的该声明将 sessionId 写成必有 string|undefined，与其 Transport 接口及 exactOptionalPropertyTypes 冲突。
    // 固定模块的运行时导入只暴露这里使用的标准传输端口，不改 SDK、锁文件或全工程严格选项。
    let transport: Transport | undefined;
    try {
    const module = await import("@modelcontextprotocol/sdk/client/" + "streamableHttp.js") as {
      StreamableHTTPClientTransport: new(url:URL,options:{fetch:typeof fetch;requestInit:RequestInit;reconnectionOptions:{maxRetries:number;initialReconnectionDelay:number;maxReconnectionDelay:number;reconnectionDelayGrowFactor:number}})=>Transport;
    };
    transport=new module.StreamableHTTPClientTransport(new URL(mcdMcp.endpoint),{
      fetch:guardedFetch,requestInit:{redirect:"error"},
      reconnectionOptions:{maxRetries:0,initialReconnectionDelay:100,maxReconnectionDelay:100,reconnectionDelayGrowFactor:1},
    });
      await client.connect(transport,{signal:total,timeout:this.#timeout});
      const result=inspect?{content:[{type:"text",text:JSON.stringify(await client.listTools({}, {signal:total,timeout:this.#timeout}))}]}:await client.callTool({name:checked.name,arguments:checked.args},undefined,{signal:total,timeout:this.#timeout});
      if(!inspect && (("isError" in result && result.isError) || businessFailed(result))) return mcdFailure("MCD_QUERY_FAILED");
      failure="MCD_RESULT_INVALID";
      const content: McdResult["content"]=[];
      if(Array.isArray(result.content)) for(const block of result.content) {
        if(block.type==="text" && typeof block.text==="string") {
          let value: unknown=block.text;
          try {value=JSON.parse(block.text);}catch{/* 允许有界纯文本查询结果。 */}
          const safe=clean(value,this.#token);
          content.push({type:"text",text:typeof safe==="string"?safe:JSON.stringify(safe)});
        }
      }
      const structured=clean("structuredContent" in result?result.structuredContent:undefined,this.#token);
      if(!content.length && !structured) return mcdFailure("MCD_RESULT_INVALID");
      const safe:McdResult={content,isError:false};
      if(structured && typeof structured==="object" && !Array.isArray(structured)) safe.structuredContent=structured as Record<string,unknown>;
      // 对实际返回的完整序列化结果再检查；超过体积、转义解码边界或仍有凭据均失败关闭。
      const serialized=JSON.stringify(safe);
      if(Buffer.byteLength(serialized)>MAX_RESULT) return mcdFailure("MCD_RESPONSE_TOO_LARGE");
      if(containsCredential(serialized,this.#token)) throw new Error("MCD_RESULT_INVALID");
      return safe;
    } catch {return mcdFailure(signal?.aborted?"MCD_CANCELLED":deadline.signal.aborted?"MCD_TIMEOUT":failure);}
    finally {clearTimeout(timer);await client.close().catch(()=>{});await transport?.close().catch(()=>{});this.#active--;}
  }
}
