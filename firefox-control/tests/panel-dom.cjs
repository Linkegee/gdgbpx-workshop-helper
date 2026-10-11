const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('../../.panel-test-runtime/node_modules/jsdom');
const flush=()=>new Promise(r=>setImmediate(r));
test('real panel DOM adds accounts, escapes labels, batches distinct challenges and clears passwords',async()=>{
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../panel.html'),'utf8'),{runScripts:'outside-only',url:'https://extension-test.invalid/'});
 const w=dom.window,doc=w.document,requests=[],rows=[],revisions={};let id=0;
 w.setTimeout=()=>1;
 w.browser={runtime:{sendMessage:async msg=>{
  requests.push(msg);let value;
  if(msg.action==='containers'||msg.action==='list')value=[];
  if(msg.action==='add'){value={id:String(++id),username:msg.username,label:msg.label,cookieStoreId:'container-'+id};rows.push(value);}
  if(msg.action==='prepare')value={tabId:Number(msg.id)};
  if(msg.action==='refresh')revisions[msg.id]=1;
  if(msg.action==='inspect')value={status:'awaiting-captcha',captchaImage:'data:image/png;base64,AAAA',captchaFingerprint:revisions[msg.id]?'changed':'common-image',challenge:'challenge-'+msg.id+(revisions[msg.id]?'-new':''),binding:{actualContainerId:'actual-'+msg.id,tabId:Number(msg.id),checkedAt:Date.now()},agreementAccepted:false};
  if(msg.action==='submit')value={status:'already-logged-in'};
  return {ok:true,value};
 }}};
 w.eval(fs.readFileSync(path.join(__dirname,'../bulk.js'),'utf8'));
 w.eval(fs.readFileSync(path.join(__dirname,'../panel.js'),'utf8'));await flush();
 for(const username of ['alice','bob']){doc.querySelector('#username').value=username;doc.querySelector('#label').value='<img src=x onerror=alert(1)>';doc.querySelector('#add-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();}
 assert.equal(doc.querySelectorAll('.account').length,2);assert.equal(doc.querySelectorAll('.title img').length,0);
 doc.querySelector('#prepare-all').click();await flush();assert.equal(requests.filter(x=>x.action==='prepare').length,2);
 doc.querySelector('#inspect-all').click();await flush();
 const cards=[...doc.querySelectorAll('.account')];
 cards.forEach((c,i)=>{assert.equal(c.querySelector('.agree').checked,true);assert.equal(c.dataset.challenge,'challenge-'+(i+1));c.querySelector('.password').value='SECRET-'+i;c.querySelector('.code').value='CODE-'+i;});
 assert.equal(doc.querySelectorAll('#captcha-workbench .code').length,2);
 assert.match(doc.querySelector('#captcha-warning').textContent,/完全相同/);
 assert.match(cards[0].querySelector('.binding-check').textContent,/actual-1/);
 assert.match(cards[1].querySelector('.binding-check').textContent,/actual-2/);
 cards[0].querySelector('[data-action=refresh]').click();await flush();
 assert.equal(cards[0].querySelector('.code').value,'');assert.equal(cards[1].querySelector('.code').value,'CODE-1');
 assert.equal(doc.querySelector('#captcha-warning').textContent,'');cards[0].querySelector('.code').value='CODE-0';
 doc.querySelector('#submit-codes').click();await flush();
 const submits=requests.filter(x=>x.action==='submit');assert.equal(submits.length,2);
 submits.forEach((m,i)=>{assert.equal(m.id,String(i+1));assert.equal(m.password,'SECRET-'+i);assert.equal(m.challenge,'challenge-'+(i+1)+(i===0?'-new':''));assert.equal(m.agree,true);});
 cards.forEach(c=>{assert.equal(c.querySelector('.password').value,'');assert.equal(c.querySelector('.code').value,'');});
 dom.window.close();
});

test('bulk form reuses saved accounts, fills passwords only locally and fetches all challenges',async()=>{
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../panel.html'),'utf8'),{runScripts:'outside-only',url:'https://extension-test.invalid/'});
 const w=dom.window,doc=w.document,requests=[];w.setTimeout=()=>1;
 const existing={id:'old',username:'alice',cookieStoreId:'c1'};
 w.browser={runtime:{sendMessage:async msg=>{requests.push(msg);let value;
  if(msg.action==='containers')value=[];if(msg.action==='list')value=[existing];
  if(msg.action==='add')value={id:'new',username:msg.username,cookieStoreId:'c2'};
  if(msg.action==='prepare')value={};
  if(msg.action==='inspect')value={status:'awaiting-captcha',challenge:msg.id,captchaImage:'data:image/png;base64,AAA',agreementAccepted:true};
  return {ok:true,value};
 }}};
 w.eval(fs.readFileSync(path.join(__dirname,'../bulk.js'),'utf8'));w.eval(fs.readFileSync(path.join(__dirname,'../panel.js'),'utf8'));await flush();
 doc.querySelector('#bulk-input').value='alice\tSECRET_A\nbob\tSECRET_B';
 doc.querySelector('#bulk-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
 for(let i=0;i<5;i++)await flush();
 assert.equal(doc.querySelector('#bulk-input').value,'');assert.equal(requests.filter(x=>x.action==='add').length,1);
 assert.equal(requests.filter(x=>x.action==='prepare').length,2);assert.equal(requests.filter(x=>x.action==='inspect').length,2);
 assert.doesNotMatch(JSON.stringify(requests),/SECRET/);
 assert.deepEqual([...doc.querySelectorAll('.password')].map(x=>x.value),['SECRET_A','SECRET_B']);dom.window.close();
});

test('separate entry rows validate before import, preserve password spaces and automatically allocate containers',async()=>{
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../panel.html'),'utf8'),{runScripts:'outside-only',url:'https://extension-test.invalid/'});
 const w=dom.window,doc=w.document,requests=[];w.setTimeout=()=>1;let next=0;
 w.browser={runtime:{sendMessage:async msg=>{requests.push(msg);let value=[];
  if(msg.action==='add')value={id:String(++next),username:msg.username,cookieStoreId:'auto-'+next};
  if(msg.action==='prepare')value={};
  if(msg.action==='inspect')value={status:'awaiting-captcha',challenge:msg.id,captchaImage:'data:image/png;base64,AAA',agreementAccepted:true};
  return {ok:true,value};
 }}};
 w.eval(fs.readFileSync(path.join(__dirname,'../bulk.js'),'utf8'));w.eval(fs.readFileSync(path.join(__dirname,'../panel.js'),'utf8'));await flush();
 assert.equal(doc.querySelectorAll('.entry-row').length,3);assert.equal(doc.querySelector('.entry-password').type,'password');
 const rows=[...doc.querySelectorAll('.entry-row')];rows[0].querySelector('.entry-user').value='alice';rows[0].querySelector('.entry-password').value=' pass with spaces ';
 rows[1].querySelector('.entry-user').value='alice';rows[1].querySelector('.entry-password').value='secret-b';
 doc.querySelector('#entry-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
 assert.equal(requests.filter(x=>x.action==='add').length,0);assert.match(doc.querySelector('#notice').textContent,/重复/);
 rows[1].querySelector('.entry-user').value='bob';
 doc.querySelector('#entry-form').dispatchEvent(new w.Event('submit',{cancelable:true}));for(let i=0;i<5;i++)await flush();
 const adds=requests.filter(x=>x.action==='add');assert.equal(adds.length,2);assert.ok(adds.every(x=>!x.cookieStoreId&&!x.password));
 assert.equal(doc.querySelector('.account .password').value,' pass with spaces ');
 assert.ok([...doc.querySelectorAll('.entry-password')].every(x=>x.value===''));
 doc.querySelector('#add-entry').click();assert.equal(doc.querySelectorAll('.entry-row').length,4);
 doc.querySelector('.entry-row button').click();assert.equal(doc.querySelectorAll('.entry-row').length,3);
 dom.window.close();
});

test('bulk submit reports missing passwords instead of silently skipping filled captcha rows',async()=>{
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../panel.html'),'utf8'),{runScripts:'outside-only',url:'https://extension-test.invalid/'});
 const w=dom.window,doc=w.document,calls=[];w.setTimeout=()=>1;
 w.browser={runtime:{sendMessage:async msg=>{calls.push(msg);return {ok:true,value:msg.action==='list'?[{id:'a',username:'alice',cookieStoreId:'c1'}]:[]};}}};
 w.eval(fs.readFileSync(path.join(__dirname,'../bulk.js'),'utf8'));w.eval(fs.readFileSync(path.join(__dirname,'../panel.js'),'utf8'));await flush();
 doc.querySelector('.code').value='1234';doc.querySelector('#submit-codes').click();await flush();
 assert.match(doc.querySelector('.status').textContent,/密码/);assert.match(doc.querySelector('#batch-result').textContent,/未提交.*1/);
 assert.equal(calls.filter(c=>c.action==='submit').length,0);dom.window.close();
});

test('rejected login retains local password for a captcha retry and reports actual success after recheck',async()=>{
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../panel.html'),'utf8'),{runScripts:'outside-only',url:'https://extension-test.invalid/'});
 const w=dom.window,doc=w.document,requests=[],timers=[];let attempts=0;
 w.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};w.clearTimeout=()=>{};
 w.browser={runtime:{sendMessage:async msg=>{requests.push(msg);let value=[];
  if(msg.action==='list')value=[{id:'a',username:'alice',cookieStoreId:'c1'}];
  if(msg.action==='submit'){attempts++;value={status:'submitted'};}
  if(msg.action==='inspect')value=attempts>=2?{status:'already-logged-in',identityKey:'key'}:{status:'awaiting-captcha',hintCode:attempts?'captcha':'',challenge:'challenge-'+attempts,captchaImage:'data:image/png;base64,AAA',agreementAccepted:true};
  return {ok:true,value};
 }}};
 w.eval(fs.readFileSync(path.join(__dirname,'../bulk.js'),'utf8'));w.eval(fs.readFileSync(path.join(__dirname,'../panel.js'),'utf8'));await flush();
 doc.querySelector('#inspect-all').click();await flush();
 const password=doc.querySelector('.password'),code=doc.querySelector('.code');password.value='LOCAL_SECRET';code.value='first';
 doc.querySelector('#submit-codes').click();for(let i=0;i<3;i++)await flush();
 assert.equal(password.value,'LOCAL_SECRET');assert.equal(code.value,'');assert.match(doc.querySelector('.status').textContent,/登录失败.*验证码/);assert.match(doc.querySelector('#batch-result').textContent,/失败 1/);
 code.value='second';doc.querySelector('#submit-codes').click();for(let i=0;i<3;i++)await flush();
 assert.equal(attempts,2);assert.equal(password.value,'');assert.match(doc.querySelector('#batch-result').textContent,/登录成功 1/);
 assert.equal(requests.filter(x=>x.action==='submit')[1].password,'LOCAL_SECRET');
 password.value='EXPIRES';timers.find(t=>t.ms===600000).fn();assert.equal(password.value,'');dom.window.close();
});
