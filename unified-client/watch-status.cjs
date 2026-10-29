'use strict';
const fs=require('node:fs'),path=require('node:path');
function evaluate(targets,diagnostics,previous={},now=Date.now()){
 const fresh=diagnostics&&now-Date.parse(diagnostics.generatedAt)<120000;
 const samples={},results=[];
 for(const [index,target]of (targets.accounts||[]).entries()){
  const account=diagnostics?.accounts?.find(a=>a.id===target.id),state=account?.scopes?.find(s=>s.status==='running')||account?.scopes?.[0];
  const topic=account?.learning?.workshops?.[target.classId];
  const before=previous.samples?.[target.id],media=state?.media,lesson=media?.lessonKey||state?.lesson;
  const changed=before?.lesson!==lesson,advancing=(Number.isFinite(media?.currentTime)&&Number.isFinite(before?.time)&&media.currentTime>before.time+0.1)||(Number.isFinite(state?.progress)&&Number.isFinite(before?.progress)&&state.progress>before.progress);
  const sample={lesson,time:media?.currentTime,at:now,lastAdvance:changed||advancing||!before?now:before.lastAdvance,progress:state?.progress};samples[target.id]=sample;
  let status='healthy',action=null;
  if(!fresh||!account)status='offline-or-stale';
  else if(topic?.allCompleted&&topic.total>0&&topic.completed===topic.total)status='complete';
  else if(['login-required','account-context-changed','identity-entry-failed','maintenance-login'].includes(state?.phase))status='needs-login';
  else if(account.manualHold||!state||state.userPaused||['idle','stopped','complete'].includes(state.status))status='manual-hold-or-unverified-completion';
  else if(state.maintenance)status='maintenance';
  else if(state.status==='paused'){
   if(['player-open-failed','player-stalled','completed-close-failed','completion-unverified'].includes(state.phase)){status='recoverable';action='retry';}else status='needs-user';
  }else if(account.tabs?.some(t=>t.issue)){status='recoverable';action=account.tabs.some(t=>t.issue&&t.kind==='player')?'reload-player':'reload-main';}
  else if(now-sample.lastAdvance>=300000){status='recoverable';action='reload-main';}
  if(action&&String(diagnostics.clientVersion||'').localeCompare('0.1.5',undefined,{numeric:true})<0){status='upgrade-required';action=null;}
  results.push({ordinal:index+1,id:target.id,status,action,phase:state?.phase,lesson:lesson?require('node:crypto').createHash('sha256').update(String(lesson)).digest('hex').slice(0,16):null,progress:state?.progress,mediaTime:media?.currentTime,advancing,topicCompleted:topic?.completed,topicTotal:topic?.total});
 }
 return {at:new Date(now).toISOString(),clientVersion:diagnostics?.clientVersion,diagnosticsFresh:Boolean(fresh),allComplete:results.length===8&&results.every(r=>r.status==='complete'),results,samples};
}
function run(){const root=path.join(process.env.APPDATA,'GanbuUnifiedClient'),read=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,''));}catch{return fallback;}};
 const targets=read('watch-targets.json',{accounts:[]}),before=read('watch-state.json',{}),value=evaluate(targets,read('diagnostics/latest.json',null),before);
 fs.writeFileSync(path.join(root,'watch-state.json.tmp'),JSON.stringify({...before,...value}));fs.renameSync(path.join(root,'watch-state.json.tmp'),path.join(root,'watch-state.json'));
 console.log(JSON.stringify({...value,samples:undefined},null,2));
}
if(require.main===module)run();module.exports={evaluate};
