/* Browser API injected for deterministic container-isolation tests. */
(function(root) {
'use strict';
const HOME='https://gbpx.gd.gov.cn/gdceportal/index.aspx';
function isHome(url) {try {const u=new URL(url);return u.origin==='https://gbpx.gd.gov.cn' && u.pathname==='/gdceportal/index.aspx';}catch{return false;}}
class Controller {
 constructor(api) {this.api=api;this.rows=[];this.busy=new Set();this.observations=new Map();this.events=[];this.writes=Promise.resolve();this.ready=this.restore();}
 async restore() {
  const saved=(await this.api.storage.local.get('accounts')).accounts;
  this.rows=Array.isArray(saved)?saved.filter(r=>r && typeof r.id==='string' && typeof r.username==='string' && typeof r.cookieStoreId==='string').map(r=>({id:r.id,username:r.username,label:String(r.label||''),cookieStoreId:r.cookieStoreId,tabId:Number.isInteger(r.tabId)?r.tabId:null,identityKey:typeof r.identityKey==='string'?r.identityKey:'',verifiedName:String(r.verifiedName||'')})):[];
 }
 async persist() {this.writes=this.writes.catch(()=>{}).then(()=>this.api.storage.local.set({accounts:this.rows.map(r=>({id:r.id,username:r.username,label:r.label,cookieStoreId:r.cookieStoreId,tabId:r.tabId,identityKey:r.identityKey||'',verifiedName:r.verifiedName||''}))}));await this.writes;}
 row(id) {const r=this.rows.find(r=>r.id===id);if(!r)throw Error('账号不存在');return r;}
 log(id,event) {this.events.push({at:Date.now(),id,event});this.events=this.events.slice(-100);}
 async list() {await this.ready;return this.rows.map(r=>({...r,observation:this.observations.get(r.id)||null,busy:this.busy.has(r.id)}));}
 async containers() {return this.api.contextualIdentities.query({});}
 async add({username,label,cookieStoreId}) {
  await this.ready;username=String(username||'').trim();label=String(label||'').trim();
  if(!username || username.length>100 || label.length>80)throw Error('请填写有效账号和备注');
  if(this.busy.has('add'))throw Error('正在添加账号');this.busy.add('add');
  try {
   if(this.rows.some(r=>r.username===username))throw Error('此账号已经添加');
   if(cookieStoreId) {
    if(this.rows.some(r=>r.cookieStoreId===cookieStoreId))throw Error('此容器已绑定其他账号');
    const container=await this.api.contextualIdentities.get(cookieStoreId);
    if(!container)throw Error('容器不存在');
   } else {
    const container=await this.api.contextualIdentities.create({name:label||'学院 '+(this.rows.length+1),color:'blue',icon:'briefcase'});
    cookieStoreId=container.cookieStoreId;
   }
   const row={id:crypto.randomUUID(),username,label,cookieStoreId,tabId:null};this.rows.push(row);
   await this.persist();return {...row};
  } finally {this.busy.delete('add');}
 }
 async locked(id,fn) {await this.ready;if(this.busy.has(id))throw Error('此账号有操作正在执行');this.busy.add(id);try{return await fn(this.row(id));}finally{this.busy.delete(id);}}
 async checkedTab(row) {
  if(!Number.isInteger(row.tabId))throw Error('请先准备登录页');
  const tab=await this.api.tabs.get(row.tabId);
  if(tab.cookieStoreId!==row.cookieStoreId || !isHome(tab.url))throw Error('登录页或容器已改变，请重新准备');
  return tab;
 }
 async prepare(id) {return this.locked(id,async row=>{
  await this.api.contextualIdentities.get(row.cookieStoreId);
  let tab=null;try{tab=await this.checkedTab(row);}catch{}
  if(!tab) {
   // Reuse only an exact homepage in the bound container; never navigate a course/player tab.
   const tabs=await this.api.tabs.query({cookieStoreId:row.cookieStoreId});
   tab=tabs.find(t=>isHome(t.url));
   if(!tab)tab=await this.api.tabs.create({url:HOME,cookieStoreId:row.cookieStoreId,active:false});
   if(tab.cookieStoreId!==row.cookieStoreId)throw Error('浏览器未在指定容器打开页面');
   row.tabId=tab.id;await this.persist();
  }
  this.observations.delete(id);this.log(id,'prepared');return {tabId:tab.id};
 });}
 async communicate(row,payload) {
  const tab=await this.checkedTab(row);let timer;
  const operation=async()=>{
   if(payload.action==='inspect') {
    await this.api.tabs.executeScript(tab.id,{file:'login-content.js',frameId:0,runAt:'document_idle'});
    await this.checkedTab(row);
   }
   return this.api.tabs.sendMessage(tab.id,{channel:'gdgbpx-login-v1',...payload},{frameId:0});
  };
  try{return await Promise.race([operation(),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('page-timeout')),12000);})]);}
  finally{clearTimeout(timer);}
 }
 async inspect(id) {return this.locked(id,async row=>{
  const result=await this.communicate(row,{action:'inspect'});
  // Do not retain the CAPTCHA bitmap or any credentials in the background.
  const observation={at:Date.now(),status:String(result.status||'unknown'),name:String(result.name||'').slice(0,80),creditedHours:typeof result.creditedHours==='number'?result.creditedHours:null,agreementAccepted:result.agreementAccepted===true,hintCode:['captcha','credentials','pending'].includes(result.hintCode)?result.hintCode:''};
  this.observations.set(id,observation);return this.classify(row,result);
 });}
 async classify(row,result) {
  if(result.status!=='logged-in-unverified')return result;
  const key=result.identityKey;
  const other=this.rows.find(r=>r.id!==row.id && r.identityKey && r.identityKey===key);
  let status='identity-confirmation';
  if(key && !other && ((row.identityKey && row.identityKey===key)
    || (!row.identityKey && result.name && result.name===row.username))) {
   row.identityKey=key;row.verifiedName=result.name||'';await this.persist();
   status='already-logged-in';
  } else if(other || (row.identityKey && key!==row.identityKey) || (result.name && /^[\p{Script=Han}·]{2,20}$/u.test(row.username) && result.name!==row.username))status='identity-mismatch';
  return {...result,status,expectedUsername:row.username};
 }
 async confirmIdentity(id,key) {return this.locked(id,async row=>{
  const current=await this.communicate(row,{action:'inspect'});
  if(!key || current.identityKey!==key || current.status!=='logged-in-unverified')throw Error('身份已变化，请重新检查');
  if(this.rows.some(r=>r.id!==id && r.identityKey===key))throw Error('此身份已绑定其他账号');
  row.identityKey=key;row.verifiedName=current.name||'';await this.persist();return this.classify(row,current);
 });}
 async switchLogin(id,key,confirmed) {return this.locked(id,async row=>{
  if(confirmed!==true || !key)throw Error('需要确认切换账号');
  const result=await this.communicate(row,{action:'logout',identityKey:key});this.log(id,'switch-requested');return result;
 });}
 async submit(id,{password,captcha,challenge,agree}) {return this.locked(id,async row=>{
  if(typeof password!=='string'||!password||password.length>512)throw Error('请输入密码');
  if(typeof captcha!=='string'||!captcha.trim()||captcha.length>20)throw Error('请输入本账号的验证码');
  const result=await this.communicate(row,{action:'submit',username:row.username,password,captcha:captcha.trim(),challenge,agree:agree===true});
  this.log(id,result.status==='submitted'?'submit-dispatched':'submit-blocked');return this.classify(row,result);
 });}
 async refresh(id) {return this.locked(id,row=>this.communicate(row,{action:'refresh'}));}
 async focus(id) {return this.locked(id,async row=>{const tab=await this.checkedTab(row);await this.api.tabs.update(tab.id,{active:true});await this.api.windows.update(tab.windowId,{focused:true});return {};});}
 async remove(id) {return this.locked(id,async()=>{this.rows=this.rows.filter(r=>r.id!==id);this.observations.delete(id);await this.persist();return {};});}
 diagnostics() {return {version:'0.2.0',generatedAt:new Date().toISOString(),events:this.events,accounts:this.rows.map(r=>({id:r.id,container:r.cookieStoreId,observation:this.observations.get(r.id)||null}))};}
}
root.GanbuController=Controller;
if(typeof module!=='undefined')module.exports={Controller,isHome};
})(globalThis);
