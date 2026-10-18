// 只有显式启用时才读取独立凭据；源文件与 systemd ACL 运行副本分开校验。
import {readFileSync,lstatSync,openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {join,isAbsolute,resolve,dirname} from 'node:path';

// 纯策略函数用于合成测试；生产调用的文本只来自内核 /proc/self/mountinfo。
export function hasSystemdCredentialMount(root,mountInfo,uid) {
  if(typeof root!=='string'||!isAbsolute(root)||resolve(root)!==root||typeof mountInfo!=='string'||mountInfo.length>1048576) return false;
  if(!/^\/run\/credentials\/[^/]+$/.test(root)&&!(Number.isSafeInteger(uid)&&new RegExp('^/run/user/'+uid+'/credentials/[^/]+$').test(root))) return false;
  const mounts=mountInfo.split('\n').filter(Boolean).map(line=>line.split(' ')).filter(fields=>fields[4]===root);
  if(mounts.length!==1) return false;
  const fields=mounts[0],separator=fields.indexOf('-');
  if(separator<6||!['tmpfs','ramfs'].includes(fields[separator+1])) return false;
  const options=new Set(fields[5].split(','));
  return ['ro','nosuid','nodev','noexec'].every(option=>options.has(option))&&!options.has('rw');
}

function trustedRuntimeDirectory(env,root,uid) {
  if(process.platform!=='linux'||env.CREDENTIALS_DIRECTORY!==root) return false;
  if(!hasSystemdCredentialMount(root,readFileSync('/proc/self/mountinfo','utf8'),uid)) return false;
  for(let path=root;;path=dirname(path)) {
    const info=lstatSync(path);
    if(!info.isDirectory()||info.isSymbolicLink()||![0,uid].includes(info.uid)||(info.mode&0o022)!==0) return false;
    if(path===root&&(info.mode&0o007)!==0) return false;
    if(path==='/') return true;
  }
}

function sameFile(left,right) {
  return right.isFile()&&['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'].every(key=>left[key]===right[key]);
}

export function readMcdConfiguration(env,credentialRoot) {
  if(env.MCD_MCP_ENABLED!=='true') return undefined;
  let fd,buffer;
  try {
    if(env.MCP_OAUTH_ENABLED!=='true'||typeof credentialRoot!=='string'||!isAbsolute(credentialRoot)||resolve(credentialRoot)!==credentialRoot) return undefined;
    const ownerId=env.MCD_OWNER_ID;
    if(typeof ownerId!=='string'||!ownerId.trim()||ownerId.length>128) return undefined;
    const directory=lstatSync(credentialRoot);
    if(!directory.isDirectory()||directory.isSymbolicLink()) return undefined;
    const path=join(credentialRoot,'mcd-token'),info=lstatSync(path);
    if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size<1||info.size>8194) return undefined;
    if(process.platform!=='win32') {
      const uid=process.getuid(),mode=info.mode&0o7777;
      if(![0,uid].includes(info.uid)||![0,uid].includes(directory.uid)) return undefined;
      if(mode===0o440) {
        if(!trustedRuntimeDirectory(env,credentialRoot,uid)) return undefined;
      } else if(![0o400,0o600].includes(mode)||(directory.mode&0o077)!==0) return undefined;
    }
    fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
    if(!sameFile(info,fstatSync(fd))) return undefined;
    buffer=Buffer.alloc(8195);let total=0;
    while(total<buffer.length) {
      const count=readSync(fd,buffer,total,buffer.length-total,null);
      if(!count) break;
      total+=count;
    }
    if(total!==info.size||!sameFile(info,fstatSync(fd))) return undefined;
    const token=buffer.subarray(0,total).toString('utf8').replace(/\r?\n$/,'');
    if(!/^[\x21-\x7e]{1,8192}$/.test(token)) return undefined;
    return {ownerId,token,orderCreateEnabled:env.MCD_ORDER_CREATE_ENABLED==='true'};
  }catch{return undefined;}
  finally{buffer?.fill(0);if(fd!==undefined)closeSync(fd);}
}
