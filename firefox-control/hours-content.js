/* Firefox MV2 page-context fetch: never use extension-global cookies as a fallback. */
(() => {
 'use strict';
 if(globalThis.__ganbuHoursReaderV1)return;
 globalThis.__ganbuHoursReaderV1=true;
 const HOME='https://gbpx.gd.gov.cn/gdceportal/index.aspx';
 browser.runtime.onMessage.addListener((message,sender)=>{
  if(sender.id!==browser.runtime.id||message?.channel!=='gdgbpx-hours-v1'||message.action!=='inspect')return undefined;
  return (async()=>{
   if(typeof content==='undefined'||typeof content.fetch!=='function')return {status:'page-fetch-unavailable'};
   const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),10000);
   try{
    const response=await content.fetch(HOME,{credentials:'include',cache:'no-store',redirect:'error',signal:abort.signal});
    if(!response.ok)return {status:'home-http-failed'};
    const html=await response.text();if(html.length>2000000)return {status:'home-too-large'};
    // Detached document: scripts are not executed and no iframe/visible page is created.
    const doc=new DOMParser().parseFromString(html,'text/html');
    const marker=doc.querySelector('#ctl00_thetheUser')?.textContent.trim();
    if(!marker)return {status:doc.querySelector('#txtLoginName')?'login-required':'home-fields-missing'};
    const header=(doc.querySelector('#header_right_box')?.textContent||'').replace(/\s+/g,' ').trim();
    const hours=header.match(/累计学时\s*[:：]\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    const name=header.match(/([\p{Script=Han}·]{2,20})\s*(?:已关联微信|关联微信|退出登录)/u);
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(marker));
    return {status:'logged-in-unverified',name:name?.[1]||'',creditedHours:hours?Number(hours[1]):null,
     identityKey:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),source:'container-page-fetch'};
   }catch{return {status:'home-request-failed'};}finally{clearTimeout(timer);}
  })();
 });
})();
