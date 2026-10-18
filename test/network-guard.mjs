// 自动化测试只能访问本机回环。官方接口使用显式注入的纯合成传输。
const localFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('TEST_EXTERNAL_NETWORK_DENIED');
 return localFetch(input,init);
};
