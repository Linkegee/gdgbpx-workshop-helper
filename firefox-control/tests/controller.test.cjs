const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Controller,isHome}=require('../controller.js');
test('hours collection never creates tabs even when no academy page is open',async()=>{
 const f=fixture(),a=await f.c.add({username:'测试姓名'});
 f.api.tabs.create=async()=>{throw Error('SHOULD_NOT_CREATE');};
 await assert.rejects(f.c.study(a.id),/没有可读取的学院页面/);assert.equal(f.tabs.size,0);
});
test('workshop-only account request rejects a different fetched identity',async()=>{
 const f=fixture(),a=await f.c.add({username:'测试姓名'});f.c.row(a.id).identityKey='expected';
 await f.api.tabs.create({url:'https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop/workshopindex/classList?classType=3',cookieStoreId:a.cookieStoreId});
 f.api.tabs.sendMessage=async()=>({status:'logged-in-unverified',name:'另一姓名',identityKey:'other',creditedHours:99});
 const result=await f.c.study(a.id);assert.equal(result.status,'identity-mismatch');assert.equal(result.creditedHours,null);assert.equal(f.tabs.size,1);
});
test('new background homepage can initially be about:blank while loading',async()=>{
 const f=fixture(),a=await f.c.add({username:'测试姓名'}),create=f.api.tabs.create;
 f.api.tabs.create=async props=>{const tab=await create(props);tab.url='about:blank';tab.status='loading';setTimeout(()=>{tab.url=props.url;tab.status='complete';},20);return tab;};
 f.api.tabs.sendMessage=async()=>({status:'logged-in-unverified',name:'测试姓名',identityKey:'a',creditedHours:3});
 await f.c.prepare(a.id);assert.equal((await f.c.inspectStudyHome(f.c.row(a.id))).creditedHours,3);
});
test('homepage DOM requiring more than four readiness attempts can load in background',async()=>{
 const f=fixture(),a=await f.c.add({username:'测试姓名'});await f.c.prepare(a.id);let calls=0;
 f.api.tabs.sendMessage=async()=>++calls<6?{status:'unsupported-page'}:{status:'logged-in-unverified',name:'测试姓名',identityKey:'a',creditedHours:3};
 assert.equal((await f.c.study(a.id)).creditedHours,3);
});
test('discarded homepage reloads in background but workshop is never reloaded',async()=>{
 const f=fixture(),a=await f.c.add({username:'测试姓名'});await f.c.prepare(a.id);const home=f.tabs.get(f.c.row(a.id).tabId);home.discarded=true;let reloads=0;
 f.api.tabs.reload=async id=>{assert.equal(id,home.id);home.discarded=false;reloads++;};
 f.api.tabs.sendMessage=async()=>({status:'logged-in-unverified',name:'测试姓名',identityKey:'a',creditedHours:3});
 const trace=[];const result=await f.c.inspectStudyHome(f.c.row(a.id),trace);assert.equal(result.creditedHours,3);assert.equal(reloads,1);assert.equal(trace[0].result,'reload-discarded-home');
});
test('hours read recovers after login tab navigates into workshop without disturbing that tab',async()=>{
 const f=fixture(),a=await f.c.add({username:'测试姓名'});await f.c.prepare(a.id);
 const formerHome=f.tabs.get(f.c.row(a.id).tabId);
 formerHome.url='https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop/workshopindex/mergeClass?classId=test';
 f.api.tabs.sendMessage=async(id,msg)=>msg.channel==='gdgbpx-study-v1'?{rows:[]}:{status:'logged-in-unverified',identityKey:'a',name:'测试姓名',creditedHours:18.6};
 const result=await f.c.study(a.id);
 assert.equal(result.creditedHours,18.6);assert.match(formerHome.url,/mergeClass/);
 const home=f.tabs.get(f.c.row(a.id).tabId);assert.equal(home.id,formerHome.id);assert.equal(f.tabs.size,1);assert.equal(home.active,false);assert.equal(home.cookieStoreId,a.cookieStoreId);
 const count=f.tabs.size;await f.c.study(a.id);assert.equal(f.tabs.size,count);
});
function fixture(){
 const saved={},tabs=new Map(),containers=new Map(),messages=[];let serial=0;
 const api={storage:{local:{get:async()=>structuredClone(saved),set:async value=>Object.assign(saved,structuredClone(value))}},
 contextualIdentities:{query:async()=>[...containers.values()],get:async id=>{if(!containers.has(id))throw Error('missing');return containers.get(id);},create:async props=>{const c={...props,cookieStoreId:'firefox-container-'+(++serial)};containers.set(c.cookieStoreId,c);return c;}},
 tabs:{executeScript:async()=>{},get:async id=>{if(!tabs.has(id))throw Error('closed');return tabs.get(id);},query:async q=>[...tabs.values()].filter(t=>t.cookieStoreId===q.cookieStoreId),create:async props=>{const t={...props,id:++serial,windowId:1};tabs.set(t.id,t);return t;},sendMessage:async(id,msg,opts)=>{messages.push({id,msg,opts});return {status:'submitted'};},update:async()=>{}},windows:{update:async()=>{}}};
 return {api,saved,tabs,containers,messages,c:new Controller(api)};
}
test('two accounts use distinct containers and only their bound top-level login tab receives credentials',async()=>{
 const f=fixture(),a=await f.c.add({username:'alice'}),b=await f.c.add({username:'bob'});
 await Promise.all([f.c.prepare(a.id),f.c.prepare(b.id)]);
 await Promise.all([f.c.submit(a.id,{password:'SECRET_A',captcha:'1111',challenge:'A',agree:true}),f.c.submit(b.id,{password:'SECRET_B',captcha:'2222',challenge:'B',agree:true})]);
 assert.notEqual(a.cookieStoreId,b.cookieStoreId);
 for(const m of f.messages){const expected=m.msg.username==='alice'?a:b;assert.equal(f.tabs.get(m.id).cookieStoreId,expected.cookieStoreId);assert.equal(m.opts.frameId,0);assert.equal(m.msg.agree,true);}
 assert.doesNotMatch(JSON.stringify(f.saved),/SECRET|captcha|challenge|password/);
 assert.doesNotMatch(JSON.stringify(f.c.diagnostics()),/SECRET|alice|bob|1111|2222/);
});
test('container changed by another extension prevents credential delivery',async()=>{
 const f=fixture(),a=await f.c.add({username:'alice'});await f.c.prepare(a.id);
 f.tabs.get(f.c.row(a.id).tabId).cookieStoreId='firefox-default';
 await assert.rejects(f.c.submit(a.id,{password:'SECRET',captcha:'x'}),/容器/);assert.equal(f.messages.length,0);
});
test('duplicate account/container and concurrent submissions are blocked',async()=>{
 const f=fixture(),a=await f.c.add({username:'alice'});
 await assert.rejects(f.c.add({username:'alice'}),/已经/);
 await assert.rejects(f.c.add({username:'bob',cookieStoreId:a.cookieStoreId}),/绑定/);
 await f.c.prepare(a.id);let release;
 f.api.tabs.sendMessage=()=>new Promise(r=>release=r);
 const first=f.c.submit(a.id,{password:'SECRET',captcha:'x'});
 await new Promise(r=>setImmediate(r));
 await assert.rejects(f.c.submit(a.id,{password:'SECRET',captcha:'x'}),/正在执行/);
 release({status:'submitted'});await first;
});
test('prepare reuses homepage, never navigates an existing course, and recovers a closed login tab',async()=>{
 const f=fixture(),a=await f.c.add({username:'alice'});
 const course=await f.api.tabs.create({url:'https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop',cookieStoreId:a.cookieStoreId});
 await f.c.prepare(a.id);const login=f.c.row(a.id).tabId;assert.notEqual(login,course.id);
 await f.c.prepare(a.id);assert.equal(f.c.row(a.id).tabId,login);assert.equal(f.tabs.size,2);
 f.tabs.delete(login);await f.c.prepare(a.id);assert.notEqual(f.c.row(a.id).tabId,login);
 assert.match(f.tabs.get(course.id).url,/workshop/);
});
test('restore persists only mapping and removal never deletes containers or tabs',async()=>{
 const f=fixture(),a=await f.c.add({username:'alice'});await f.c.prepare(a.id);
 const restored=new Controller(f.api);await restored.ready;assert.equal(restored.row(a.id).cookieStoreId,a.cookieStoreId);
 await restored.remove(a.id);assert.equal((await restored.list()).length,0);assert.equal(f.containers.size,1);assert.equal(f.tabs.size,1);
});
test('homepage URL validation rejects deceptive hosts and unrelated paths',()=>{
 assert.ok(isHome('https://gbpx.gd.gov.cn/gdceportal/index.aspx?x=1'));
 for(const u of ['https://gbpx.gd.gov.cn.evil.test/gdceportal/index.aspx','http://gbpx.gd.gov.cn/gdceportal/index.aspx','https://gbpx.gd.gov.cn/other','not-url'])assert.equal(isHome(u),false);
});

