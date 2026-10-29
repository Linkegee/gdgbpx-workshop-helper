'use strict';
function surfaceStats(bitmap,width,height){
 if(!width||!height||bitmap.length<width*height*4)return{available:false,white:false};
 let white=0;const total=width*height;
 for(let i=0;i<total*4;i+=4)if(bitmap[i]>=250&&bitmap[i+1]>=250&&bitmap[i+2]>=250&&bitmap[i+3]>=240)white++;
 return{available:true,white:white/total>=0.9998,whiteRatio:white/total};
}
function createVisualWatch({context,capture,repair,changed,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 const states=new Map(),busy=new Set(),budgets=new Map(),generations=new Map();
 function set(id,value){const state={...value,at:now()};states.set(id,state);changed(id,state);return state;}
 async function image(id){try{return await capture(id);}catch{return{available:false,white:false};}}
 function eligible(id){const c=context(id);return c&&c.eligible&&c.ready&&!c.manualHold?c:null;}
 async function scan(id){
  if(busy.has(id)||!eligible(id))return;busy.add(id);
  const generation=generations.get(id);const current=()=>generations.get(id)===generation?eligible(id):null;
  try{
   const before=states.get(id),c=current();if(!c)return;
   const layerBad=c.selected&&c.layerOk===false,frame=await image(id);
   if(!current())return;
   if(!layerBad&&!frame.available){set(id,before?.phase==='needs-help'?{...before,sampleUnavailable:true}:{phase:'capture-unavailable',reason:'no-render-sample'});return;}
   if(!layerBad&&!frame.white){
    if(before?.phase==='needs-help'){
     await sleep(250);const confirmation=await image(id),fresh=current();if(!fresh)return;
     if(!confirmation.available||confirmation.white||(fresh.selected&&fresh.layerOk===false)){set(id,{...before,surface:confirmation});return;}
    }
    set(id,{phase:'healthy',blankSamples:0,surface:frame});return;
   }
   if(before?.phase==='needs-help'){set(id,{...before,surface:frame});return;}
   const blankSamples=(before?.blankSamples||0)+1;
   const firstBlankAt=before?.firstBlankAt??now();
   if(!layerBad&&(blankSamples<2||now()-firstBlankAt<5000)){set(id,{phase:'suspect',blankSamples,firstBlankAt,surface:frame,reason:'white-surface'});return;}
   const reason=layerBad?'selected-view-hidden-or-covered':'white-surface';
   const attempts=(budgets.get(c.accountId)||[]).filter(at=>now()-at<3600000);budgets.set(c.accountId,attempts);
   for(let attempt=0;attempt<2&&attempts.length<3;attempt++){
    if(!current())return;
    attempts.push(now());set(id,{phase:'repairing',reason,blankSamples,attempt:attempt+1});
    await repair(id);await sleep(250);
    if(!current())return;
    const a=await image(id);await sleep(250);const b=await image(id),after=current();
    if(!after)return;
    if(a.available&&b.available&&!a.white&&!b.white&&(!after.selected||after.layerOk!==false)){
     set(id,{phase:'recovered',reason,blankSamples:0,attempt:attempt+1,surface:b});return;
    }
   }
   set(id,{phase:'needs-help',reason,blankSamples,surface:frame,note:'two-repaints-unverified-or-budget-exhausted'});
  }catch{if(current())set(id,{phase:'needs-help',reason:'render-repair-failed'});}finally{busy.delete(id);}
 }
 return{scan,get:id=>states.get(id)||null,remove(id){states.delete(id);generations.set(id,(generations.get(id)||0)+1);}};
}
module.exports={surfaceStats,createVisualWatch};
