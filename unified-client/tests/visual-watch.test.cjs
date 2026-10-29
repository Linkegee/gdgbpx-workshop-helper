'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {surfaceStats,createVisualWatch}=require('../visual-watch.cjs');
function bitmap(width=96,height=72,color=[255,255,255,255]){return Buffer.from(Array.from({length:width*height},()=>color).flat());}
test('only an almost entirely white page is a blank; a white slide with player chrome is healthy',()=>{
 assert.equal(surfaceStats(bitmap(),96,72).white,true);
 const slide=bitmap();for(let i=0;i<96*5*4;i+=4){slide[i]=30;slide[i+1]=90;slide[i+2]=150;}
 assert.equal(surfaceStats(slide,96,72).white,false);
 assert.equal(surfaceStats(bitmap(96,72,[0,0,0,255]),96,72).white,false);
 assert.equal(surfaceStats(Buffer.alloc(0),0,0).available,false);
});
function fixture({white=true,heal=true,layer=true,manual=false}={}){
 let paints=0,captures=0,now=100000;const context={accountId:'a',kind:'player',eligible:true,ready:true,manualHold:manual,selected:true,layerOk:layer};
 const watch=createVisualWatch({context:()=>context,capture:async()=>{captures++;return{available:true,white};},repair:async()=>{paints++;if(heal){white=false;context.layerOk=true;}},changed:()=>{},sleep:async()=>{},now:()=>now});
 return{watch,context,get paints(){return paints;},get captures(){return captures;},advance(ms){now+=ms;}};
}
test('two separated blank frames trigger automatic repaint and verify two nonblank frames',async()=>{
 const f=fixture();await f.watch.scan(1);assert.equal(f.paints,0);f.advance(10000);await f.watch.scan(1);assert.equal(f.paints,1);assert.equal(f.watch.get(1).phase,'recovered');assert.ok(f.captures>=4);
});
test('frequent samples retain the first blank timestamp instead of postponing recovery forever',async()=>{
 const f=fixture();for(let i=0;i<6;i++){await f.watch.scan(1);f.advance(1000);}assert.equal(f.paints,1);assert.equal(f.watch.get(1).phase,'recovered');
});
test('missing or briefly nonblank samples cannot erase an unresolved white screen',async()=>{
 let time=10000,frame={available:true,white:true},sequence=[];
 const w=createVisualWatch({context:()=>({accountId:'a',eligible:true,ready:true}),capture:async()=>sequence.length?sequence.shift():frame,repair:async()=>{},changed:()=>{},now:()=>time,sleep:async()=>{}});
 await w.scan(1);time+=10000;await w.scan(1);assert.equal(w.get(1).phase,'needs-help');
 frame={available:false};await w.scan(1);assert.equal(w.get(1).phase,'needs-help');
 sequence=[{available:true,white:false},{available:true,white:true}];await w.scan(1);assert.equal(w.get(1).phase,'needs-help');
 frame={available:true,white:false};await w.scan(1);assert.equal(w.get(1).phase,'healthy');
});
test('a hidden selected view is repaired even when media and its own rendered surface are healthy',async()=>{
 const f=fixture({white:false,layer:false});await f.watch.scan(1);assert.equal(f.paints,1);assert.equal(f.watch.get(1).phase,'recovered');
});
test('navigation during capture cancels stale detection without repairing the new document',async()=>{
 let finish;const changes=[];
 const w=createVisualWatch({context:()=>({eligible:true,ready:true,selected:true,layerOk:false}),capture:()=>new Promise(r=>finish=r),repair:async()=>assert.fail('old document cannot repair new page'),changed:(_,v)=>changes.push(v)});
 const pending=w.scan(1);w.remove(1);finish({available:true,white:true});await pending;assert.equal(w.get(1),null);assert.equal(changes.length,0);
});
test('permanent white stops after two repaints, reports failure and does not loop',async()=>{
 const f=fixture({heal:false});await f.watch.scan(1);f.advance(10000);await f.watch.scan(1);assert.equal(f.paints,2);assert.equal(f.watch.get(1).phase,'needs-help');f.advance(60000);await f.watch.scan(1);assert.equal(f.paints,2);
});
test('navigation cannot reset the per-account hourly repaint budget',async()=>{
 const f=fixture({heal:false});
 for(let i=0;i<3;i++){f.watch.remove(1);await f.watch.scan(1);f.advance(10000);await f.watch.scan(1);}
 assert.equal(f.paints,3);assert.equal(f.watch.get(1).phase,'needs-help');
});
test('manual holds, loading, capture failures and a single white frame never reload or alarm',async()=>{
 const f=fixture({manual:true});await f.watch.scan(1);assert.equal(f.paints,0);assert.equal(f.captures,0);
 const g=fixture();g.context.ready=false;await g.watch.scan(1);assert.equal(g.captures,0);
 const h=createVisualWatch({context:()=>({eligible:true,ready:true}),capture:async()=>{throw Error();},repair:async()=>assert.fail('capture error is not white'),changed:()=>{},sleep:async()=>{}});await h.scan(1);assert.equal(h.get(1).phase,'capture-unavailable');
});
