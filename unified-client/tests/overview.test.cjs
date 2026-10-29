const {test}=require('node:test'),assert=require('node:assert/strict');
const {accountOverview,overviewTotals}=require('../overview.js');
test('overview keeps missing annual hours unknown and counts only fully verified topic credits',()=>{
 const a={id:'a',name:'账号1',states:[{status:'running',classId:'t',progress:0,media:{at:1000,paused:false}}],learning:{workshops:{t:{at:1000,completed:2,total:3,completedHours:1.5,totalHours:3,verificationComplete:true}}}};
 const r=accountOverview(a,1100);assert.equal(r.home,undefined);assert.equal(r.progress,0);assert.equal(r.playing,true);assert.equal(r.stale,false);
 const missing=accountOverview({id:'b',states:[]},1100),sum=overviewTotals([r,missing]);assert.equal(sum.known,1);assert.equal(sum.hours,1.5);assert.equal(sum.total,3);assert.equal(sum.accounts,2);
 assert.equal(accountOverview(a,200000).playing,false);assert.equal(accountOverview(a,200000).stale,true);
});
