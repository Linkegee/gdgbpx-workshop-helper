/* Read-only evidence from existing workshop tabs. No navigation, fetch or playback commands. */
(() => {
 'use strict';
 if(globalThis.__ganbuStudyReaderV1)return;
 globalThis.__ganbuStudyReaderV1=true;
 const compact=value=>String(value||'').replace(/\s+/g,' ').trim();
 function hourLabels(text){
  // Return numeric labels only, never full page text, credentials or playback URLs.
  return [...compact(text).matchAll(/(?:已学|已完成|累计|总|必修|选修)?(?:学时|学分)\s*[:：]?\s*\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?/g)].slice(0,12).map(m=>m[0]);
 }
 browser.runtime.onMessage.addListener((message,sender)=>{
  if(sender.id!==browser.runtime.id||message?.channel!=='gdgbpx-study-v1'||message.action!=='inspect')return undefined;
  return Promise.resolve().then(()=>{
   const detail=location.hash.includes('/workshop/workshopindex/mergeClass');
   const helper=document.querySelector('#gbpx-helper-panel');
   const selector=detail?'#pane-required .item_box':'.item_box';
   const boxes=[...document.querySelectorAll(selector)];
   const rows=boxes.slice(0,200).map((box,index)=>{
    const status=compact(box.querySelector('.item_status')?.textContent);
    return {index,completed:status.includes('已完成'),hourLabels:hourLabels(box.textContent)};
   });
   const phaseText=compact(helper?.querySelector('[data-role="lesson"]')?.textContent);
   return {at:Date.now(),route:detail?'workshop-detail':'workshop-list',readyState:document.readyState,
    helperPresent:Boolean(helper),helperVersion:compact(helper?.querySelector('.gbpx-title')?.textContent).match(/v(\d+\.\d+\.\d+)/)?.[1]||null,
    phase:phaseText.startsWith('阶段：')?phaseText.slice(3,80):null,
    helperRunning:helper?helper.querySelector('[data-action="pause"]')?.disabled===false:null,
    rows,truncated:boxes.length>200,
    pageHourLabels:hourLabels(document.body?.innerText)};
  });
 });
})();
