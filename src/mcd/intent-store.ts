// 沿用瑞幸v4原子写入/fsync/跨进程锁；麦当劳状态目录独立。
import {constants,closeSync,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {mcdIntentPattern as intentPattern} from '../mcp/mcd-policy.js';
import type {McdIntent} from './orders.js';
export class McdIntentStore{
 readonly root:string;
 constructor(root:string){
  if(!isAbsolute(root))throw Error('INTENT_ROOT_INVALID');mkdirSync(root,{recursive:true,mode:0o700});this.root=root;this.checkRoot();
 }
 private checkRoot(){const s=lstatSync(this.root);if(!s.isDirectory()||s.isSymbolicLink()||(process.platform!=='win32'&&((s.mode&0o077)!==0||s.uid!==process.getuid?.())))throw Error('INTENT_ROOT_INVALID');}
 private path(id:string){if(!intentPattern.test(id))throw Error('INTENT_NOT_FOUND');return join(this.root,id+'.json');}
 private syncDir(){if(process.platform==='win32')return;const fd=openSync(this.root,constants.O_RDONLY);try{fsyncSync(fd);}finally{closeSync(fd);}}
 put(value:McdIntent){
  this.checkRoot();const path=this.path(value.id),temp=join(this.root,'.tmp-'+randomUUID());const data=JSON.stringify(value);if(Buffer.byteLength(data)>65536)throw Error('INTENT_TOO_LARGE');
  let fd:number|undefined;try{fd=openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);writeFileSync(fd,data);fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temp,path);this.syncDir();}finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(temp);}catch{}}
 }
 create(value:McdIntent){if(readdirSync(this.root).filter(p=>p.endsWith('.json')).length>=256)throw Error('INTENT_CAPACITY');if(readdirSync(this.root).includes(value.id+'.json'))throw Error('INTENT_EXISTS');this.put(value);}
 get(id:string):McdIntent{
  this.checkRoot();const fd=openSync(this.path(id),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{const s=fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.size>65536||(process.platform!=='win32'&&((s.mode&0o077)!==0||s.uid!==process.getuid?.())))throw Error('INTENT_INVALID');
   const v=JSON.parse(readFileSync(fd,'utf8')) as McdIntent;
   if(v.version!==1||v.id!==id||!v.binding||!v.quote||!['QUOTED','PREVIEWED','APPROVED','SUBMITTING','UNKNOWN','CREATED','REQUOTE_REQUIRED'].includes(v.state))throw Error('INTENT_INVALID');return v;
  }finally{closeSync(fd);}
 }
 list():McdIntent[]{this.checkRoot();return readdirSync(this.root).filter(n=>n.endsWith('.json')).map(n=>this.get(n.slice(0,-5)));}
 async lock<T>(id:string,fn:()=>Promise<T>):Promise<T>{
  this.checkRoot();this.path(id);const path=join(this.root,id+'.lock');let fd:number;
  try{fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);}catch{throw Error('INTENT_BUSY_OR_UNCERTAIN');}
  try{fsyncSync(fd);this.syncDir();return await fn();}finally{closeSync(fd);unlinkSync(path);this.syncDir();}
 }
}
