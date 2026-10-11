const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Controller,isHome}=require('../controller.js');
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