test('inspection attaches adapter to an old homepage without reloading or opening another tab',async()=>{
 const f=fixture(),a=await f.c.add({username:'alice'});await f.c.prepare(a.id);let injected=0;
 f.api.tabs.executeScript=async(id,options)=>{assert.equal(id,f.c.row(a.id).tabId);assert.equal(options.file,'login-content.js');assert.equal(options.frameId,0);injected++;};
 await f.c.inspect(a.id);assert.equal(injected,1);assert.equal(f.tabs.size,1);
});

test('matching name is already logged in; unknown numeric login needs confirmation; changed identity prompts switch',async()=>{
 const f=fixture(),a=await f.c.add({username:'测试姓名'});await f.c.prepare(a.id);
 f.api.tabs.sendMessage=async()=>({status:'logged-in-unverified',name:'测试姓名',identityKey:'key-a'});
 assert.equal((await f.c.inspect(a.id)).status,'already-logged-in');
 f.api.tabs.sendMessage=async()=>({status:'logged-in-unverified',name:'另一姓名',identityKey:'key-b'});
 assert.equal((await f.c.inspect(a.id)).status,'identity-mismatch');assert.equal(f.c.row(a.id).identityKey,'key-a');
 const b=await f.c.add({username:'123456'});await f.c.prepare(b.id);
 assert.equal((await f.c.inspect(b.id)).status,'identity-confirmation');
 await assert.rejects(f.c.confirmIdentity(b.id,'stale'),/身份已变化/);
 assert.equal((await f.c.confirmIdentity(b.id,'key-b')).status,'already-logged-in');
 const restored=new Controller(f.api);await restored.ready;assert.equal(restored.row(b.id).identityKey,'key-b');
});
test('switch account requires explicit confirmation and forwards fingerprint without passwords',async()=>{
 const f=fixture(),a=await f.c.add({username:'a'});await f.c.prepare(a.id);
 await assert.rejects(f.c.switchLogin(a.id,'key',false),/确认/);assert.equal(f.messages.length,0);
 await f.c.switchLogin(a.id,'key',true);assert.equal(f.messages[0].msg.action,'logout');assert.equal(f.messages[0].msg.identityKey,'key');
});

