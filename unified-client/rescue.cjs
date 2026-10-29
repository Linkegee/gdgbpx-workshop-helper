'use strict';
const schema={type:'object',additionalProperties:false,properties:{action:{type:'string',enum:['retry','reload-main','reload-player','escalate','wait']},reason:{type:'string'}},required:['action','reason']};
function incidentKey(result){return [result.id,result.status,result.phase||'',result.lesson||'',result.reason||''].join(':');}
function candidate(result,ledger,now=Date.now()){
 if(!['recoverable','needs-login','needs-user','offline-or-stale'].includes(result.status))return false;
 const last=ledger.incidents?.[incidentKey(result)];
 if(last&&!last.resolvedAt&&['recovery-unverified','command-refused-or-unacknowledged','needs-user'].includes(last.status))return false;
 return now-(last?.at||0)>=900000;
}
function permitted(plan,result){
 if(!plan||typeof plan.reason!=='string'||!schema.properties.action.enum.includes(plan.action))return false;
 return ['wait','escalate'].includes(plan.action)||(result.status==='recoverable'&&plan.action===result.action);
}
function recovered(before,after){
 return Boolean(after?.status==='healthy'&&((Number.isFinite(before.mediaTime)&&after.mediaTime>before.mediaTime+1)||(Number.isFinite(before.progress)&&after.progress>before.progress)||after.topicCompleted>before.topicCompleted||after.lesson!==before.lesson));
}
module.exports={schema,incidentKey,candidate,permitted,recovered};
