const {test}=require('node:test');const assert=require('node:assert/strict');
const {createProgressNotifier}=require('../src/progress-notifier.cjs');
function setup(){let now=1000000;const values=new Map(),sent=[];const api={GM_getValue:(k,f)=>values.has(k)?values.get(k):f,GM_setValue:(k,v)=>values.set(k,v),GM_deleteValue:k=>values.delete(k),GM_xmlhttpRequest:r=>sent.push(r)};const n=createProgressNotifier(api,'account-A',()=>now);n.configure('fake-test-key',10);return {n,api,values,sent,advance:m=>now+=m*60000};}
const state={status:'running',phase:'watching-video',currentLessonKey:'lesson',currentLessonTitle:'测试课',currentLessonProgress:10};
test('stalled progress alerts once, survives reload, rearms only on progress',()=>{const h=setup();h.n.tick(state);h.advance(10);h.n.tick(state);assert.equal(h.sent.length,1);h.n.tick(state);assert.equal(h.sent.length,1);createProgressNotifier(h.api,'account-A',()=>1600000).tick(state);assert.equal(h.sent.length,1);h.n.tick({...state,currentLessonProgress:11});h.advance(10);h.n.tick({...state,currentLessonProgress:11});assert.equal(h.sent.length,2);assert.equal(JSON.parse(h.sent[0].data).device_key,'fake-test-key');});
test('manual pause stop completion and maintenance suppress; error pause alerts',()=>{for(const change of [{status:'paused',userPaused:true},{status:'stopped'},{status:'complete'},{maintenance:{}}]){const h=setup();h.n.tick(state);h.advance(11);h.n.tick({...state,...change});assert.equal(h.sent.length,0);}const h=setup();h.n.tick(state);h.advance(11);h.n.tick({...state,status:'paused',phase:'player-open-failed'});assert.equal(h.sent.length,1);});
test('accounts stay isolated and network uncertainty does not retry or retain secrets in ledger',()=>{const h=setup();const b=createProgressNotifier(h.api,'account-B',()=>1600000);h.n.tick(state);h.advance(10);h.n.tick(state);b.tick(state);assert.equal(h.sent.length,1);h.sent[0].ontimeout();h.advance(30);h.n.tick(state);assert.equal(h.sent.length,1);assert.ok(!JSON.stringify(h.values.get('gdgbpx_bark_watch_v1:account-A')).includes('fake-test-key'));});
test('disabled config and changing lessons do not generate stale alerts',()=>{const h=setup();h.n.tick(state);h.advance(11);h.n.tick({...state,currentLessonKey:'next'});assert.equal(h.sent.length,0);h.n.configure('');h.advance(11);h.n.tick(state);assert.equal(h.sent.length,0);});

test('manual test uses same transport without altering monitor ledger and throttles repeat clicks',()=>{const h=setup();h.n.tick(state);const before=JSON.stringify(h.values.get('gdgbpx_bark_watch_v1:account-A'));let result;h.n.test(r=>result=r);assert.equal(h.sent.length,1);assert.match(JSON.parse(h.sent[0].data).title,/测试/);h.sent[0].onload({status:200,responseText:'{"code":200}'});assert.equal(result,'accepted');assert.equal(JSON.stringify(h.values.get('gdgbpx_bark_watch_v1:account-A')),before);h.n.test(r=>result=r);assert.equal(result,'rate-limited');assert.equal(h.sent.length,1);});
test('manual test reports missing configuration, rejected response and timeout',()=>{const h=setup();let result;h.n.configure('');h.n.test(r=>result=r);assert.equal(result,'not-configured');assert.equal(h.sent.length,0);h.n.configure('fake-test-key');h.n.test(r=>result=r);h.sent[0].onload({status:200,responseText:'bad-json'});assert.equal(result,'rejected');h.advance(1);h.n.test(r=>result=r);h.sent[1].ontimeout();assert.equal(result,'delivery-unknown');});

test('authorization failure alerts promptly without course progress and deduplicates across reload',()=>{
 const h=setup(),failed={...state,status:'paused',phase:'login-required',currentLessonKey:''};
 h.n.tick(failed);assert.equal(h.sent.length,1);assert.match(JSON.parse(h.sent[0].data).body,/授权|登录/);
 h.n.tick(failed);createProgressNotifier(h.api,'account-A',()=>1000001).tick(failed);assert.equal(h.sent.length,1);
 h.n.tick(state);h.n.tick(failed);assert.equal(h.sent.length,2);
});
test('manual pause and maintenance suppress exception alerts',()=>{
 for(const change of [{userPaused:true},{maintenance:{notice:'maintenance'}}]){
  const h=setup();h.n.tick({...state,status:'paused',phase:'login-required',...change});assert.equal(h.sent.length,0);
 }
});
test('maintenance login failure and unresolved lesson mismatch alert without cross-account spill',()=>{
 for(const phase of ['maintenance-login','player-lesson-mismatch','identity-entry-failed','completed-close-failed']){
  const h=setup();h.n.tick({...state,status:'paused',phase,maintenance:phase==='maintenance-login'?{}:null});
  assert.equal(h.sent.length,1,phase);h.n.tick({...state,status:'paused',phase,maintenance:phase==='maintenance-login'?{}:null});assert.equal(h.sent.length,1);
 }
});
test('stuck navigation before a course is selected still alerts without pretending a course exists',()=>{
 const h=setup(),waiting={...state,phase:'entering-workshop',currentLessonKey:'',currentLessonTitle:''};
 h.n.tick(waiting);h.advance(10);h.n.tick(waiting);assert.equal(h.sent.length,1);
 assert.match(JSON.parse(h.sent[0].data).body,/未知/);
});
test('exports an automatic incident once, without exporting for manual pause',()=>{
 const h=setup(),events=[],failed={...state,status:'paused',phase:'login-required'};
 h.n.tick(failed,reason=>events.push(reason));h.n.tick(failed,reason=>events.push(reason));
 assert.deepEqual(events,['login-required']);
 const other=setup();other.n.tick({...failed,userPaused:true},reason=>events.push(reason));assert.deepEqual(events,['login-required']);
});
