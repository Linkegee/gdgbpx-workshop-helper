'use strict';
function collectLearning(doc,href){
 const u=new URL(href),now=Date.now();
 if(u.hostname!=='gbpx.gd.gov.cn')return null;
 if(u.pathname==='/gdceportal/index.aspx'){
  const text=Array.from(doc.body?.children||[]).filter(n=>n.id!=='gbpx-helper-panel'&&!['SCRIPT','STYLE','IFRAME'].includes(n.tagName)).map(n=>n.innerText||'').join(' ');
  const values=[...new Set(Array.from(text.matchAll(/(?:累计|已获|年度|总)?学时\s*[：:]\s*(\d+(?:\.\d+)?)/g),m=>Number(m[1])))];
  const required=[...text.matchAll(/必修学时\s*[：:]?\s*(\d+(?:\.\d+)?)\s*(?:学时)?\s*[/／]\s*(\d+(?:\.\d+)?)/g)];
  const pairs=[...new Set(required.map(m=>m[1]+'/'+m[2]))];
  return {at:now,homeHours:values.length===1?values[0]:null,required:pairs.length===1?{earned:Number(required[0][1]),target:Number(required[0][2])}:null};
 }
 if(!u.hash.includes('/mergeClass'))return null;
 const classId=new URLSearchParams(u.hash.split('?')[1]||'').get('classId');
 const creditText=Array.from(doc.querySelectorAll('span,p,div')).filter(n=>!n.children?.length&&/^(?:专题)?学时[：:]?\s*(?:尚未计入|未计入|已计入)/.test((n.textContent||'').trim())).map(n=>n.textContent||'').join(' ');
 const creditStatus=/尚未计入|未计入/.test(creditText)?'pending':/已计入/.test(creditText)?'credited':'unknown';
 const rows=Array.from(doc.querySelectorAll('#pane-required .item_box')).slice(0,300).map(box=>{
  const title=(box.querySelector('.item_title')?.textContent||'').replace(/\s+/g,' ').trim();
  const status=(box.querySelector('.item_status')?.textContent||'').trim();
  const credit=(box.innerText||'').match(/学时\s*[：:]\s*(\d+(?:\.\d+)?)/);
  return {title,complete:status.includes('已完成'),progress:Number(box.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')||0),hours:credit?Number(credit[1]):null};
 }).filter(r=>r.title);
 const count=(doc.querySelector('#tab-required')?.textContent||'').match(/[（(]\s*\d+\s*\/\s*(\d+)\s*[）)]/);
 return classId&&rows.length?{at:now,classId,rows,creditStatus,expectedTotal:count?Number(count[1]):null}:null;
}
function ingestLearning(previous,value,title=''){
 const out=structuredClone(previous||{workshops:{}});out.workshops||={};
 if(!value||!Number.isFinite(value.at))return out;
 if(Number.isFinite(value.homeHours)&&value.homeHours>=0&&value.homeHours<100000)out.home={hours:value.homeHours,at:value.at};
 if(value.required&&Number.isFinite(value.required.earned)&&Number.isFinite(value.required.target)&&value.required.earned>=0&&value.required.target>0)out.required={earned:value.required.earned,target:value.required.target,at:value.at};
 if(typeof value.classId!=='string'||!/^[\w-]{1,100}$/.test(value.classId)||!Array.isArray(value.rows)||!value.rows.length)return out;
 const rows=value.rows.slice(0,300).map(r=>({title:String(r.title||'').slice(0,160),complete:r.complete===true,progress:Math.max(0,Math.min(100,Number(r.progress)||0)),hours:Number.isFinite(r.hours)&&r.hours>=0&&r.hours<1000?r.hours:null}));
 const expected=Number.isInteger(value.expectedTotal)&&value.expectedTotal>0?value.expectedTotal:null;
 const hoursKnown=expected===rows.length&&rows.every(r=>r.hours!==null),complete=rows.filter(r=>r.complete);
 out.workshops[value.classId]={classId:value.classId,title:String(title||value.classId).slice(0,160),at:value.at,creditStatus:['pending','credited'].includes(value.creditStatus)?value.creditStatus:'unknown',total:expected||rows.length,completed:complete.length,allCompleted:complete.length===rows.length&&expected===rows.length,verificationComplete:expected===rows.length,
   totalHours:hoursKnown?Math.round(rows.reduce((n,r)=>n+r.hours,0)*100)/100:null,completedHours:hoursKnown?Math.round(complete.reduce((n,r)=>n+r.hours,0)*100)/100:null,rows};
 out.currentClassId=value.classId;
 const ordered=Object.entries(out.workshops).sort((a,b)=>b[1].at-a[1].at).slice(0,50);out.workshops=Object.fromEntries(ordered);return out;
}
module.exports={collectLearning,ingestLearning};
