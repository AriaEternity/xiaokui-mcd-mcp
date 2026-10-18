import {resolve,dirname} from 'node:path';
import {mkdirSync,lstatSync,writeFileSync} from 'node:fs';
import {hidden} from './terminal-input.mjs';
try{
 process.umask(0o077);
 const file=resolve(process.env.MCD_TOKEN_FILE??'./credentials/mcd-token');
 mkdirSync(dirname(file),{recursive:true,mode:0o700});const info=lstatSync(dirname(file));
 if(!info.isDirectory()||info.isSymbolicLink()||(process.platform!=='win32'&&((info.mode&0o077)!==0||info.uid!==process.getuid?.())))throw Error('CREDENTIAL_DIRECTORY_INVALID');
 const token=await hidden('输入本人官方麦当劳 MCP Token（不含 Bearer，不显示）：',8192);
 if(!/^[\x21-\x7e]{1,8192}$/.test(token))throw Error('CREDENTIAL_INVALID');
 writeFileSync(file,token+'\n',{flag:'wx',mode:0o400});process.stdout.write('独立凭据已保存；不会回显，不会覆盖已有文件。\n');
}catch{process.stderr.write('凭据未保存：检查交互终端、Token格式、私有目录和目标不存在。不要把Token贴入聊天。\n');process.exitCode=1;}
