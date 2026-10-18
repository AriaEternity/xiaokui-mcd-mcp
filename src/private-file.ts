import {constants,openSync,closeSync,fstatSync,readFileSync,lstatSync} from 'node:fs';
import {isAbsolute,dirname,resolve} from 'node:path';

// 复用瑞幸公开版的受限文件读取：只接收路径，拒绝不可信链接与宽松权限。
export function readPrivateFile(file:string,maxBytes=8194):Buffer {
  if(!isAbsolute(file)||resolve(file)!==file)throw Error('SECRET_PATH_INVALID');
  const parent=lstatSync(dirname(file));
  if(!parent.isDirectory()||parent.isSymbolicLink())throw Error('SECRET_DIRECTORY_INVALID');
  const fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const s=fstatSync(fd);
    if(!s.isFile()||s.nlink!==1||s.size<1||s.size>maxBytes)throw Error('SECRET_FILE_INVALID');
    if(process.platform!=='win32') {
      const uid=process.getuid?.(),mode=s.mode&0o7777;
      if(![0,uid].includes(s.uid)||![0,uid].includes(parent.uid))throw Error('SECRET_OWNER_INVALID');
      if(mode===0o440){
        const root=dirname(file),mounts=readFileSync('/proc/self/mountinfo','utf8').split('\n').map(v=>v.split(' ')).filter(v=>v[4]===root);
        const m=mounts[0],separator=m?.indexOf('-')??-1;
        const options=new Set(m?.[5]?.split(',')??[]);
        if(process.env.CREDENTIALS_DIRECTORY!==root||!/^\/run\/(credentials\/[^/]+|user\/\d+\/credentials\/[^/]+)$/.test(root)||mounts.length!==1||separator<6||!['tmpfs','ramfs'].includes(m?.[separator+1]??'')||!['ro','nosuid','nodev','noexec'].every(v=>options.has(v))||options.has('rw')||(parent.mode&0o007)!==0)throw Error('SECRET_CREDENTIAL_MOUNT_INVALID');
      }else if(![0o400,0o600].includes(mode)||(parent.mode&0o077)!==0)throw Error('SECRET_PERMISSIONS_INVALID');
      for(let path=dirname(file);;path=dirname(path)){
        const entry=lstatSync(path);
        const stickyRootDirectory=entry.uid===0&&(entry.mode&0o1000)!==0;
        if(!entry.isDirectory()||entry.isSymbolicLink()||![0,uid].includes(entry.uid)||((entry.mode&0o022)!==0&&!stickyRootDirectory))throw Error('SECRET_DIRECTORY_INVALID');
        if(path==='/')break;
      }
    }
    const value=readFileSync(fd),after=fstatSync(fd);
    if(value.length!==s.size||['dev','ino','size','mtimeMs','ctimeMs'].some(k=>s[k as keyof typeof s]!==after[k as keyof typeof after]))throw Error('SECRET_FILE_CHANGED');
    return value;
  }finally{closeSync(fd);}
}
