'use strict';
const {ipcRenderer,contextBridge}=require('electron');
if(['gbpx.gd.gov.cn','wcs1.shawcoder.xyz','cs1.gdgbpx.com'].includes(location.hostname) && location.protocol==='https:') {
// Tampermonkey supplies callable timer wrappers. Native browser timers require
// their Window receiver when the helper passes them through environment objects.
const setTimeout=(...args)=>window.setTimeout(...args),clearTimeout=id=>window.clearTimeout(id);
const setInterval=(...args)=>window.setInterval(...args),clearInterval=id=>window.clearInterval(id);
const clientReadCourseContext=(rootDocument,title='')=>{
  let frameIndex=-1;
  if(rootDocument!==document){
    frameIndex=Array.from(document.querySelectorAll('iframe')).findIndex(frame=>{try{return frame.contentDocument===rootDocument;}catch{return false;}});
    if(frameIndex<0)return null;
  }
  try{return contextBridge.executeInMainWorld({func:readCourseContextInPage,args:[{frameIndex,title:String(title)}]});}catch{return null;}
};
const call=(op,...args)=>ipcRenderer.sendSync('helper',op,args);
if(window.top===window){
 const visual=()=>{try{
  const video=findClientVideo(),body=document.body,rect=video?.getBoundingClientRect(),style=body?getComputedStyle(body):null;
  // Counts/geometry only; never send DOM text, credentials or page HTML.
  call('visual',{bodyChildren:body?.children.length||0,textChars:body?.innerText?.length||0,frames:document.querySelectorAll('iframe').length,hasVideo:Boolean(video),bodyVisible:Boolean(style&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0),videoVisible:Boolean(rect&&rect.width>0&&rect.height>0),videoWidth:rect?.width||0,videoHeight:rect?.height||0,width:innerWidth,height:innerHeight,helperPresent:Boolean(document.getElementById('gbpx-helper-panel')),readyState:document.readyState});
 }catch{}};
 window.addEventListener('DOMContentLoaded',()=>setTimeout(visual,1500),{once:true});setInterval(visual,10000);
}
if(window.top===window&&location.hostname==='gbpx.gd.gov.cn'){
 const capture=()=>{try{const value=collectLearning(document,location.href);if(value)call('learning',value);}catch{}};
 window.addEventListener('DOMContentLoaded',()=>setTimeout(capture,1500),{once:true});
 window.addEventListener('hashchange',()=>setTimeout(capture,1500));setInterval(capture,10000);
 let clientCommandGeneration=0;
 ipcRenderer.on('client-control',async(_event,command)=>{
  const generation=++clientCommandGeneration;
  const action=command.action==='retry'?'continue':['start','pause','stop','continue'].includes(command.action)?command.action:null;
  if(!action)return;
  for(let attempt=0;attempt<30;attempt++){
   if(generation!==clientCommandGeneration){ipcRenderer.send('client-control-result',command.id,'cancelled-by-new-command');return;}
   if(!['pause','stop'].includes(action)&&Array.from(document.querySelectorAll('input[type="password"]')).some(n=>n.getClientRects().length)){ipcRenderer.send('client-control-result',command.id,'login-required');return;}
   const button=document.querySelector('#gbpx-helper-panel [data-action="'+action+'"]');
   if(button&&!button.disabled){capture();button.click();ipcRenderer.send('client-control-result',command.id,'dispatched-needs-verification');return;}
   await new Promise(resolve=>setTimeout(resolve,200));
  }
  ipcRenderer.send('client-control-result',command.id,'helper-unavailable');
 });
}
const GM_getValue=(key,fallback)=>{const r=call('get',key);return r?.found?r.value:fallback;};
const GM_setValue=(key,value)=>call('set',key,value);
const GM_deleteValue=key=>call('delete',key);
const GM_getTab=callback=>queueMicrotask(()=>callback(call('tab-get')||{}));
const GM_saveTab=value=>call('tab-set',value);
const subscriptions=new Map();let nextSubscription=0;
const GM_addValueChangeListener=(key,callback)=>{const id=++nextSubscription;subscriptions.set(id,{key,callback});return id;};
const GM_removeValueChangeListener=id=>subscriptions.delete(id);
ipcRenderer.on('helper-value',(_event,key,oldValue,value,source)=>{
  for(const item of subscriptions.values())if(item.key===key)item.callback(key,oldValue,value,source!==call('id'));
});
const GM_setClipboard=text=>call('clipboard',String(text));
const GM_addStyle=text=>{const style=document.createElement('style');style.textContent=text;(document.head||document.documentElement).append(style);return style;};
const menus=new Map();
const GM_registerMenuCommand=(name,fn)=>{menus.set(name,fn);call('menu',name);};
ipcRenderer.on('helper-menu',(_event,name)=>menus.get(name)?.());
const handles=new Map();
const GM_openInTab=(url,options={})=>{
  const id=call('open',url,Boolean(options.active));
  if(!id)throw new Error('客户端拒绝了此页面；请使用学院或播放器地址');
  const handle={closed:false,close:()=>call('close',id),onclose:null};handles.set(id,handle);return handle;
};
ipcRenderer.on('helper-closed',(_event,id)=>{const h=handles.get(id);if(h){h.closed=true;h.onclose?.();handles.delete(id);}});
const GM_xmlhttpRequest=details=>{
  let aborted=false;
  ipcRenderer.invoke('helper-request',{url:details.url,method:details.method||'GET',timeout:details.timeout||15000,data:details.data})
    .then(result=>{if(!aborted){if(result.error)details.onerror?.();else details.onload?.(result);}},()=>{if(!aborted)details.onerror?.();});
  return {abort(){aborted=true;}};
};
// Build appends the existing userscript here, in this lexical scope.
