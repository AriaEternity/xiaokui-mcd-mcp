import {mkdirSync,writeFileSync,lstatSync} from 'node:fs';
import {isAbsolute,resolve,dirname} from 'node:path';
import {randomBytes,randomUUID,scryptSync} from 'node:crypto';
export function initializeOwner(file,username,password,confirmation){
 if(!isAbsolute(file)||resolve(file)!==file||typeof username!=='string'||!username.trim()||username.length>128||typeof password!=='string'||password.length<16||password.length>512||password!==confirmation)throw Error('OWNER_INITIALIZATION_INVALID');
 mkdirSync(dirname(file),{recursive:true,mode:0o700});
 const info=lstatSync(dirname(file));if(!info.isDirectory()||info.isSymbolicLink()||(process.platform!=='win32'&&((info.mode&0o077)!==0||info.uid!==process.getuid?.())))throw Error('OWNER_DIRECTORY_PRIVATE_REQUIRED');
 const salt=randomBytes(16).toString('hex');
 writeFileSync(file,JSON.stringify({version:1,ownerId:randomUUID(),username,salt,hash:scryptSync(password,salt,64).toString('hex')}),{flag:'wx',mode:0o400});
}