test('captcha inspection returns actual tab/container evidence and rejects a change during response',async()=>{
 const f=fixture(),a=await f.c.add({username:'alice'});await f.c.prepare(a.id);
 f.api.tabs.sendMessage=async()=>({status:'awaiting-captcha',documentId:'doc-a',captchaFingerprint:'image-fingerprint',captchaImage:'private-image',challenge:'private-challenge'});
 const result=await f.c.inspect(a.id);
 assert.equal(result.binding.actualContainerId,a.cookieStoreId);assert.equal(result.binding.tabId,f.c.row(a.id).tabId);
 const diag=JSON.stringify(f.c.diagnostics());assert.match(diag,/image-fingerprint/);assert.doesNotMatch(diag,/private-image|private-challenge/);
 f.api.tabs.sendMessage=async()=>{f.tabs.get(f.c.row(a.id).tabId).cookieStoreId='firefox-default';return {status:'awaiting-captcha'};};
 await assert.rejects(f.c.inspect(a.id),/容器/);
});

test('study reads only matched account container, leaves completed hours unknown, and never navigates',async()=>{
 const f=fixture(),a=await f.c.add({username:'测试姓名'});await f.c.prepare(a.id);
 const workshop=await f.api.tabs.create({url:'https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop/workshopindex/mergeClass?classId=test',cookieStoreId:a.cookieStoreId});
 await f.api.tabs.create({url:workshop.url,cookieStoreId:'other'});
 f.api.tabs.sendMessage=async(id,msg)=>{
  if(msg.channel==='gdgbpx-study-v1'){assert.equal(id,workshop.id);return {helperPresent:true,rows:[{completed:true,hourLabels:['学时：1.5']}]};}
  return {status:'logged-in-unverified',identityKey:'a',name:'测试姓名',creditedHours:20};
 };
 const before=f.tabs.size,result=await f.c.study(a.id);
 assert.equal(result.creditedHours,20);assert.equal(result.completedHours,null);assert.equal(result.tabs.length,1);assert.equal(f.tabs.size,before);
 assert.equal(f.c.diagnostics().accounts[0].study.creditedHours,20);
});

