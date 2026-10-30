'use strict';
// A newer operator command cancels the remaining queue immediately.
function createBatch({ids,prepare,dispatch,changed,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 let generation=0,state=null;const cancelled=new Map();
 async function run(action,accountIds=ids()){
  if(!['start','pause','stop'].includes(action))throw new Error('Unsupported operator action');
  const token=++generation,list=[...new Set(accountIds)].filter(id=>ids().includes(id));
  const versions=new Map(list.map(id=>[id,cancelled.get(id)||0]));
  for(const id of list)prepare(id,action);
  state={action,running:true,total:list.length,results:[]};changed(state);
  for(const id of list){
   if(token!==generation)return;
   let result;try{result=!ids().includes(id)||(cancelled.get(id)||0)!==versions.get(id)?'cancelled-by-new-command':await dispatch(id,action);}catch{result='dispatch-failed';}
   if(token!==generation)return;
   state.results.push({accountId:id,result});changed(state);
   // Stagger new launches; pause/stop are sent without a launch delay.
   if(action==='start')await sleep(700);
  }
  if(token===generation){state.running=false;changed(state);}
 }
 return {run,cancelAccount(id){cancelled.set(id,(cancelled.get(id)||0)+1);},get state(){return state;}};
}
module.exports={createBatch};
