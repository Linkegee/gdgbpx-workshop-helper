const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('../../.panel-test-runtime/node_modules/jsdom');
const flush=()=>new Promise(r=>setImmediate(r));
test('real panel DOM adds accounts, escapes labels, batches distinct challenges and clears passwords',async()=>{
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../panel.html'),'utf8'),{runScripts:'outside-only',url:'https://extension-test.invalid/'});
 const w=dom.window,doc=w.document,requests=[],rows=[];let id=0;
 w.setTimeout=()=>1;
 w.browser={runtime:{sendMessage:async msg=>{
  requests.push(msg);let value;
  if(msg.action==='containers'||msg.action==='list')value=[];
  if(msg.action==='add'){value={id:String(++id),username:msg.username,label:msg.label,cookieStoreId:'container-'+id};rows.push(value);}
  if(msg.action==='prepare')value={tabId:Number(msg.id)};
  if(msg.action==='inspect')value={status:'awaiting-captcha',captchaImage:'data:image/png;base64,AAAA',challenge:'challenge-'+msg.id,agreementAccepted:false};
  if(msg.action==='submit')value={status:'submitted'};
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
 doc.querySelector('#submit-all').click();await flush();
 const submits=requests.filter(x=>x.action==='submit');assert.equal(submits.length,2);
 submits.forEach((m,i)=>{assert.equal(m.id,String(i+1));assert.equal(m.password,'SECRET-'+i);assert.equal(m.challenge,'challenge-'+(i+1));assert.equal(m.agree,true);});
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
