const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('../../.panel-test-runtime/node_modules/jsdom');
test('study reader extracts only bounded numeric evidence, not names, secrets or raw URLs',async()=>{
 const dom=new JSDOM(`<body><input value="SECRET"><div id="gbpx-helper-panel"><div class="gbpx-title">专题学习助手 v1.5.43</div><div data-role="lesson">课程：PRIVATE_TITLE</div><button data-action="pause"></button></div><div id="pane-required"><div class="item_box"><span class="item_title">PRIVATE_TITLE</span><span>学时：1.5</span><span class="item_status">已完成</span></div><div class="item_box"><span>学分：2</span><span class="item_status">未完成</span></div></div>`,{runScripts:'outside-only',url:'https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop/workshopindex/mergeClass?classId=private'});
 let listener;dom.window.browser={runtime:{id:'test',onMessage:{addListener:fn=>listener=fn}}};
 dom.window.eval(fs.readFileSync(require.resolve('../study-content.js'),'utf8'));
 assert.equal(listener({channel:'gdgbpx-study-v1',action:'inspect'},{id:'other'}),undefined);
 const value=await listener({channel:'gdgbpx-study-v1',action:'inspect'},{id:'test'});
 assert.equal(value.rows.length,2);assert.equal(value.rows[0].completed,true);assert.equal(value.rows[1].completed,false);assert.equal(value.rows[0].hourLabels[0],'学时：1.5');assert.equal(value.helperRunning,true);
 assert.doesNotMatch(JSON.stringify(value),/SECRET|PRIVATE_TITLE|classId|https:/);dom.window.close();
});

test('dashboard shows verified hours, unknown completed total and explicitly unverified playback',async()=>{
 const dom=new JSDOM(fs.readFileSync(require.resolve('../panel.html'),'utf8'),{runScripts:'outside-only'}),w=dom.window;
 w.browser={runtime:{sendMessage:async m=>({ok:true,value:m.action==='list'?[{id:'a',username:'示例',cookieStoreId:'c1'}]:m.action==='study'?{status:'already-logged-in',name:'测试姓名',creditedHours:20,completedHours:null,at:Date.now(),tabs:[{evidence:{helperPresent:true,helperRunning:true}}]}:[]})}};
 w.eval(fs.readFileSync(require.resolve('../panel.js'),'utf8'));await new Promise(r=>setImmediate(r));
 w.document.querySelector('#study-all').click();await new Promise(r=>setImmediate(r));
 const row=w.document.querySelector('#study-accounts tr');assert.match(row.children[0].textContent,/测试姓名/);assert.equal(row.children[1].textContent,'20 / 50');assert.equal(row.children[2].textContent,'待核实');assert.match(row.children[3].textContent,/未验证视频播放/);
 w.browser.runtime.sendMessage=async()=>({ok:false,error:'连接失效'});row.querySelector('button').click();await new Promise(r=>setImmediate(r));assert.equal(row.children[1].textContent,'读取失败');dom.window.close();
});
