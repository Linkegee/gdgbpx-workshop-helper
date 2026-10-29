'use strict';
const {app,BrowserWindow,WebContentsView,session,ipcMain,clipboard,dialog,Menu,powerSaveBlocker,Notification,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {allowedPage,partition,account,summarize}=require('./policy.cjs');
const {report}=require('./diagnostics.cjs');
const HOME='https://gbpx.gd.gov.cn/gdceportal/index.aspx';
const SELF=path.join(__dirname,'shell.html');
const selfTest=process.argv.includes('--self-test');
app.setPath('userData',path.join(app.getPath('appData'),'GanbuUnifiedClient'));
if(selfTest)app.setPath('userData',path.join(__dirname,'test-data','engine-'+Date.now()));
let win,accounts=[],active='',saveTimer,diagnosticsTimer,blocker=null,closing=false,barkConfig=null;
const pages=new Map(),stores=new Map(),configured=new Set(),alerts=new Map();
function read(name,fallback){const file=path.join(app.getPath('userData'),name);return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback;}
function write(name,value){const file=path.join(app.getPath('userData'),name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value));fs.renameSync(file+'.tmp',file);}
function persist(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{for(const [id,value]of stores)write('helper-'+id+'.json',value);}catch{notify('storage','本地状态保存失败，请检查磁盘空间。');}},300);}
function store(id){if(!stores.has(id))stores.set(id,read('helper-'+id+'.json',{}));return stores.get(id);}
function notify(key,message){if(Date.now()-(alerts.get(key)||0)<300000)return;alerts.set(key,Date.now());if(Notification.isSupported())new Notification({title:'学院统一客户端',body:message}).show();if(barkConfig&&!selfTest)session.defaultSession.fetch('https://api.day.app/push',{method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_key:barkConfig.key,title:'学院客户端需要检查',body:message,group:'干部学院'}),signal:AbortSignal.timeout(15000)}).catch(()=>{});}
function liveStates(accountId){const scopes=new Set([...pages.values()].filter(p=>p.accountId===accountId).map(p=>p.metadata.gdgbpxScopeV2?.id).filter(Boolean));return summarize(store(accountId),scopes);}
function snapshot(){return {accounts:accounts.map(a=>({...a,states:liveStates(a.id),tabs:[...pages.values()].filter(p=>p.accountId===a.id).map(p=>({id:p.view.webContents.id,title:p.title||'正在加载',issue:p.issue||'',kind:p.parent?'播放器':'专题 / 首页'}))})),active,barkEnabled:Boolean(barkConfig)};}
function update(){if(win&&!win.isDestroyed())win.webContents.send('panel-state',snapshot());if(!diagnosticsTimer&&!selfTest&&!closing)diagnosticsTimer=setTimeout(()=>{diagnosticsTimer=null;try{write('diagnostics/latest.json',report(app.getVersion(),accounts,pages,stores));}catch{}},2000);}
function layout(){if(!win||win.isDestroyed())return;const {width,height}=win.getContentBounds();for(const p of pages.values()){const show=p.view.webContents.id===active;p.view.setBounds({x:300,y:68,width:Math.max(1,width-300),height:Math.max(1,height-68)});p.view.setVisible(show);}update();}
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
  const wc=view.webContents,p={view,accountId,parent,metadata:{},menus:new Set(),title:'正在加载',issue:''};pages.set(wc.id,p);win.contentView.addChildView(view);
  const sourceScope=pages.get(parent)?.metadata.gdgbpxScopeV2?.id;
  wc.setAudioMuted(store(accountId)['gdgbpx_account_v1:'+sourceScope+':gdgbpx_workshop_helper_state_v1']?.settings?.muted!==false);
  if(selfTest){wc.on('preload-error',(_event,_file,error)=>console.error('TEST preload:',error));wc.on('console-message',(event,_level,message)=>console.log('TEST console:',event.message||message));}
  wc.setWindowOpenHandler(({url:target})=>{if(allowedPage(target))open(accountId,target,wc.id,true);return {action:'deny'};});
  wc.on('will-navigate',(event,target)=>{if(!allowedPage(target)){event.preventDefault();p.issue='已阻止跳转至学院之外的地址';update();}});
  wc.on('will-redirect',(event,target)=>{if(!allowedPage(target))event.preventDefault();});
  wc.on('page-title-updated',(_event,title)=>{p.title=title;update();});
  wc.on('did-finish-load',()=>{p.issue='';update();});
  wc.on('did-fail-load',(_e,code,_description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3){p.issue='页面加载失败，请查看该账号后重试';notify(accountId,p.issue);update();}});
  wc.on('render-process-gone',()=>{p.issue='页面进程已退出；请点击重新加载。不会自动新开播放器。';notify(accountId,p.issue);update();});
  wc.on('unresponsive',()=>{p.issue='页面暂时无响应';notify(accountId,p.issue);update();});
  wc.on('responsive',()=>{p.issue='';update();});
  wc.on('destroyed',()=>{pages.delete(wc.id);for(const other of pages.values())other.view.webContents.send('helper-closed',wc.id);if(active===wc.id)active=[...pages.keys()][0]||'';if(!closing)layout();});
  if(focus||!active||(parent&&active===parent))active=wc.id;layout();wc.loadURL(url).catch(()=>{});return wc.id;
}
function sender(event){const p=pages.get(event.sender.id);if(!p||!allowedPage(event.senderFrame?.url||''))throw new Error('Invalid sender');return p;}
function closePage(id){const p=pages.get(id);if(!p)return;win.contentView.removeChildView(p.view);p.view.webContents.close();}
ipcMain.on('helper',(event,op,args=[])=>{
  try{
    const p=sender(event),values=store(p.accountId),[key,value]=args;
    switch(op){
      case 'id':event.returnValue=event.sender.id;break;
      case 'get':event.returnValue=key==='gdgbpx_bark_config_v1'?{found:Boolean(barkConfig),value:barkConfig}:{found:Object.hasOwn(values,key),value:values[key]};break;
      case 'set':case 'delete':{
        if(typeof key!=='string'||key.length>300)throw new Error('Invalid key');
        const old=values[key];if(op==='set')values[key]=value;else delete values[key];
        if(op==='set'&&key.endsWith(':gdgbpx_workshop_helper_state_v1'))muteForScope(p.accountId,key.split(':')[1],value?.settings?.muted);
        for(const target of pages.values())if(target.accountId===p.accountId)for(const frame of target.view.webContents.mainFrame.framesInSubtree){try{frame.send('helper-value',key,old,op==='set'?value:undefined,event.sender.id);}catch{}}
        persist();update();event.returnValue=true;break;
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
ipcMain.handle('panel-command',async(event,op,id)=>{
  if(!trustedPanel(event))return;
  if(op==='state'){update();return;}
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
  if(op==='reload'&&p)p.view.webContents.reload();
  if(op==='menu'&&p){Menu.buildFromTemplate([...p.menus].map(name=>({label:name,click:()=>p.view.webContents.send('helper-menu',name)}))).popup({window:win});}
  if(op==='close'&&p){const answer=await dialog.showMessageBox(win,{type:'question',message:'关闭此页面？正在观看的课程会中断。',buttons:['取消','关闭'],defaultId:0,cancelId:0});if(answer.response===1)closePage(Number(id));}
});
app.whenReady().then(async()=>{
  accounts=read('accounts.json',[]);if(!Array.isArray(accounts))throw new Error('账号配置格式错误');for(const a of accounts)partition(a.id);
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
  if(selfTest){closing=true;await require('./tests/engine-selftest.cjs')({accounts,configure,open,pages,store,win,app});}
}).catch(error=>{dialog.showErrorBox('客户端启动失败',error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>{clearTimeout(saveTimer);clearTimeout(diagnosticsTimer);for(const [id,value]of stores)write('helper-'+id+'.json',value);});
