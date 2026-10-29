'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createBatch}=require('../batch.cjs');
test('bulk command reserves all operator holds before sending and isolates failures',async()=>{
 const events=[],batch=createBatch({ids:()=>['a','b','c'],prepare:(id,a)=>events.push('hold:'+id+':'+a),dispatch:async(id)=>{events.push('send:'+id);if(id==='b')throw Error();return 'ok';},changed:()=>{},sleep:async()=>{}});
 await batch.run('stop');assert.deepEqual(events.slice(0,3),['hold:a:stop','hold:b:stop','hold:c:stop']);assert.equal(batch.state.results.length,3);assert.equal(batch.state.results[1].result,'dispatch-failed');assert.equal(batch.state.running,false);
});
test('stop cancels a pending start queue; unknown IDs cannot receive a command',async()=>{
 const sent=[];let release;const gate=new Promise(r=>release=r);
 const batch=createBatch({ids:()=>['a','b'],prepare:()=>{},dispatch:async(id,a)=>{sent.push(a+':'+id);if(a==='start')await gate;return 'ok';},changed:()=>{},sleep:async()=>{}});
 const start=batch.run('start',['a','b','foreign']);await batch.run('stop');release();await start;
 assert.deepEqual(sent,['start:a','stop:a','stop:b']);assert.equal(batch.state.action,'stop');assert.equal(batch.state.results.length,2);
});
