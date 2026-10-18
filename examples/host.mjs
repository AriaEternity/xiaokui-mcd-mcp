// 管理员提供真实宿主认证适配模块；该示例没有默认密码或模拟登录。
import Fastify from 'fastify';
import {pathToFileURL} from 'node:url';
import {isAbsolute} from 'node:path';
import {registerMcdGateway} from '../dist/index.js';
import {readMcdConfiguration} from '../deploy/mcd-credentials.mjs';
process.umask(0o077);
const adapter=process.env.OWNER_AUTH_ADAPTER;
if(!adapter||!isAbsolute(adapter))throw Error('OWNER_AUTH_ADAPTER_REQUIRED');
const auth=await import(pathToFileURL(adapter).href);
if(typeof auth.registerOwnerAuth!=='function'||typeof auth.inspectSession!=='function')throw Error('OWNER_AUTH_ADAPTER_INVALID');
const credentials=readMcdConfiguration(process.env,process.env.MCD_CREDENTIAL_ROOT??process.env.CREDENTIALS_DIRECTORY);
if(!credentials)throw Error('MCD_CONFIGURATION_UNAVAILABLE');
const dataRoot=process.env.DATA_ROOT,publicOrigin=process.env.PUBLIC_ORIGIN;
if(!dataRoot||!isAbsolute(dataRoot)||!publicOrigin)throw Error('GATEWAY_CONFIGURATION_REQUIRED');
const port=Number(process.env.PORT??4318);
if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('PORT_INVALID');
// 不记录 Cookie、授权码、Token、订单与付款链接。需要日志时由宿主提供明确的脱敏策略。
const app=Fastify({logger:false,bodyLimit:32768,requestTimeout:30000});
await auth.registerOwnerAuth(app);
registerMcdGateway(app,{dataRoot,publicOrigin,inspectSession:auth.inspectSession,...credentials,createEnabled:credentials.orderCreateEnabled});
await app.listen({host:'127.0.0.1',port});
console.log('McDonald MCP gateway listening on loopback.');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{app.close().then(()=>process.exit(0));});
