const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('only exact extension panel may send commands; arbitrary errors are redacted',async()=>{
 let handler,calls=0;const url='moz-extension://test/panel.html';
 const ctx={GanbuController:class{async list(){calls++;throw Error('SECRET credential URL');}},browser:{runtime:{id:'test',getURL:()=>url,onMessage:{addListener:fn=>handler=fn}},browserAction:{onClicked:{addListener(){}}}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../background.js'),'utf8'),ctx);
 for(const sender of [{id:'test',url:'https://gbpx.gd.gov.cn/gdceportal/index.aspx'},{id:'other',url},{id:'test',url:url+'?spoof=1'}])assert.equal(handler({action:'list'},sender),undefined);
 assert.equal(calls,0);const result=await handler({action:'list'},{id:'test',url});assert.equal(result.ok,false);assert.doesNotMatch(result.error,/SECRET/);
});
