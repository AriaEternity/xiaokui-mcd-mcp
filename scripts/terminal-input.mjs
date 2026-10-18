// 仅在操作者自己的交互终端隐藏输入，不接受口令/Token命令行参数。
export function hidden(prompt,maxLength=512){
 if(!process.stdin.isTTY)throw Error('LOCAL_TERMINAL_REQUIRED');
 process.stdout.write(prompt);process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise((resolve,reject)=>{
  let value='';
  function done(error){process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');error?reject(error):resolve(value);}
  function onData(chunk){for(const char of chunk.toString('utf8')){
   if(char==='\u0003'||char==='\u0004'){done(Error('CANCELLED'));return;}
   if(char==='\r'||char==='\n'){done();return;}
   if(char==='\u007f'||char==='\b'){value=value.slice(0,-1);continue;}
   if(value.length>=maxLength){done(Error('INPUT_TOO_LONG'));return;}
   if(char>=' ')value+=char;
  }}
  process.stdin.on('data',onData);
 });
}
