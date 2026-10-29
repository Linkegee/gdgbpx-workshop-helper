'use strict';
const {randomUUID}=require('node:crypto');
const HOSTS=new Set(['gbpx.gd.gov.cn','wcs1.shawcoder.xyz','cs1.gdgbpx.com']);
function allowedPage(value) {
  try {const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && HOSTS.has(u.hostname) && !u.port;} catch {return false;}
}
function partition(id) {
  if(!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid account id');
  return 'persist:gdgbpx-'+id;
}
function account(name) {return {id:randomUUID(),name:String(name||'新账号').slice(0,40)};}
function summarize(values,scopes=null) {
  return Object.entries(values).filter(([key])=>key.endsWith(':gdgbpx_workshop_helper_state_v1')&&(!scopes||scopes.has(key.split(':')[1])))
    .map(([,s])=>({status:s.status,phase:s.phase,message:String(s.message||'').slice(0,220),workshop:String(s.currentWorkshopTitle||''),classId:s.currentClassId||'',finishedWorkshops:s.finishedWorkshopTitles||[],
      lesson:String(s.currentLessonTitle||'').slice(0,120),progress:s.currentLessonProgress}));
}
function latestTask(values){return Object.entries(values).filter(([k])=>k.endsWith(':gdgbpx_workshop_helper_state_v1')).map(([k,state])=>({state,at:Date.parse(values[k.replace('state_v1','logs_v1')]?.at(-1)?.time||'')||Number(state.lastActionAt)||0})).sort((a,b)=>b.at-a.at)[0]?.state||null;}
function canResume(id,values,targets){const target=targets?.accounts?.find(t=>t.id===id),state=latestTask(values);return Boolean(target&&!target.done&&state?.status==='running'&&!state.userPaused&&!values.__clientLearning?.workshops?.[target.classId]?.allCompleted);}
module.exports={allowedPage,partition,account,summarize,latestTask,canResume};
