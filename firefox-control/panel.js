 'use strict';
const $=s=>document.querySelector(s),views=new Map(),accounts=new Map();
const messages={
 'already-logged-in':'已登录，与待登录账号匹配',
 'identity-confirmation':'已登录，但尚不能确认是否为待登录账号，请选择',
 'identity-mismatch':'当前登录身份与待登录账号不一致，请选择是否切换',
 'logging-out':'正在退出原账号并准备新的验证码',
 'logout-manual-required':'未识别到退出按钮，请打开学院页退出，再检查状态',
 'identity-changed':'当前身份已变化，请重新检查后确认',
 'logged-in-unverified':'学院显示已登录；请核对下方姓名，暂不自动开始学习',
 'awaiting-captcha':'等待填写验证码', 'captcha-loading':'验证码加载中，请稍后检查状态',
 'captcha-unavailable':'验证码无法集中显示，请打开学院页完成登录', 'unsupported-page':'登录页结构未识别，请打开学院页查看',
 'captcha-changed':'验证码已变化，请检查状态获取新图后重填', 'agreement-required':'请打开学院页，阅读并勾选平台使用协议，再回到面板提交',
 'submission-pending':'登录请求已发出，请检查结果，不要重复提交', 'submitted':'登录请求已提交，等待检查结果',
 'missing-fields':'请填写密码及验证码','page-operation-failed':'页面操作未完成，请打开学院页查看'
};
async function rpc(action,data={}){const r=await browser.runtime.sendMessage({action,...data});if(!r?.ok)throw Error(r?.error||'扩展连接失效');return r.value;}
function notice(text){$('#notice').textContent=text;}
function show(row,result){
 row.dataset.status=result.status;
 row.dataset.identityKey=result.identityKey||'';
 const needsChoice=['identity-confirmation','identity-mismatch'].includes(result.status);
 row.querySelector('.identity-actions').hidden=!needsChoice;
 row.querySelector('[data-action=confirmIdentity]').hidden=result.status!=='identity-confirmation';
 row.querySelector('.status').textContent=messages[result.status]||'状态尚未确认';
 row.querySelector('.identity').textContent=['logged-in-unverified','already-logged-in','identity-confirmation','identity-mismatch'].includes(result.status)?('待登录：'+(result.expectedUsername||'')+'；学院当前：'+(result.name||result.header||'姓名待读取')):'';
 row.querySelector('.hours').textContent=Number.isFinite(result.creditedHours)?result.creditedHours+' / 50':'待读取';
 const img=row.querySelector('.captcha');
 if(result.captchaImage&&/^data:image\/png;base64,/.test(result.captchaImage)) {
  if(row.dataset.challenge!==result.challenge)row.querySelector('.code').value='';
  img.src=result.captchaImage;img.hidden=false;row.dataset.challenge=result.challenge;
 }else{img.removeAttribute('src');img.hidden=true;delete row.dataset.challenge;}
 if(result.status==='already-logged-in'){row.querySelector('.password').value='';row.querySelector('.code').value='';}
 if(result.status==='awaiting-captcha'&&!result.agreementAccepted&&!row.querySelector('.agree').checked)row.querySelector('.status').textContent+='；需要同意使用协议';
 if(result.hintCode==='credentials')row.querySelector('.status').textContent+='；网站提示账号或密码问题';
 if(result.hintCode==='captcha')row.querySelector('.status').textContent+='；网站提示验证码问题';
}
async function poll(row,id,waitingLogout=false){
 const deadline=Date.now()+30000;let lastError;
 for(let attempt=0;attempt<6;attempt++){
  try{const result=await rpc('inspect',{id});show(row,result);if(result.status!=='captcha-loading'&&result.hintCode!=='pending'&&(!waitingLogout||!result.identityKey))return;}
  catch(error){lastError=error;}
  if(Date.now()>deadline)break;await new Promise(r=>setTimeout(r,900));
 }
 if(lastError)row.querySelector('.status').textContent=lastError.message;
}
async function pool(ids,action){let next=0;await Promise.all(Array.from({length:Math.min(3,ids.length)},async()=>{while(next<ids.length){const id=ids[next++];await act(id,action);}}));}
async function act(id,action){
 const row=views.get(id);if(!row||row.dataset.busy)return;
 row.dataset.busy='1';row.querySelectorAll('button').forEach(b=>b.disabled=true);
 try {
  row.querySelector('.status').classList.remove('error');
  if(action==='keep'){row.querySelector('.identity-actions').hidden=true;row.querySelector('.password').value='';row.querySelector('.status').textContent='已保留当前登录，未切换账号';return;}
  if(action==='confirmIdentity'){show(row,await rpc(action,{id,identityKey:row.dataset.identityKey}));return;}
  if(action==='switchLogin'){
   if(!confirm('将退出此容器当前账号，登录 '+accounts.get(id).username+'。这会影响该容器中的其他学院页面。继续吗？'))return;
   const result=await rpc(action,{id,identityKey:row.dataset.identityKey,confirmed:true});show(row,result);
   if(result.status==='logging-out')await poll(row,id,true);return;
  }
  if(action==='submit'){
   const input=row.querySelector('.password'),code=row.querySelector('.code');
   if(!input.value||!code.value){row.querySelector('.status').textContent='请先填写密码和验证码';return;}
   let result;try{result=await rpc('submit',{id,password:input.value,captcha:code.value,challenge:row.dataset.challenge,agree:row.querySelector('.agree').checked});}finally{input.value='';code.value='';setTimeout(()=>act(id,'inspect'),2500);}
   show(row,result);
  }else if(action==='prepare'||action==='refresh'){
   await rpc(action,{id});row.querySelector('.status').textContent='已准备，等待页面加载';delete row.dataset.challenge;
   row.querySelector('.code').value='';row.querySelector('.captcha').hidden=true;await poll(row,id);
  }else if(action==='inspect')await poll(row,id);
  else if(action==='remove'){await rpc(action,{id});row.remove();views.delete(id);accounts.delete(id);$('#empty').hidden=views.size>0;}
  else await rpc(action,{id});
 }catch(error){row.querySelector('.status').textContent=error.message;row.querySelector('.status').classList.add('error');}
 finally{delete row.dataset.busy;row.querySelectorAll('button').forEach(b=>b.disabled=false);}
}
function addView(account){
 accounts.set(account.id,account);
 const row=$('#row-template').content.firstElementChild.cloneNode(true);
 row.querySelector('.title').textContent=(account.label?account.label+' · ':'')+account.username;
 row.querySelector('.container-name').textContent=account.cookieStoreId;
 row.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>act(account.id,button.dataset.action)));
 row.querySelector('.code').addEventListener('keydown',async event=>{if(event.key==='Enter'){event.preventDefault();await act(account.id,'submit');const list=[...views.values()];list[list.indexOf(row)+1]?.querySelector('.code').focus();}});
 views.set(account.id,row);$('#accounts').append(row);$('#empty').hidden=true;
 if(account.observation){row.querySelector('.status').textContent='上次状态已保存；请检查当前状态';}
}
async function batch(action){
 const buttons=document.querySelectorAll('.toolbar button');buttons.forEach(b=>b.disabled=true);
 try{const ids=[...views].filter(([id,row])=>action!=='submit'||(row.querySelector('.password').value&&row.querySelector('.code').value)).map(([id])=>id);await pool(ids,action);notice('本轮操作完成；每个账号的结果显示在对应卡片中。');}
 finally{buttons.forEach(b=>b.disabled=false);}
}
$('#prepare-all').onclick=()=>batch('prepare');$('#submit-all').onclick=()=>batch('submit');$('#inspect-all').onclick=()=>batch('inspect');
$('#add-form').onsubmit=async event=>{
 event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;
 try {addView(await rpc('add',{username:$('#username').value,label:$('#label').value,cookieStoreId:$('#container').value}));$('#username').value='';$('#label').value='';$('#container').value='';notice('账号已添加，请填写本次密码并准备登录。');}
 catch(error){notice(error.message);}finally{button.disabled=false;}
};
$('#bulk-form').onsubmit=async event=>{
 event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;
 let entries=[];
 try{
  entries=GanbuBulk.parseBulk($('#bulk-input').value);$('#bulk-input').value='';
  const ids=[];let failed=0;
  for(const entry of entries){
   try{let account=[...accounts.values()].find(a=>a.username===entry.username);
    if(!account){account=await rpc('add',{username:entry.username});addView(account);}
    views.get(account.id).querySelector('.password').value=entry.password;ids.push(account.id);
   }catch{failed++;}finally{entry.password='';}
  }
  notice('已添加 '+ids.length+' 个账号，正在集中获取验证码…');await pool(ids,'prepare');
  notice('验证码准备完成。逐行填码后按 Enter 登录，或填写全部后批量提交。'+(failed?'有 '+failed+' 行添加失败，请重新添加。':''));
 }catch(error){notice(error.message);}finally{entries.forEach(e=>e.password='');button.disabled=false;}
};
$('#export').onclick=async()=>{
 try{const data=await rpc('diagnostics');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='gdgbpx-panel-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 catch(error){notice(error.message);}
};
(async()=>{try{for(const c of await rpc('containers')){const option=document.createElement('option');option.value=c.cookieStoreId;option.textContent=c.name;$('#container').append(option);}for(const row of await rpc('list'))addView(row);}catch(error){notice(error.message);}})();
