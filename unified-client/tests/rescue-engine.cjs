'use strict';
// Explicit integration test (not npm test): real read-only Codex decision,
// synthetic client/diagnostics only. It never touches real accounts or Bark.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'..','test-data','rescue-'+Date.now()),id=randomUUID();fs.mkdirSync(path.join(root,'diagnostics'),{recursive:true});
const write=(name,v)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(v));fs.renameSync(file+'.tmp',file);};
let requested=false,startAt=0,attempts=0;
write('watch-targets.json',{accounts:[{id,classId:'fixture-topic'}]});
function update(){
 write('diagnostics/latest.json',{clientVersion:'0.1.6',generatedAt:new Date().toISOString(),accounts:[{id,tabs:[],scopes:[requested?{status:'running',phase:'watching-video',progress:10,media:{lessonKey:'fixture',currentTime:10+(Date.now()-startAt)/1000}}:{status:'paused',phase:'player-open-failed',progress:0,media:{lessonKey:'fixture',currentTime:0}}]}]});
 const dir=path.join(root,'control/inbox');if(!fs.existsSync(dir))return;
 for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.json'))){const r=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));assert.equal(r.accountId,id);assert.equal(r.action,'retry');attempts++;requested=true;startAt=Date.now();write('control/results/'+r.id+'.json',{...r,result:'dispatched-needs-verification'});fs.unlinkSync(path.join(dir,name));}
}
update();const timer=setInterval(update,500),child=spawn(process.execPath,[path.join(__dirname,'..','rescue-worker.cjs'),'--root',root,'--self-test'],{windowsHide:true,stdio:'ignore',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
(async()=>{try{const deadline=Date.now()+110000;while(Date.now()<deadline){await new Promise(r=>setTimeout(r,500));const f=path.join(root,'rescue-ledger.json');if(fs.existsSync(f)&&Object.values(JSON.parse(fs.readFileSync(f,'utf8')).incidents||{}).some(x=>x.status==='recovered-verified')){assert.equal(attempts,1);assert.equal(fs.existsSync(path.join(root,'fixture-alert.json')),false);console.log('RESCUE ENGINE PASS: local fault triggers real Codex; scoped retry receipt; fresh progress verifies recovery; no healthy model calls or Bark');return;}}throw Error('rescue integration timed out');}catch(e){console.error(e.message);process.exitCode=1;}finally{clearInterval(timer);child.kill();}})();
