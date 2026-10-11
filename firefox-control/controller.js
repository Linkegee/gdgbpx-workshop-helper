/* Browser API injected for deterministic container-isolation tests. */
(function(root) {
'use strict';
const HOME='https://gbpx.gd.gov.cn/gdceportal/index.aspx';
function isHome(url) {try {const u=new URL(url);return u.origin==='https://gbpx.gd.gov.cn' && u.pathname==='/gdceportal/index.aspx';}catch{return false;}}
function isWorkshop(url) {try {const u=new URL(url);return u.origin==='https://gbpx.gd.gov.cn'&&u.pathname==='/gdceportal/dist/'&&/^#\/workshop\/workshopindex\/(mergeClass|classList)(?:\?|$)/.test(u.hash);}catch{return false;}}
class Controller {
 constructor(api) {this.api=api;this.rows=[];this.busy=new Set();this.observations=new Map();this.studies=new Map();this.events=[];this.writes=Promise.resolve();this.ready=this.restore();}
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
 async ensureHome(row) {
  await this.api.contextualIdentities.get(row.cookieStoreId);
  let tab=null;try{tab=await this.checkedTab(row);}catch{}
  if(!tab) {
   // Reuse only an exact homepage in the bound container; never navigate a course/player tab.
   const tabs=await this.api.tabs.query({cookieStoreId:row.cookieStoreId});
   tab=tabs.find(t=>t.cookieStoreId===row.cookieStoreId&&isHome(t.url));
   if(!tab)tab=await this.api.tabs.create({url:HOME,cookieStoreId:row.cookieStoreId,active:false});
   if(tab.cookieStoreId!==row.cookieStoreId)throw Error('浏览器未在指定容器打开页面');
   row.tabId=tab.id;await this.persist();
  }
  return tab;
 }
 async prepare(id) {return this.locked(id,async row=>{
  const tab=await this.ensureHome(row);
  this.observations.delete(id);this.log(id,'prepared');return {tabId:tab.id};
 });}
 async inspectStudyHome(row) {
  // A newly created inactive tab can still be loading. Bound retries also cover delayed adapter injection.
  for(let attempt=0;attempt<4;attempt++){
   await this.checkedTab(row); // Never retry a container or navigation mismatch.
   let result;
   try{result=await this.communicate(row,{action:'inspect'});}catch(error){if(attempt===3)throw error;}
   if(result && !['unsupported-page','captcha-loading'].includes(result.status))return result;
   if(attempt===3)throw Error('study-home-not-ready');
   await new Promise(resolve=>setTimeout(resolve,600));
  }
 }
 async communicate(row,payload) {
  const tab=await this.checkedTab(row);let timer;
  const operation=async()=>{
   if(payload.action==='inspect') {
    await this.api.tabs.executeScript(tab.id,{file:'login-content.js',frameId:0,runAt:'document_idle'});
    await this.checkedTab(row);
   }
   const result=await this.api.tabs.sendMessage(tab.id,{channel:'gdgbpx-login-v1',...payload},{frameId:0});
   const actual=await this.checkedTab(row);
   if(actual.id!==tab.id)throw Error('登录页或容器已改变，请重新准备');
   return {...result,binding:{tabId:actual.id,expectedContainerId:row.cookieStoreId,actualContainerId:actual.cookieStoreId,checkedAt:Date.now()}};
  };
  try{return await Promise.race([operation(),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('page-timeout')),12000);})]);}
  finally{clearTimeout(timer);}
 }
 async inspect(id) {return this.locked(id,async row=>{
  const result=await this.communicate(row,{action:'inspect'});
  // Do not retain the CAPTCHA bitmap or any credentials in the background.
  const observation={at:Date.now(),binding:result.binding,documentId:result.documentId||null,captchaFingerprint:result.captchaFingerprint||null,status:String(result.status||'unknown'),name:String(result.name||'').slice(0,80),creditedHours:typeof result.creditedHours==='number'?result.creditedHours:null,agreementAccepted:result.agreementAccepted===true,hintCode:['captcha','credentials','pending'].includes(result.hintCode)?result.hintCode:''};
  this.observations.set(id,observation);return this.classify(row,result);
 });}
 async study(id) {return this.locked(id,async row=>{
  this.studies.delete(id);
  let stage='locate-home';
  try {
  const homeTab=await this.ensureHome(row);
  stage='read-home';
  const home=await this.classify(row,await this.inspectStudyHome(row));
  const snapshot={at:Date.now(),status:home.status,name:home.name||'',creditedHours:null,completedHours:null,
   homeTabId:homeTab.id,source:'container-homepage-dom',completedReason:'尚缺完整专题学时和入账明细，不能可靠汇总',tabs:[]};
  if(home.status!=='already-logged-in'){this.studies.set(id,snapshot);return snapshot;}
  snapshot.creditedHours=Number.isFinite(home.creditedHours)&&home.creditedHours>=0?home.creditedHours:null;
  stage='read-workshops';
  const tabs=(await this.api.tabs.query({cookieStoreId:row.cookieStoreId})).filter(t=>t.cookieStoreId===row.cookieStoreId&&isWorkshop(t.url));
  snapshot.truncated=tabs.length>10;
  for(const tab of tabs.slice(0,10)){
   let timer;
   const check=async()=>{const actual=await this.api.tabs.get(tab.id);if(actual.cookieStoreId!==row.cookieStoreId||actual.url!==tab.url)throw Error('changed');};
   try{
    const read=async()=>{await check();await this.api.tabs.executeScript(tab.id,{file:'study-content.js',frameId:0,runAt:'document_idle'});await check();
     const evidence=await this.api.tabs.sendMessage(tab.id,{channel:'gdgbpx-study-v1',action:'inspect'},{frameId:0});await check();return evidence;};
    const evidence=await Promise.race([read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),5000);})]);
    snapshot.tabs.push({tabId:tab.id,container:row.cookieStoreId,evidence});
   }catch{snapshot.tabs.push({tabId:tab.id,error:'页面未就绪或容器/地址已改变'});}finally{clearTimeout(timer);}
  }
  // Recheck the homepage identity after collecting other tabs; fail closed on a session switch.
  stage='verify-identity';
  const latest=await this.communicate(row,{action:'inspect'});
  if(latest.status!=='logged-in-unverified'||latest.identityKey!==home.identityKey)throw Error('身份已变化，请重新检查');
  this.studies.set(id,snapshot);return snapshot;
  }catch(error){
   const reasons={'locate-home':'无法在对应容器打开或定位首页','read-home':'首页未就绪、已离开或连接失效','read-workshops':'无法读取对应容器的专题页','verify-identity':'读取后身份或首页状态发生变化'};
   this.studies.set(id,{at:Date.now(),status:'read-failed',stage,error:reasons[stage],creditedHours:null,completedHours:null,tabs:[]});
   this.log(id,'study-failed-'+stage);throw Error(reasons[stage]);
  }
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
 async remove(id) {return this.locked(id,async()=>{this.rows=this.rows.filter(r=>r.id!==id);this.observations.delete(id);this.studies.delete(id);await this.persist();return {};});}
 diagnostics() {return {version:'0.3.1',generatedAt:new Date().toISOString(),events:this.events,accounts:this.rows.map(r=>({id:r.id,container:r.cookieStoreId,observation:this.observations.get(r.id)||null,study:this.studies.get(r.id)||null}))};}
}
root.GanbuController=Controller;
if(typeof module!=='undefined')module.exports={Controller,isHome,isWorkshop};
})(globalThis);
