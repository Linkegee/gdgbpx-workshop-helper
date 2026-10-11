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
function retainPassword(row){
 clearTimeout(row.passwordTimer);row.passwordExpiresAt=Date.now()+10*60*1000;
 row.passwordTimer=setTimeout(()=>{row.querySelector('.password').value='';row.passwordExpiresAt=0;},10*60*1000);
}

function markSameImages(){
 const counts=new Map();for(const row of views.values()){const key=row.dataset.captchaFingerprint;if(key)counts.set(key,(counts.get(key)||0)+1);}
 let duplicate=false;
 for(const row of views.values()){const same=Boolean(row.dataset.captchaFingerprint&&counts.get(row.dataset.captchaFingerprint)>1);row.querySelector('.same-image').hidden=!same;duplicate ||= same;}
 $('#captcha-warning').textContent=duplicate?'检测到多账号验证码图片完全相同。图片相同不等于容器相同；请查看每行实际容器，必要时只换其中一行验证码。':'';
}
function show(row,result){
 row.dataset.captchaFingerprint=result.captchaFingerprint||'';
 const b=result.binding;
 row.querySelector('.binding-check').textContent=b?('已核验：'+b.actualContainerId+' · 标签 '+b.tabId+' · '+new Date(b.checkedAt).toLocaleTimeString()):'实际容器尚未核验';
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
 if(result.status==='already-logged-in'||(row.dataset.submitted==='1'&&result.identityKey)){row.querySelector('.password').value='';row.querySelector('.code').value='';}
 if(result.status==='awaiting-captcha'&&!result.agreementAccepted&&!row.querySelector('.agree').checked)row.querySelector('.status').textContent+='；需要同意使用协议';
 if(result.hintCode==='credentials')row.querySelector('.status').textContent+='；网站提示账号或密码问题';
 if(result.hintCode==='captcha')row.querySelector('.status').textContent+='；网站提示验证码问题';
 markSameImages();
}
async function poll(row,id,waitingLogout=false){
 const deadline=Date.now()+30000;let lastError;
 for(let attempt=0;attempt<6;attempt++){
  try{const result=await rpc('inspect',{id});show(row,result);if(result.status!=='captcha-loading'&&result.hintCode!=='pending'&&(!waitingLogout||!result.identityKey))return result;}
  catch(error){lastError=error;}
  if(Date.now()>deadline)break;await new Promise(r=>setTimeout(r,900));
 }
 if(lastError)throw lastError;
 return {status:'result-pending'};
}
async function pool(ids,action){let next=0;const results=[];await Promise.all(Array.from({length:Math.min(3,ids.length)},async()=>{while(next<ids.length){const id=ids[next++];results.push(await act(id,action));}}));return results;}
async function act(id,action){
 const row=views.get(id);if(!row||row.dataset.busy)return 'skipped';
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
   if(row.dataset.status==='already-logged-in')return 'already';
   if(row.passwordExpiresAt && Date.now()>=row.passwordExpiresAt)input.value='';
   if(!input.value||!code.value){row.querySelector('.status').textContent=!input.value?'未提交：请补填密码':'未提交：请填写验证码';return 'skipped';}
   if(!row.dataset.challenge){row.querySelector('.status').textContent='未提交：请先获取当前验证码';return 'skipped';}
   if(!row.passwordExpiresAt)retainPassword(row);
   row.dataset.submitted='1';row.querySelector('.status').textContent='正在提交登录…';
   let result;try{result=await rpc('submit',{id,password:input.value,captcha:code.value,challenge:row.dataset.challenge,agree:row.querySelector('.agree').checked});}finally{code.value='';}
   show(row,result);
   if(result.status==='submitted'||result.status==='submission-pending')result=await poll(row,id);
   if(result.status==='already-logged-in')return 'success';
   if(result.identityKey)return 'confirm';
   if(result.hintCode==='captcha'||result.hintCode==='credentials'){
    row.querySelector('.status').textContent=result.hintCode==='captcha'?'登录失败：网站提示验证码问题，请填写当前新图后重试（密码仍保留）':'登录失败：网站提示账号或密码问题，请核对后修改重试';return 'failed';
   }
   row.querySelector('.status').textContent=result.status==='awaiting-captcha'?'登录未确认，请检查网站结果或重填验证码':(messages[result.status]||'登录结果未确认，请检查状态');return 'pending';
  }else if(action==='prepare'||action==='refresh'){
   await rpc(action,{id});row.querySelector('.status').textContent='已准备，等待页面加载';delete row.dataset.challenge;
   row.querySelector('.code').value='';row.querySelector('.captcha').hidden=true;row.dataset.captchaFingerprint='';markSameImages();await poll(row,id);
  }else if(action==='inspect')await poll(row,id);
  else if(action==='remove'){await rpc(action,{id});row.remove();views.delete(id);accounts.delete(id);markSameImages();$('#empty').hidden=views.size>0;}
  else await rpc(action,{id});
 }catch(error){row.querySelector('.status').textContent=error.message;row.querySelector('.status').classList.add('error');row.querySelector('.binding-check').textContent='本次核验失败，实际容器未确认';delete row.dataset.challenge;row.dataset.captchaFingerprint='';row.querySelector('.code').value='';row.querySelector('.captcha').hidden=true;markSameImages();return 'failed';}
 finally{delete row.dataset.submitted;delete row.dataset.busy;row.querySelectorAll('button').forEach(b=>b.disabled=false);}
}
function addView(account){
 accounts.set(account.id,account);
 const row=$('#row-template').content.firstElementChild.cloneNode(true);
 row.querySelector('.title').textContent=(account.label&&account.label!==account.username?account.label+' · ':'')+account.username;
 row.querySelector('.container-name').textContent=account.cookieStoreId;
 row.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>act(account.id,button.dataset.action)));
 row.querySelector('.password').addEventListener('input',()=>retainPassword(row));
 row.querySelector('.code').addEventListener('keydown',async event=>{if(event.key==='Enter'){event.preventDefault();await act(account.id,'submit');const list=[...views.values()];list[list.indexOf(row)+1]?.querySelector('.code').focus();}});
 views.set(account.id,row);$('#accounts').append(row);$('#empty').hidden=true;
 if(account.observation){row.querySelector('.status').textContent='上次状态已保存；请检查当前状态';}
}
async function batch(action){
 const buttons=document.querySelectorAll('.toolbar button,.workbench-actions button');buttons.forEach(b=>b.disabled=true);
 try{
  const ids=[...views.keys()];$('#batch-result').textContent=action==='submit'?'正在提交并检查 '+ids.length+' 个账号…':'正在处理…';
  const results=await pool(ids,action);
  if(action==='submit'){
   const count=kind=>results.filter(x=>x===kind).length;
   $('#batch-result').textContent='本轮结果：登录成功 '+count('success')+'，已登录 '+count('already')+'，需确认 '+count('confirm')+'，失败 '+count('failed')+'，未确认 '+count('pending')+'，未提交 '+count('skipped')+'。请查看各行说明。';
  }else $('#batch-result').textContent='处理完成，请查看各行状态。';
  notice($('#batch-result').textContent);
 }
 finally{buttons.forEach(b=>b.disabled=false);}
}
$('#submit-codes').onclick=()=>batch('submit');
$('#prepare-all').onclick=()=>batch('prepare');$('#submit-all').onclick=()=>batch('submit');$('#inspect-all').onclick=()=>batch('inspect');
$('#add-form').onsubmit=async event=>{
 event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;
 try {addView(await rpc('add',{username:$('#username').value,label:$('#label').value,cookieStoreId:$('#container').value}));$('#username').value='';$('#label').value='';$('#container').value='';notice('账号已添加，请填写本次密码并准备登录。');}
 catch(error){notice(error.message);}finally{button.disabled=false;}
};
async function importEntries(entries){
 const ids=[];let failed=0;
 for(const entry of entries){
  try{let account=[...accounts.values()].find(a=>a.username===entry.username);
   if(!account){account=await rpc('add',{username:entry.username});addView(account);}
   views.get(account.id).querySelector('.password').value=entry.password;retainPassword(views.get(account.id));ids.push(account.id);
  }catch{failed++;}finally{entry.password='';}
 }
 notice('已添加 '+ids.length+' 个账号，正在集中获取验证码…');await pool(ids,'prepare');
 notice('本轮准备完成，请查看各账号结果。填码后按 Enter 登录，也可以统一提交。'+(failed?'有 '+failed+' 行添加失败，请重新添加。':''));
}
function addEntry(){
 if($('#entry-rows').children.length>=30){notice('每批最多30行');return;}
 const row=document.createElement('div');row.className='entry-row';
 const userLabel=document.createElement('label');userLabel.textContent='账号 / 手机号';
 const user=document.createElement('input');user.className='entry-user';user.maxLength=100;user.autocomplete='off';userLabel.append(user);
 const passLabel=document.createElement('label');passLabel.textContent='密码';
 const pass=document.createElement('input');pass.className='entry-password';pass.type='password';pass.maxLength=512;pass.autocomplete='off';passLabel.append(pass);
 const remove=document.createElement('button');remove.type='button';remove.className='secondary';remove.textContent='删除此行';
 remove.onclick=()=>{pass.value='';row.remove();if(!$('#entry-rows').children.length)addEntry();};
 row.append(userLabel,passLabel,remove);$('#entry-rows').append(row);
}
$('#add-entry').onclick=addEntry;
for(let i=0;i<3;i++)addEntry();
$('#entry-form').onsubmit=async event=>{
 event.preventDefault();let entries=[];
 try{
  const seen=new Set();
  for(const [index,row] of [...$('#entry-rows').children].entries()){
   const username=row.querySelector('.entry-user').value.trim(),password=row.querySelector('.entry-password').value;
   if(!username&&!password)continue;
   if(!username||!password)throw Error('第 '+(index+1)+' 行请填写完整账号和密码');
   if(seen.has(username))throw Error('第 '+(index+1)+' 行账号重复');seen.add(username);entries.push({username,password});
  }
  if(!entries.length)throw Error('请至少填写一个账号和密码');
  $('#entry-fields').disabled=true;
  $('#entry-rows').querySelectorAll('.entry-password').forEach(input=>input.value='');
  await importEntries(entries);
 }catch(error){notice(error.message);}finally{entries.forEach(e=>e.password='');$('#entry-fields').disabled=false;}
};
$('#bulk-form').onsubmit=async event=>{
 event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;let entries=[];
 try{entries=GanbuBulk.parseBulk($('#bulk-input').value);$('#bulk-input').value='';await importEntries(entries);}
 catch(error){notice(error.message);}finally{entries.forEach(e=>e.password='');button.disabled=false;}
};
$('#export').onclick=async()=>{
 try{const data=await rpc('diagnostics');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='gdgbpx-panel-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 catch(error){notice(error.message);}
};
(async()=>{try{for(const c of await rpc('containers')){const option=document.createElement('option');option.value=c.cookieStoreId;option.textContent=c.name;$('#container').append(option);}for(const row of await rpc('list'))addView(row);}catch(error){notice(error.message);}})();
