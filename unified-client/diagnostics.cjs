'use strict';
function clean(value,key='',depth=0){
  if(/^(auth|token|password|cookie|authorization|device_key|uid|accountScope|sessionId|playerSessionId)$/i.test(key))return '[redacted]';
  if(depth>12)return '[depth-limit]';
  if(typeof value==='string')return value.replace(/https?:\/\/[^\s"'<>]+/g,text=>{try{const u=new URL(text);return u.origin+u.pathname;}catch{return '[url]';}}).slice(0,3000);
  if(Array.isArray(value))return value.slice(-100).map(v=>clean(v,'',depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v,k,depth+1)]));
  return value;
}
function report(version,accounts,pages,stores){
  return clean({schemaVersion:1,clientVersion:version,generatedAt:new Date().toISOString(),accounts:accounts.map(a=>{
    const tabs=[...pages.values()].filter(p=>p.accountId===a.id);
    const scopes=new Set(tabs.map(p=>p.metadata.gdgbpxScopeV2?.id).filter(Boolean));
    const values=stores.get(a.id)||{};
    return {id:a.id,name:a.name,mainScope:tabs.find(p=>!p.parent)?.metadata.gdgbpxScopeV2?.id,manualHold:values.__clientManualHold||null,learning:values.__clientLearning||null,tabs:tabs.map(p=>({id:p.view.webContents.id,kind:p.parent?'player':'main',title:p.title,issue:p.issue,visual:p.visual,visualHealth:p.visualHealth,
      url:p.view.webContents.getURL(),bounds:p.view.getBounds(),audioMuted:p.view.webContents.isAudioMuted(),
      frames:p.view.webContents.mainFrame.framesInSubtree.map(frame=>({url:frame.url}))})),scopes:[...scopes].map(id=>{
      const prefix='gdgbpx_account_v1:'+id+':';
      const state=values[prefix+'gdgbpx_workshop_helper_state_v1']||{};
      return {scope:id,status:state.status,phase:state.phase,message:state.message,lesson:state.currentLessonTitle,progress:state.currentLessonProgress,userPaused:Boolean(state.userPaused),maintenance:Boolean(state.maintenance),workshop:state.currentWorkshopTitle,classId:state.currentClassId,finishedWorkshops:state.finishedWorkshopTitles,
        settings:state.settings,heartbeat:values[prefix+'gdgbpx_workshop_helper_player_heartbeat_v1'],media:values[prefix+'gdgbpx_workshop_helper_media_heartbeat_v2'],
        logs:(values[prefix+'gdgbpx_workshop_helper_logs_v1']||[]).slice(-80)};
    })};
  })});
}
module.exports={clean,report};
