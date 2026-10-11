const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{webcrypto}=require('node:crypto');
const {JSDOM}=require('../../.panel-test-runtime/node_modules/jsdom');
function fixture(pageFetch){
 const dom=new JSDOM('<body>专题页</body>',{runScripts:'outside-only',url:'https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop/workshopindex/classList'}),w=dom.window;let listener;
 Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;
 if(pageFetch)w.content={fetch:pageFetch};w.fetch=()=>{throw Error('MUST_NOT_USE_EXTENSION_FETCH');};
 w.browser={runtime:{id:'test',onMessage:{addListener:fn=>listener=fn}}};w.eval(fs.readFileSync(require.resolve('../hours-content.js'),'utf8'));
 return {dom,read:()=>listener({channel:'gdgbpx-hours-v1',action:'inspect'},{id:'test'})};
}
test('hours request uses page context and inert HTML without navigating or exposing identity marker',async()=>{
 const f=fixture(async(url,options)=>{assert.equal(url,'https://gbpx.gd.gov.cn/gdceportal/index.aspx');assert.equal(options.credentials,'include');assert.equal(options.redirect,'error');return {ok:true,text:async()=>'<span id="ctl00_thetheUser">SECRET_MARKER</span><div id="header_right_box">测试姓名 已关联微信 累计学时:18.6/50</div><script>window.bad=true</script>'};});
 const result=await f.read();assert.equal(result.name,'测试姓名');assert.equal(result.creditedHours,18.6);assert.equal(result.identityKey.length,64);assert.doesNotMatch(JSON.stringify(result),/SECRET_MARKER/);assert.equal(f.dom.window.bad,undefined);assert.equal(f.dom.window.document.body.textContent,'专题页');f.dom.window.close();
});
test('missing page fetch never falls back to extension-global session',async()=>{const f=fixture();assert.equal((await f.read()).status,'page-fetch-unavailable');f.dom.window.close();});
test('expired login is not reported as zero hours',async()=>{const f=fixture(async()=>({ok:true,text:async()=>'<input id="txtLoginName">'}));const r=await f.read();assert.equal(r.status,'login-required');assert.equal(r.creditedHours,undefined);f.dom.window.close();});
