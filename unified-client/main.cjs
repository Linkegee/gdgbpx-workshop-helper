'use strict';
const {app,BrowserWindow,WebContentsView,session,ipcMain,clipboard,dialog,Menu,powerSaveBlocker,Notification,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {allowedPage,partition,account,summarize,canResume}=require('./policy.cjs');
const {ingestLearning}=require('./learning.cjs');
const {recoveryDecision}=require('./recovery.cjs');
const {randomUUID}=require('node:crypto');
const {report}=require('./diagnostics.cjs');
const {createStoreWriter}=require('./store-writer.cjs');
const {createBatch}=require('./batch.cjs');
const {present}=require('./presentation.cjs');
const {surfaceStats,createVisualWatch}=require('./visual-watch.cjs');
const HOME='https://gbpx.gd.gov.cn/gdceportal/index.aspx';
const SELF=path.join(__dirname,'shell.html');
const selfTest=process.argv.includes('--self-test');
app.setPath('userData',path.join(app.getPath('appData'),'GanbuUnifiedClient'));
if(selfTest)app.setPath('userData',process.argv.find(a=>a.startsWith('--self-test-root='))?.slice('--self-test-root='.length)||path.join(__dirname,'test-data','engine-'+Date.now()));
const primary=app.requestSingleInstanceLock();
if(!primary){console.log('SECONDARY_BLOCKED');app.quit();}
app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}});
let win,accounts=[],active='',diagnosticsTimer,blocker=null,closing=false,barkConfig=null,panelPreferences={};
let controlLedger={seen:{},budgets:{}},targets={accounts:[]};const pendingControl=new Map(),resumeOnLoad=new Set();
let worker=null;
const operatorResults={};
const batch=createBatch({ids:()=>accounts.map(a=>a.id),prepare:(id,action)=>{
 const values=store(id);values.__clientManualHold=action==='start'?null:{action,at:Date.now()};
 resumeOnLoad.delete(id);write('helper-'+id+'.json',values);
},dispatch:operatorDispatch,changed:()=>update()});
const pages=new Map(),stores=new Map(),configured=new Set(),alerts=new Map();
function read(name,fallback){const file=path.join(app.getPath('userData'),name);return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')):fallback;}
function write(name,value){const file=path.join(app.getPath('userData'),name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value));fs.renameSync(file+'.tmp',file);}
const storeWriter=createStoreWriter({setTimeout,clearTimeout,write:id=>write('helper-'+id+'.json',stores.get(id)),onError:()=>notify('storage','本地状态保存失败，请检查磁盘空间。')});
const visualWatch=createVisualWatch({context:id=>{
 const p=pages.get(id);if(!p||p.view.webContents.isDestroyed())return null;
 const root=p.parent?pages.get(p.parent):p,scope=root?.metadata.gdgbpxScopeV2?.id;
 const values=store(p.accountId),task=values['gdgbpx_account_v1:'+scope+':gdgbpx_workshop_helper_state_v1'];
 const bounds=p.view.getBounds(),selected=active===id;
 return {accountId:p.accountId,kind:p.parent?'player':'main',eligible:task?.status==='running'&&!task.maintenance,manualHold:Boolean(values.__clientManualHold||task?.userPaused||read('rescue-config.json',{enabled:true}).enabled===false),ready:!p.view.webContents.isLoadingMainFrame()&&Date.now()-(p.loadedAt||p.createdAt)>=15000,
  selected,layerOk:!selected||(p.view.getVisible()&&win.contentView.children.at(-1)===p.view&&bounds.width>0&&bounds.height>0)};
},capture:async id=>{
 const p=pages.get(id);if(!p)throw Error('page-closed');let timer;
 try{const image=await Promise.race([p.view.webContents.capturePage(undefined,{stayHidden:active!==id,stayAwake:false}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('capture-timeout')),3000);})]);
  if(image.isEmpty())return{available:false,white:false};const small=image.resize({width:96,height:72}),size=small.getSize();return surfaceStats(small.toBitmap(),size.width,size.height);
 }finally{clearTimeout(timer);}
},repair:async id=>{const p=pages.get(id);if(!p)throw Error('page-closed');if(active===id){p.view.setVisible(false);present({win,pages,active});}else{const {width,height}=win.getContentBounds();p.view.setBounds({x:300,y:68,width:Math.max(1,width-300),height:Math.max(1,height-68)});}},changed:(id,health)=>{const p=pages.get(id);if(p){p.visualHealth=health;update();}}});
let selectedVisualTimer=null;
function store(id){if(!stores.has(id))stores.set(id,read('helper-'+id+'.json',{}));return stores.get(id);}
function notify(key,message){if(Date.now()-(alerts.get(key)||0)<300000)return;alerts.set(key,Date.now());if(Notification.isSupported())new Notification({title:'学院统一客户端',body:message}).show();if(barkConfig&&!selfTest)session.defaultSession.fetch('https://api.day.app/push',{method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_key:barkConfig.key,title:'学院客户端需要检查',body:message,group:'干部学院'}),signal:AbortSignal.timeout(15000)}).catch(()=>{});}
function liveStates(accountId){const scopes=new Set([...pages.values()].filter(p=>p.accountId===accountId).map(p=>p.metadata.gdgbpxScopeV2?.id).filter(Boolean));return summarize(store(accountId),scopes);}
function snapshot(){return {accounts:accounts.map(a=>({...a,operatorResult:operatorResults[a.id]||null,collapsed:panelPreferences[a.id]!==false,learning:store(a.id).__clientLearning||null,states:liveStates(a.id),tabs:[...pages.values()].filter(p=>p.accountId===a.id).map(p=>({id:p.view.webContents.id,title:p.title||'正在加载',issue:p.issue||'',visualHealth:p.visualHealth,kind:p.parent?'播放器':'专题 / 首页'}))})),active,batch:batch.state,rescue:read('rescue-status.json',null),barkEnabled:Boolean(barkConfig)};}
function update(){if(win&&!win.isDestroyed())win.webContents.send('panel-state',snapshot());if(!diagnosticsTimer&&!selfTest&&!closing)diagnosticsTimer=setTimeout(()=>{diagnosticsTimer=null;try{write('diagnostics/latest.json',report(app.getVersion(),accounts,pages,stores));}catch{}},2000);}
function layout(){if(!win||win.isDestroyed())return;present({win,pages,active});update();if(!selfTest){clearTimeout(selectedVisualTimer);selectedVisualTimer=setTimeout(()=>visualWatch.scan(active).catch(()=>{}),400);}}
function muteForScope(accountId,scopeId,muted){for(const p of pages.values()){const owner=p.metadata.gdgbpxScopeV2?.id||pages.get(p.parent)?.metadata.gdgbpxScopeV2?.id;if(p.accountId===accountId&&owner===scopeId)p.view.webContents.setAudioMuted(muted!==false);}}
function configure(id){
  const ses=session.fromPartition(partition(id));if(configured.has(id))return ses;configured.add(id);
  ses.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'generated','page.cjs'),matches:['https://gbpx.gd.gov.cn/*','https://wcs1.shawcoder.xyz/*','https://cs1.gdgbpx.com/*']});
  ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  ses.setPermissionCheckHandler(()=>false);
  ses.on('will-download',(_event,item)=>{const dir=path.join(app.getPath('downloads'),'学院诊断');fs.mkdirSync(dir,{recursive:true});const name=path.basename(item.getFilename()).replace(/[<>:"/\\|?*]/g,'_');item.setSavePath(path.join(dir,Date.now()+'-'+name));});
  return ses;
}
function open(accountId,url=HOME,parent=null,focus=true){
  if(!accounts.some(a=>a.id===accountId)||!allowedPage(url))return null;
  // At most one managed player per source page; refuse duplicates instead of
  // silently closing an existing video or creating an unbounded tab storm.
  if(parent&&[...pages.values()].some(p=>p.parent===parent&&!p.view.webContents.isDestroyed()))return null;
  const view=new WebContentsView({webPreferences:{session:configure(accountId),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,webSecurity:true}});
  const wc=view.webContents,p={view,accountId,parent,metadata:{},menus:new Set(),title:'正在加载',issue:'',createdAt:Date.now(),loadedAt:0};pages.set(wc.id,p);win.contentView.addChildView(view);
  const sourceScope=pages.get(parent)?.metadata.gdgbpxScopeV2?.id;
  wc.setAudioMuted(store(accountId)['gdgbpx_account_v1:'+sourceScope+':gdgbpx_workshop_helper_state_v1']?.settings?.muted!==false);
  if(selfTest)wc.on('preload-error',(_event,_file,error)=>console.error('TEST preload:',error));
  wc.setWindowOpenHandler(({url:target})=>{if(allowedPage(target))open(accountId,target,wc.id,true);return {action:'deny'};});
  wc.on('will-navigate',(event,target)=>{if(!allowedPage(target)){event.preventDefault();p.issue='已阻止跳转至学院之外的地址';update();}});
  wc.on('will-redirect',(event,target)=>{if(!allowedPage(target))event.preventDefault();});
  wc.on('page-title-updated',(_event,title)=>{p.title=title;update();});
  wc.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame){p.loadedAt=Date.now();p.visualHealth=null;visualWatch.remove(wc.id);}});
  wc.on('did-finish-load',()=>{p.loadedAt=Date.now();p.issue='';update();if(!p.parent&&resumeOnLoad.has(accountId)&&new URL(wc.getURL()).pathname==='/gdceportal/index.aspx'){resumeOnLoad.delete(accountId);wc.send('client-control',{id:'startup-'+randomUUID(),action:'start'});}});
  wc.on('did-fail-load',(_e,code,_description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3){p.issue='页面加载失败，请查看该账号后重试';notify(accountId,p.issue);update();}});
  wc.on('render-process-gone',()=>{p.issue='页面进程已退出；请点击重新加载。不会自动新开播放器。';notify(accountId,p.issue);update();});
  wc.on('unresponsive',()=>{p.issue='页面暂时无响应';notify(accountId,p.issue);update();});
  wc.on('responsive',()=>{p.issue='';update();});
  wc.on('destroyed',()=>{visualWatch.remove(wc.id);pages.delete(wc.id);for(const other of pages.values())other.view.webContents.send('helper-closed',wc.id);if(active===wc.id)active=[...pages.keys()][0]||'';if(!closing)layout();});
  if(focus||!active||(parent&&active===parent))active=wc.id;layout();wc.loadURL(url).catch(()=>{});return wc.id;
}
function sender(event){const p=pages.get(event.sender.id);if(!p||!allowedPage(event.senderFrame?.url||''))throw new Error('Invalid sender');return p;}
function closePage(id){const p=pages.get(id);if(!p)return;win.contentView.removeChildView(p.view);p.view.webContents.close();}
ipcMain.on('helper',(event,op,args=[])=>{
  try{
    const p=sender(event),values=store(p.accountId),[key,value]=args;
    switch(op){
      case 'id':event.returnValue=event.sender.id;break;
      case 'visual':{
        if(event.senderFrame!==event.sender.mainFrame||!key||typeof key!=='object')throw new Error('Invalid visual probe');
        const valid={};for(const field of ['bodyChildren','textChars','frames','videoWidth','videoHeight','width','height'])if(Number.isFinite(key[field]))valid[field]=Math.max(0,Math.min(1000000,key[field]));
        for(const field of ['hasVideo','bodyVisible','videoVisible','helperPresent'])valid[field]=key[field]===true;
        if(['loading','interactive','complete'].includes(key.readyState))valid.readyState=key.readyState;
        p.visual={...valid,at:Date.now()};event.returnValue=true;break;
      }
      case 'learning':{
        if(event.senderFrame!==event.sender.mainFrame||new URL(event.senderFrame.url).hostname!=='gbpx.gd.gov.cn')throw new Error('Invalid learning source');
        const task=values['gdgbpx_account_v1:'+p.metadata.gdgbpxScopeV2?.id+':gdgbpx_workshop_helper_state_v1'];
        values.__clientLearning=ingestLearning(values.__clientLearning,key,task?.currentWorkshopTitle);
        storeWriter.schedule(p.accountId);update();event.returnValue=true;break;
      }
      case 'get':event.returnValue=key==='gdgbpx_bark_config_v1'?{found:Boolean(barkConfig),value:barkConfig}:{found:Object.hasOwn(values,key),value:values[key]};break;
      case 'set':case 'delete':{
        if(typeof key!=='string'||key.length>300)throw new Error('Invalid key');
        const old=values[key];if(op==='set')values[key]=value;else delete values[key];
        if(op==='set'&&key.endsWith(':gdgbpx_workshop_helper_logs_v1')&&Array.isArray(value)){
          const last=value.at(-1);if(last?.event==='panel-action'){
            const action=last.detail?.action;
            if(['start','continue'].includes(action))values.__clientManualHold=null;
            if(['pause','stop'].includes(action))values.__clientManualHold={action,at:Date.now()};
          }
        }
        if(op==='set'&&key.endsWith(':gdgbpx_workshop_helper_state_v1'))muteForScope(p.accountId,key.split(':')[1],value?.settings?.muted);
        for(const target of pages.values())if(target.accountId===p.accountId)for(const frame of target.view.webContents.mainFrame.framesInSubtree){try{frame.send('helper-value',key,old,op==='set'?value:undefined,event.sender.id);}catch{}}
        storeWriter.schedule(p.accountId);update();event.returnValue=true;break;
      }
      case 'tab-get':event.returnValue=p.metadata;break;
      case 'tab-set':p.metadata=key;event.returnValue=true;break;
      case 'open':event.returnValue=open(p.accountId,key,event.sender.id,Boolean(value));break;
      case 'close':{const target=pages.get(key);if(target?.accountId===p.accountId&&target.parent===event.sender.id)closePage(key);event.returnValue=true;break;}
      case 'clipboard':clipboard.writeText(String(key));event.returnValue=true;break;
      case 'menu':if(!['设置 Bark 进度提醒','检查脚本更新'].includes(key))p.menus.add(String(key));event.returnValue=true;break;
      default:event.returnValue=null;
    }
  }catch{event.returnValue=null;}
});
ipcMain.handle('helper-request',async(event,request)=>{
  try{
    sender(event);const u=new URL(request.url);
    if(u.protocol!=='https:'||u.username||u.password||u.port)return {error:true};
    const update=u.hostname==='raw.githubusercontent.com'&&request.method==='GET'&&u.pathname.startsWith('/Linkegee/gdgbpx-workshop-helper/');
    const bark=u.hostname==='api.day.app'&&u.pathname==='/push'&&request.method==='POST'&&typeof request.data==='string'&&request.data.length<20000;
    if(!update&&!bark)return {error:true};
    const result=await session.defaultSession.fetch(u.href,{method:request.method,body:bark?request.data:undefined,headers:bark?{'Content-Type':'application/json'}:undefined,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(Math.min(30000,Math.max(1000,request.timeout)))});
    const responseText=await result.text();if(responseText.length>2e6)return {error:true};return {status:result.status,responseText,finalUrl:result.url};
  }catch{return {error:true};}
});
function trustedPanel(event){return event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame;}
function finishControl(request,result){write('control/results/'+request.id+'.json',{id:request.id,accountId:request.accountId,action:request.action,result,at:Date.now()});try{fs.unlinkSync(path.join(app.getPath('userData'),'control/inbox',request.id+'.json'));}catch{}}
function operatorDispatch(accountId,action){
 const p=[...pages.values()].find(p=>p.accountId===accountId&&!p.parent),state=p?store(accountId)['gdgbpx_account_v1:'+p.metadata.gdgbpxScopeV2?.id+':gdgbpx_workshop_helper_state_v1']:null;
 const immediate=result=>{operatorResults[accountId]={action,result,at:Date.now()};update();return Promise.resolve(result);};
 if(!p)return immediate('account-unavailable');
 if(action==='start'&&state?.status==='running')return immediate('already-running');
 if(action==='stop'&&state?.status==='stopped')return immediate('already-stopped');
 if(action==='pause'&&state?.userPaused)return immediate('already-paused');
 if(action==='start'&&store(accountId).__clientLearning?.workshops?.[state?.currentClassId]?.allCompleted)return immediate('already-complete');
 if(action==='start'&&['login-required','account-context-changed','maintenance-login','identity-entry-failed'].includes(state?.phase))return immediate('login-required');
 return new Promise(resolve=>{
  const id=randomUUID(),done=result=>{operatorResults[accountId]={action,result,at:Date.now()};update();resolve(result);};
  pendingControl.set(id,{id,accountId,operator:true,done});
  p.view.webContents.send('client-control',{id,action:action==='start'&&state?.status==='paused'?'continue':action});
  setTimeout(()=>{if(pendingControl.delete(id))done('delivery-unknown');},8000);
 });
}
ipcMain.on('client-control-result',(event,id,result)=>{try{const p=sender(event),request=pendingControl.get(id);if(!request||request.accountId!==p.accountId)return;pendingControl.delete(id);if(request.operator)request.done(String(result));else finishControl(request,String(result));}catch{}});
function processControl(){
 const dir=path.join(app.getPath('userData'),'control/inbox');fs.mkdirSync(dir,{recursive:true});
 for(const file of fs.readdirSync(dir).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)).slice(0,20)){
  let request;try{const filename=path.join(dir,file);if(fs.statSync(filename).size>16000)continue;request=JSON.parse(fs.readFileSync(filename,'utf8'));}catch{continue;}
  if(!request||file!==request.id+'.json')continue;if(pendingControl.has(request.id))continue;
  if(controlLedger.seen[request.id]){finishControl(request,'duplicate-not-replayed');continue;}
  const p=[...pages.values()].find(p=>p.accountId===request.accountId&&!p.parent);
  const state=p?store(p.accountId)['gdgbpx_account_v1:'+p.metadata.gdgbpxScopeV2?.id+':gdgbpx_workshop_helper_state_v1']:null;
  const decision=recoveryDecision(request,state,controlLedger.budgets[request.accountId]);
  if(p&&store(p.accountId).__clientManualHold&&['retry','reload-main','reload-player'].includes(request.action)){finishControl(request,'operator-hold');continue;}
  if(!p||!decision.allowed){finishControl(request,p?decision.reason:'account-unavailable');continue;}
  controlLedger.seen[request.id]=Date.now();
  controlLedger.seen=Object.fromEntries(Object.entries(controlLedger.seen).sort((a,b)=>b[1]-a[1]).slice(0,1000));
  if(['retry','reload-main','reload-player'].includes(request.action)){const old=controlLedger.budgets[p.accountId]||{};controlLedger.budgets[p.accountId]={lastAt:Date.now(),attempts:[...(old.attempts||[]).filter(at=>Date.now()-at<3600000),Date.now()]};}
  write('control-ledger.json',controlLedger);
  if(request.action==='inspect'){update();finishControl(request,'inspected');}
  if(['capture-player','repaint-player'].includes(request.action)){
    const child=[...pages.values()].find(c=>c.parent===p.view.webContents.id&&c.accountId===p.accountId);
    if(!child){finishControl(request,'player-unavailable');continue;}
    if(request.action==='repaint-player'){active=child.view.webContents.id;child.view.setVisible(false);layout();}
    pendingControl.set(request.id,request);
    child.view.webContents.capturePage(undefined,{stayHidden:active!==child.view.webContents.id,stayAwake:true}).then(image=>{
      const file='diagnostics/visual-'+request.id+'.png';fs.mkdirSync(path.join(app.getPath('userData'),'diagnostics'),{recursive:true});fs.writeFileSync(path.join(app.getPath('userData'),file),image.toPNG());pendingControl.delete(request.id);finishControl(request,'captured-local:'+file);
    }).catch(error=>{pendingControl.delete(request.id);finishControl(request,'capture-failed');});
  }
  if(request.action==='notify'){notify('codex:'+p.accountId,'账号标识 '+p.accountId.slice(0,6)+' 需要检查；Codex未能确认自动恢复，请查看客户端。');finishControl(request,barkConfig?'notification-attempted':'desktop-only-bark-unconfigured');}
  if(request.action==='reload-main'){p.view.webContents.reload();finishControl(request,'reloaded-needs-verification');}
  if(request.action==='reload-player'){const child=[...pages.values()].find(c=>c.parent===p.view.webContents.id&&c.accountId===p.accountId);if(child){child.view.webContents.reload();finishControl(request,'reloaded-needs-verification');}else finishControl(request,'player-unavailable');}
  if(request.action==='retry'){pendingControl.set(request.id,request);p.view.webContents.send('client-control',{id:request.id,action:'retry'});setTimeout(()=>{if(pendingControl.delete(request.id))finishControl(request,'delivery-unknown');},10000);}
 }
}
ipcMain.handle('panel-command',async(event,op,id)=>{
  if(!trustedPanel(event))return;
  if(op==='state'){update();return;}
  if(op==='overview'){active='';layout();return;}
  if(op==='rescue-enabled'&&typeof id==='boolean'){write('rescue-config.json',{enabled:id});update();return;}
  if(op==='batch'&&['start','pause','stop'].includes(id)){batch.run(id).catch(()=>notify('batch','群控发送失败，请查看账号结果。'));return {accepted:true};}
  if(op==='account-action'&&accounts.some(a=>a.id===id?.accountId)&&['start','pause','stop'].includes(id.action)){batch.run(id.action,[id.accountId]).catch(()=>{});return {accepted:true};}
  if(op==='collapse'&&accounts.some(a=>a.id===id?.accountId)&&typeof id.collapsed==='boolean'){panelPreferences[id.accountId]=id.collapsed;write('panel.json',panelPreferences);update();return;}
  if(op==='collapse-all'&&typeof id==='boolean'){for(const a of accounts)panelPreferences[a.id]=id;write('panel.json',panelPreferences);update();return;}
  if(op==='bark'){
    if(!id?.key){barkConfig=null;write('bark.json',null);update();return;}
    if(!/^[A-Za-z0-9_-]{8,200}$/.test(id.key)||!safeStorage.isEncryptionAvailable())throw new Error('提醒配置无效，或系统加密不可用');
    barkConfig={key:id.key,minutes:Math.max(3,Math.min(120,Number(id.minutes)||10))};
    write('bark.json',{key:safeStorage.encryptString(barkConfig.key).toString('base64'),minutes:barkConfig.minutes});update();return;
  }
  if(op==='rename'){const a=accounts.find(a=>a.id===id?.accountId);if(a&&typeof id.name==='string'){a.name=id.name.slice(0,40)||a.name;write('accounts.json',accounts);update();}return;}
  if(op==='add'){const a=account('账号 '+(accounts.length+1));accounts.push(a);write('accounts.json',accounts);open(a.id);return;}
  const p=pages.get(Number(id));
  if(op==='show'&&p){active=Number(id);layout();}
  if(op==='player'&&accounts.some(a=>a.id===id)){const player=[...pages.values()].find(p=>p.accountId===id&&p.parent);if(player){active=player.view.webContents.id;layout();}}
  if(op==='home'&&accounts.some(a=>a.id===id)){const old=[...pages.values()].find(p=>p.accountId===id&&!p.parent);if(old){active=old.view.webContents.id;layout();}else open(id);}
  if(op==='repaint'&&accounts.some(a=>a.id===id)){const player=[...pages.values()].find(p=>p.accountId===id&&p.parent);if(player){active=player.view.webContents.id;player.view.setVisible(false);layout();player.view.webContents.capturePage(undefined,{stayAwake:true}).catch(()=>{});}}
  if(op==='reload'&&p)p.view.webContents.reload();
  if(op==='menu'&&p){Menu.buildFromTemplate([...p.menus].map(name=>({label:name,click:()=>p.view.webContents.send('helper-menu',name)}))).popup({window:win});}
  if(op==='close'&&p){const answer=await dialog.showMessageBox(win,{type:'question',message:'关闭此页面？正在观看的课程会中断。',buttons:['取消','关闭'],defaultId:0,cancelId:0});if(answer.response===1)closePage(Number(id));}
});
app.whenReady().then(async()=>{
  if(!primary)return;
  const savedPanel=read('panel.json',{});
  panelPreferences=Object.fromEntries(Object.entries(savedPanel&&typeof savedPanel==='object'?savedPanel:{}).filter(([id,value])=>/^[a-f0-9-]{36}$/.test(id)&&typeof value==='boolean'));
  accounts=read('accounts.json',[]);if(!Array.isArray(accounts))throw new Error('账号配置格式错误');for(const a of accounts)partition(a.id);
  controlLedger=read('control-ledger.json',{seen:{},budgets:{}});targets=read('watch-targets.json',{accounts:[]});
  if(!selfTest){write('client-owner.json',{pid:process.pid,running:true,at:Date.now()});
    worker=require('node:child_process').spawn(process.execPath,[path.join(__dirname,'rescue-worker.cjs'),'--root',app.getPath('userData')],{windowsHide:true,stdio:'ignore',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
    worker.on('error',()=>notify('rescue','本地 Codex 异常接管未能启动，请检查。'));
  }
  if(!selfTest)for(const a of accounts)if(canResume(a.id,store(a.id),targets))resumeOnLoad.add(a.id);
  if(!selfTest&&!accounts.length){accounts=[account('账号 1'),account('账号 2')];write('accounts.json',accounts);}
  const savedBark=read('bark.json',null);
  if(savedBark&&safeStorage.isEncryptionAvailable()){try{barkConfig={key:safeStorage.decryptString(Buffer.from(savedBark.key,'base64')),minutes:savedBark.minutes};}catch{}}
  if(!barkConfig&&!selfTest&&process.env.DAZHONG_BARK_KEY&&safeStorage.isEncryptionAvailable()){
    barkConfig={key:process.env.DAZHONG_BARK_KEY,minutes:10};write('bark.json',{key:safeStorage.encryptString(barkConfig.key).toString('base64'),minutes:10});
  }
  win=new BrowserWindow({show:!selfTest,width:1440,height:960,minWidth:1000,minHeight:700,title:'学院统一客户端 · 测试版',webPreferences:{preload:path.join(__dirname,'shell-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());win.removeMenu();win.loadFile(SELF);
  win.webContents.on('did-finish-load',update);win.on('resize',layout);
  win.on('close',event=>{if(!closing){event.preventDefault();dialog.showMessageBox(win,{type:'question',message:'退出客户端将停止所有账号观看，确认退出？',buttons:['继续运行','退出'],defaultId:0,cancelId:0}).then(result=>{if(result.response===1){closing=true;win.close();}});}});
  win.on('closed',()=>{for(const p of pages.values())p.view.webContents.close();});
  setInterval(()=>{
    const running=accounts.some(a=>liveStates(a.id).some(s=>s.status==='running'));
    if(running&&blocker===null)blocker=powerSaveBlocker.start('prevent-app-suspension');
    if(!running&&blocker!==null){powerSaveBlocker.stop(blocker);blocker=null;}
    update();
  },15000).unref();
  // Restore account entry points only. Never resurrect expired player URLs.
  for(const a of accounts)open(a.id);
  if(!selfTest)setInterval(()=>{try{processControl();}catch{notify('control','本机恢复通道出现错误，请检查客户端。');}},2000).unref();
  if(!selfTest){let cursor=0;setInterval(()=>{const list=[...pages.keys()];if(list.length)visualWatch.scan(list[cursor++%list.length]).catch(()=>{});},4000).unref();setInterval(()=>visualWatch.scan(active).catch(()=>{}),10000).unref();}
  if(selfTest){closing=true;await require('./tests/engine-selftest.cjs')({accounts,configure,open,pages,store,win,app,processControl,visualWatch});}
}).catch(error=>{dialog.showErrorBox('客户端启动失败',error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>{if(!selfTest)write('client-owner.json',{pid:process.pid,running:false,at:Date.now()});worker?.kill();clearTimeout(selectedVisualTimer);clearTimeout(diagnosticsTimer);storeWriter.dispose();});
