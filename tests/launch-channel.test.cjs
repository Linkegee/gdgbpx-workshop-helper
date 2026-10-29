const {test}=require('node:test');
const assert=require('node:assert/strict');
const {BroadcastChannel}=require('node:worker_threads');
const {randomUUID}=require('node:crypto');
const {createLaunchChannel}=require('../src/launch-channel.cjs');
function channel() {
    return createLaunchChannel({Channel:BroadcastChannel,
        setTimeout:(fn,ms)=>setTimeout(fn,ms===10000?100:2000),clearTimeout});
}
test('two simultaneous one-time channels deliver only their own target and release resources',async()=>{
    const a=channel(),b=channel(),first=randomUUID(),second=randomUUID();
    const closeA=a.publish(first,'https://cs1.gdgbpx.com/a?t=synthetic-a',()=>true);
    const closeB=b.publish(second,'https://cs1.gdgbpx.com/b?t=synthetic-b',()=>true);
    try {
        const targets=await Promise.all([b.receive(first),a.receive(second)]);
        assert.deepEqual(targets,['https://cs1.gdgbpx.com/a?t=synthetic-a','https://cs1.gdgbpx.com/b?t=synthetic-b']);
    } finally {closeA();closeB();}
});
test('an invalidated source sends no credentials and the receiver times out',async()=>{
    const c=channel(),id=randomUUID(),close=c.publish(id,'synthetic-secret',()=>false);
    try {await assert.rejects(c.receive(id),/启动主页面未响应/);} finally {close();}
});
