import type {FastifyInstance} from 'fastify';
import {join} from 'node:path';
import {createMcdOAuth} from './oauth/server.js';
import type {SessionInspector} from './oauth/server.js';
import {McdMcpClient} from './mcp/mcd-client.js';
import {McdOrdersService} from './mcd/orders.js';
import {registerMcdMcp} from './http/routes/mcd-mcp.js';
import {registerMcdOrderConfirmation} from './http/routes/mcd-order-confirm.js';

export type {SessionInspector,OwnerSession} from './oauth/server.js';
export {mcdMcp,mcdTools} from './contracts/mcd-mcp.js';
export {McdMcpClient} from './mcp/mcd-client.js';
export {McdOrdersService} from './mcd/orders.js';
export type {McdBinding} from './mcd/orders.js';

/** 挂载到有可靠本人登录的 Fastify 宿主；不提供默认账号或后门会话。 */
export function registerMcdGateway(app:FastifyInstance,options:{
 dataRoot:string; publicOrigin:string; ownerId:string; token:string;
 inspectSession:SessionInspector; createEnabled?:boolean; transport?:typeof fetch;
 now?:()=>number; responseMode?:'json'|'sse';
}) {
 const oauth=createMcdOAuth({root:join(options.dataRoot,'oauth'),publicOrigin:options.publicOrigin,
  ownerId:options.ownerId,inspectSession:options.inspectSession,now:options.now});
 const reader=new McdMcpClient({token:options.token,transport:options.transport});
 const service=new McdOrdersService({root:join(options.dataRoot,'mcd-orders'),publicOrigin:options.publicOrigin,
  reader,active:oauth.authorization.active,createEnabled:options.createEnabled===true,now:options.now});
 oauth.register(app);
 registerMcdMcp(app,{publicOrigin:options.publicOrigin},{authorization:oauth.authorization,responseMode:options.responseMode,
  readerForRequest:async header=>{const binding=await oauth.authorization.identify(header);
   return {call:(name,args,signal)=>service.call(binding,name,args,signal)};}});
 registerMcdOrderConfirmation(app,{publicOrigin:options.publicOrigin,service,inspectSession:options.inspectSession});
 return {service,oauth};
}
