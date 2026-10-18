import Fastify from 'fastify';
import {join,resolve} from 'node:path';
import {localOwnerIdentity,privateDirectory} from './identity.js';
import {registerMcdGateway} from './index.js';

/** 独立单主人装配；原 registerMcdGateway 的宿主集成接口保持不变。 */
export function createStandaloneGateway(options:{root:string;publicOrigin:string;ownerFile:string;token:string;createEnabled?:boolean;transport?:typeof fetch;now?:()=>number}){
 if(resolve(options.root)!==options.root)throw Error('DATA_ROOT_ABSOLUTE_REQUIRED');
 privateDirectory(options.root);
 const identity=localOwnerIdentity({file:options.ownerFile,root:join(options.root,'identity'),publicOrigin:options.publicOrigin,now:options.now});
 const app=Fastify({logger:false,bodyLimit:32768,requestTimeout:30000,connectionTimeout:30000});
 app.setErrorHandler((error,_req,reply)=>{
  const code=typeof error==='object'&&error!==null&&'statusCode' in error?error.statusCode:500;
  const status=typeof code==='number'&&[400,413,415,429].includes(code)?code:500;
  return reply.code(status).send({error:status===429?'rate_limited':status===500?'service_unavailable':'invalid_request'});
 });
 try{
  identity.register(app);
  registerMcdGateway(app,{dataRoot:options.root,publicOrigin:options.publicOrigin,ownerId:identity.ownerId,inspectSession:identity.inspectSession,
   token:options.token,createEnabled:options.createEnabled,transport:options.transport,now:options.now});
  app.addHook('onClose',async()=>identity.close());
  app.get('/health/ready',async()=>({status:'ready'}));
  return app;
 }catch(e){identity.close();throw e;}
}
