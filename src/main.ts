import {resolve,isAbsolute} from 'node:path';
import {readOwner} from './identity.js';
import {createStandaloneGateway} from './standalone.js';
// 不导入部署脚本到编译产物：同一安全读取器由动态导入加载。
async function main(){
 process.umask(0o077);
 const origin=process.env.PUBLIC_ORIGIN??'',url=new URL(origin);
 if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password)throw Error('PUBLIC_ORIGIN_HTTPS_REQUIRED');
 const root=resolve(process.env.DATA_ROOT??'./data');
 const ownerFile=resolve(process.env.OWNER_FILE??(process.env.CREDENTIALS_DIRECTORY?process.env.CREDENTIALS_DIRECTORY+'/owner.json':root+'/owner.json'));
 const owner=readOwner(ownerFile);
 if(process.env.MCD_OWNER_ID&&process.env.MCD_OWNER_ID!==owner.ownerId)throw Error('OWNER_BINDING_MISMATCH');
 for(const name of ['MCP_OAUTH_ENABLED','MCD_MCP_ENABLED','MCD_ORDER_CREATE_ENABLED'])if(process.env[name]!==undefined&&!['true','false'].includes(process.env[name]!))throw Error('CONFIG_FLAG_INVALID');
 const credentialRoot=process.env.MCD_CREDENTIAL_ROOT??process.env.CREDENTIALS_DIRECTORY;
 if(!credentialRoot||!isAbsolute(credentialRoot))throw Error('MCD_CREDENTIAL_ROOT_REQUIRED');
 const credentialModule='../deploy/mcd-credentials.mjs';
 const {readMcdConfiguration}=await import(credentialModule);
 const credentials=readMcdConfiguration({...process.env,MCP_OAUTH_ENABLED:process.env.MCP_OAUTH_ENABLED??'true',MCD_MCP_ENABLED:process.env.MCD_MCP_ENABLED??'true',MCD_OWNER_ID:owner.ownerId},credentialRoot);
 if(!credentials)throw Error('MCD_CONFIGURATION_UNAVAILABLE');
 const port=Number(process.env.PORT??4318);if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('PORT_INVALID');
 const app=createStandaloneGateway({root,publicOrigin:origin,ownerFile,token:credentials.token,createEnabled:credentials.orderCreateEnabled});
 let stopping=false;
 const stop=async()=>{if(stopping)return;stopping=true;const timer=setTimeout(()=>process.exit(1),30000);timer.unref();try{await app.close();}finally{clearTimeout(timer);}};
 process.once('SIGTERM',()=>{void stop();});process.once('SIGINT',()=>{void stop();});
 await app.listen({host:'127.0.0.1',port});process.stdout.write('MCD_GATEWAY_READY — 订单仍需本人逐笔批准，支付由本人完成\n');
}
main().catch(()=>{process.stderr.write('MCD_START_FAILED — 请检查Node版本、HTTPS配置、主人文件与独立凭据权限；不要输出凭据正文。\n');process.exitCode=1;});
