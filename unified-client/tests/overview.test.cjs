const {test}=require('node:test'),assert=require('node:assert/strict');
const {accountOverview,overviewTotals}=require('../overview.js');
test('informal total adds partial-topic completed hours and avoids counting credited or ambiguous completed topics twice',()=>{
 const a={states:[{classId:'t'}],learning:{required:{earned:36,target:50},workshops:{t:{completedHours:9,totalHours:18,verificationComplete:true,allCompleted:false}}}};
 assert.equal(accountOverview(a).unofficial,45);
 a.learning.workshops.t.allCompleted=true;let r=accountOverview(a);assert.equal(r.unofficial,36);assert.equal(r.creditUnknown,1);
 a.learning.workshops.t.creditStatus='pending';assert.equal(accountOverview(a).unofficial,45);
 a.learning.workshops.t.creditStatus='credited';assert.equal(accountOverview(a).unofficial,36);
 a.learning.required.target=25;assert.equal(accountOverview(a).required.target,50);assert.equal(accountOverview(a).required.websiteTarget,25);assert.equal(a.learning.required.target,25);
});
test('overview keeps missing annual hours unknown and counts only fully verified topic credits',()=>{
 const a={id:'a',name:'账号1',states:[{status:'running',classId:'t',progress:0,media:{at:1000,paused:false}}],learning:{workshops:{t:{at:1000,completed:2,total:3,completedHours:1.5,totalHours:3,verificationComplete:true}}}};
 const r=accountOverview(a,1100);assert.equal(r.home,undefined);assert.equal(r.progress,0);assert.equal(r.playing,true);assert.equal(r.stale,false);
 const missing=accountOverview({id:'b',states:[]},1100),sum=overviewTotals([r,missing]);assert.equal(sum.known,1);assert.equal(sum.hours,1.5);assert.equal(sum.total,3);assert.equal(sum.accounts,2);
 assert.equal(accountOverview(a,200000).playing,false);assert.equal(accountOverview(a,200000).stale,true);
});
