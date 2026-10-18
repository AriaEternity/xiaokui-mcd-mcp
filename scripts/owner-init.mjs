import {resolve} from 'node:path';
import {hidden} from './terminal-input.mjs';
import {initializeOwner} from './owner-record.mjs';
try{
 process.umask(0o077);
 const file=resolve(process.env.OWNER_FILE??resolve(process.env.DATA_ROOT??'./data','owner.json'));
 const password=await hidden('设置本站主人密码（不显示，至少16字符）：');
 initializeOwner(file,process.env.OWNER_USERNAME??'owner',password,await hidden('再次输入密码：'));
 process.stdout.write('主人文件已创建；仅保存随机标识、salt和密码哈希。请单独保存密码，勿上传主人文件。\n');
}catch{process.stderr.write('初始化未完成：需交互终端、私有目录、匹配的长密码，目标文件必须不存在。\n');process.exitCode=1;}