test('study with mismatched identity exposes no account hours or workshop evidence',async()=>{
 const f=fixture(),a=await f.c.add({username:'测试姓名'});await f.c.prepare(a.id);
 f.api.tabs.sendMessage=async()=>({status:'logged-in-unverified',identityKey:'wrong',name:'别的姓名',creditedHours:50});
 const result=await f.c.study(a.id);assert.equal(result.status,'identity-mismatch');assert.equal(result.creditedHours,null);assert.deepEqual(result.tabs,[]);
});

test('study discards tab data if container changes during read and rejects identity change after read',async()=>{
 const f=fixture(),a=await f.c.add({username:'测试姓名'});await f.c.prepare(a.id);
 const tab=await f.api.tabs.create({url:'https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop/workshopindex/classList?classType=3',cookieStoreId:a.cookieStoreId});let homeReads=0;
 f.api.tabs.sendMessage=async(id,msg)=>{
  if(msg.channel==='gdgbpx-study-v1'){f.tabs.get(tab.id).cookieStoreId='other';return {rows:['DO_NOT_ACCEPT']};}
  homeReads++;return {status:'logged-in-unverified',identityKey:'a',name:'测试姓名',creditedHours:2};
 };
 const result=await f.c.study(a.id);assert.ok(result.tabs[0].error);assert.doesNotMatch(JSON.stringify(result),/DO_NOT_ACCEPT/);
 homeReads=0;f.api.tabs.sendMessage=async()=>({status:'logged-in-unverified',identityKey:++homeReads===1?'a':'b',name:'测试姓名',creditedHours:2});
 await assert.rejects(f.c.study(a.id),/身份或首页状态发生变化/);assert.equal(f.c.studies.get(a.id).status,'read-failed');assert.equal(f.c.studies.get(a.id).creditedHours,null);
});

test('hours read reuses another homepage after bound tab closes and never uses another container',async()=>{
 const f=fixture(),a=await f.c.add({username:'测试姓名'});await f.c.prepare(a.id);f.tabs.delete(f.c.row(a.id).tabId);
 await f.api.tabs.create({url:'https://gbpx.gd.gov.cn/gdceportal/index.aspx',cookieStoreId:'other'});
 const home=await f.api.tabs.create({url:'https://gbpx.gd.gov.cn/gdceportal/index.aspx',cookieStoreId:a.cookieStoreId});
 f.api.tabs.sendMessage=async(id)=>{assert.equal(id,home.id);return {status:'logged-in-unverified',name:'测试姓名',identityKey:'a',creditedHours:3};};
 const result=await f.c.study(a.id);assert.equal(result.creditedHours,3);assert.equal(f.tabs.size,2);
});

test('hours read waits for a newly created homepage adapter without opening duplicate tabs',async()=>{
 const f=fixture(),a=await f.c.add({username:'测试姓名'});await f.c.prepare(a.id);let reads=0;
 f.api.tabs.sendMessage=async()=>{if(++reads===1)throw Error('no receiver');return {status:'logged-in-unverified',name:'测试姓名',identityKey:'a',creditedHours:3};};
 assert.equal((await f.c.study(a.id)).creditedHours,3);assert.equal(f.tabs.size,1);
});

test('study failures retain redacted stage diagnostics without raw browser errors',async()=>{
 const f=fixture(),a=await f.c.add({username:'测试姓名'});f.api.tabs.query=async()=>{throw Error('SECRET');};
 await assert.rejects(f.c.study(a.id),/首页/);
 const data=f.c.diagnostics();assert.equal(data.accounts[0].study.stage,'read-home');assert.doesNotMatch(JSON.stringify(data),/SECRET/);
});
