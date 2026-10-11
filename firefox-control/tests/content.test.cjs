const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const {webcrypto}=require('node:crypto');
function fixture(){
 let listener,clicks=0,received=null,logged='',imageData='data:image/png;base64,AAA';
 class Input{constructor(){this._value='';this.checked=false;}get value(){return this._value;}set value(v){this._value=v;}dispatchEvent(){}click(){this.checked=!this.checked;}}
 const nodes={'#txtLoginName':new Input(),'#txtPassword':new Input(),'#txtValid':new Input(),'#cbAgree':new Input(),
 '#ctl00_thetheUser':{get textContent(){return logged;}},'#header_right_box':{innerText:'测试姓名 已关联微信 累计学时:2.0/50.0'},'#hintMsg':{innerText:''},
 '#imgValid':{complete:true,naturalWidth:80,naturalHeight:30,currentSrc:'https://gbpx.gd.gov.cn/VerifyChar.aspx?id=1',click(){this.currentSrc+='x';imageData+='B';}},
 '#user-login-form .loginBtnBox[onclick*="lnkbtnLogin"]':{click(){clicks++;received={username:nodes['#txtLoginName'].value,password:nodes['#txtPassword'].value,code:nodes['#txtValid'].value,agree:nodes['#cbAgree'].checked};}}};
 const ctx={HTMLInputElement:Input,Event:class{},crypto:webcrypto,Date,document:{querySelector:s=>nodes[s]||null,createElement:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=>imageData})},browser:{runtime:{id:'test',onMessage:{addListener:fn=>listener=fn}}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../login-content.js'),'utf8'),ctx);
 return {nodes,send:(action,data={},sender={id:'test'})=>listener({channel:'gdgbpx-login-v1',action,...data},sender),clicks:()=>clicks,received:()=>received,login:()=>logged='opaque-id'};
}
test('same-session captcha and user-approved agreement submit native form once then clear secrets',async()=>{
 const f=fixture(),snapshot=await f.send('inspect');assert.equal(snapshot.status,'awaiting-captcha');
 const result=await f.send('submit',{username:'alice',password:'SECRET',captcha:'1234',challenge:snapshot.challenge,agree:true});
 assert.equal(result.status,'submitted');assert.equal(f.clicks(),1);assert.deepEqual(f.received(),{username:'alice',password:'SECRET',code:'1234',agree:true});
 assert.equal(f.nodes['#txtPassword'].value,'');assert.equal(f.nodes['#txtValid'].value,'');
 const second=await f.send('submit',{username:'alice',password:'SECRET',captcha:'1234',challenge:snapshot.challenge,agree:true});
 assert.equal(second.status,'submission-pending');assert.equal(f.clicks(),1);
});
test('stale captcha and unchecked agreement do not fill or submit credentials',async()=>{
 const f=fixture(),first=await f.send('inspect');await f.send('refresh');
 assert.equal((await f.send('submit',{username:'a',password:'SECRET',captcha:'x',challenge:first.challenge,agree:true})).status,'captcha-changed');
 const next=await f.send('inspect');assert.equal((await f.send('submit',{username:'a',password:'SECRET',captcha:'x',challenge:next.challenge,agree:false})).status,'agreement-required');
 assert.equal(f.clicks(),0);assert.equal(f.nodes['#txtPassword'].value,'');
});
test('existing login is reported for verification without overwriting its session',async()=>{
 const f=fixture();f.login();const result=await f.send('submit',{password:'SECRET',agree:true});
 assert.equal(result.status,'logged-in-unverified');assert.equal(result.name,'测试姓名');assert.equal(result.creditedHours,2);assert.equal(f.clicks(),0);
});
test('foreign sender cannot command content script; no image fetch is used to mutate captcha',async()=>{
 const f=fixture();assert.equal(f.send('inspect',{}, {id:'foreign'}),undefined);
 const a=await f.send('inspect'),b=await f.send('inspect');assert.equal(a.challenge,b.challenge);
});
