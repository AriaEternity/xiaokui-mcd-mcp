// 由既有授权页抽取：连接同意与订单批准保持为两个独立步骤。
export function consentPage(requestId:string,clientName:string,nonce:string):string {
 const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>麦当劳 MCP · 授权连接</title>
<style>body{font:17px/1.7 system-ui;background:#fff7fb;color:#30212c;margin:0}main{max-width:580px;margin:6vh auto;padding:24px}input,button{font:inherit;padding:10px;margin:8px 0}input{display:block;width:100%;box-sizing:border-box}button{cursor:pointer}</style>
<main><h1>授权麦当劳点单连接</h1><p>连接方：${escape(clientName)}</p><p>允许查询门店、餐品、持有的优惠券和实际报价；本人逐笔批准后才可创建即时到店订单，并查询状态。OAuth 不批准任何一笔订单，付款由本人通过官方链接完成。</p><p id="status">正在检查本站登录…</p>
<form id="login" hidden><label>本站账号<input id="username" autocomplete="username" required></label><label>密码<input id="password" type="password" autocomplete="current-password" required></label><button>登录本站</button></form>
<div id="consent" hidden><button id="allow">同意，连接麦当劳点单</button> <button id="deny">拒绝</button><p><button id="revoke">撤销我的麦当劳点单授权</button></p></div><small>访问令牌 15 分钟有效，授权最长 30 天。本站口令只发送给当前网站；不发送给 ChatGPT 或麦当劳。官方 Token 留在服务端。</small></main>
<script nonce="${nonce}">
const requestId=${JSON.stringify(requestId)},base='/api/mcd/oauth';let csrf='';const status=document.querySelector('#status'),form=document.querySelector('#login'),panel=document.querySelector('#consent');
async function session(){const r=await fetch('/api/v1/auth/session',{credentials:'same-origin',cache:'no-store'});if(r.ok){csrf=(await r.json()).csrfToken;form.hidden=true;panel.hidden=false;status.textContent='已登录本站，请确认是否允许连接。';}else{form.hidden=false;panel.hidden=true;status.textContent='请使用已有的本站账号登录。';}}
form.addEventListener('submit',async e=>{e.preventDefault();const password=document.querySelector('#password'),body=JSON.stringify({username:document.querySelector('#username').value,password:password.value});password.value='';try{const r=await fetch('/api/v1/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body});if(!r.ok){status.textContent='登录未成功。';return;}await session();}catch{status.textContent='登录暂不可用。';}});
async function act(decision){document.querySelectorAll('button').forEach(b=>b.disabled=true);try{const r=await fetch(base+(decision==='revoke'?'/revoke-mcd-orders':'/consent'),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({request:requestId,decision})});if(!r.ok){status.textContent='授权未完成，请重新发起连接。';return;}const data=await r.json();if(data.redirectUrl)location.assign(data.redirectUrl);else status.textContent='已撤销麦当劳点单授权。';}catch{status.textContent='授权暂不可用。';}finally{document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
document.querySelector('#allow').onclick=()=>act('allow');document.querySelector('#deny').onclick=()=>act('deny');document.querySelector('#revoke').onclick=()=>act('revoke');session().catch(()=>status.textContent='登录服务暂不可用。');
</script></html>`;
}
