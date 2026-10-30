'use strict';
// Current user policy: all study is through required-credit workshops.
const STUDY_HOURS_TARGET=50;
function accountOverview(a,now=Date.now()){
 const s=(a.states||[]).filter(s=>s.status==='running').sort((a,b)=>(b.media?.at||0)-(a.media?.at||0))[0]||a.states?.[0];
 const topic=a.learning?.workshops?.[s?.classId||a.learning?.currentClassId];
 const fresh=at=>Number.isFinite(at)&&now-at<=120000;
 const issue=a.tabs?.some(t=>t.issue||t.visualHealth?.phase==='needs-help')||['login-required','account-context-changed','player-open-failed','player-stalled'].includes(s?.phase);
 const ended=s?.media?.duration>0&&s.media.currentTime>=s.media.duration-1&&s.media.paused===true;
 const playing=s?.status==='running'&&s.media?.paused===false&&fresh(s.media.at);
 const status=issue?'需处理':topic?.allCompleted?'专题已完成':ended?'结束待核验':playing?'播放中':s?.status==='running'?'等待播放确认':s?.status==='paused'?'已暂停':s?.status==='stopped'?'已停止':'未启动';
 const rawRequired=a.learning?.required;
 const required=rawRequired?{...rawRequired,websiteTarget:rawRequired.target,target:STUDY_HOURS_TARGET}:null;
 const topics=Object.values(a.learning?.workshops||{}),pending=topics.filter(t=>(t.creditStatus==='pending'||(t.creditStatus!=='credited'&&t.verificationComplete&&!t.allCompleted))&&Number.isFinite(t.completedHours));
 const unknown=topics.filter(t=>t.creditStatus!=='credited'&&t.creditStatus!=='pending'&&t.allCompleted&&t.completedHours>0);
 const pendingHours=pending.reduce((n,t)=>n+t.completedHours,0);
 const media=s?.media,matchingMedia=media&&(!media.lessonTitle||media.lessonTitle===s?.lesson)&&fresh(media.at);
 return {required,pendingHours,creditUnknown:unknown.length,unofficial:required?Math.round((required.earned+pendingHours)*100)/100:null,media:matchingMedia?media:null,id:a.id,name:a.name,status,attention:Boolean(issue),playing,topic,home:a.learning?.home,lesson:s?.lesson,progress:s?.progress,stale:topic?!fresh(topic.at):true};
}
function overviewTotals(rows){
 const known=rows.filter(r=>r.topic?.verificationComplete&&Number.isFinite(r.topic.completedHours)&&Number.isFinite(r.topic.totalHours));
 return {accounts:rows.length,playing:rows.filter(r=>r.playing).length,attention:rows.filter(r=>r.attention).length,complete:rows.filter(r=>r.topic?.allCompleted).length,known:known.length,hours:Math.round(known.reduce((sum,r)=>sum+r.topic.completedHours,0)*100)/100,total:Math.round(known.reduce((sum,r)=>sum+r.topic.totalHours,0)*100)/100};
}
if(typeof module!=='undefined')module.exports={accountOverview,overviewTotals};
