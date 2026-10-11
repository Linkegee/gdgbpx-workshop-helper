/* Only our own extension panel can command managed login tabs. */
'use strict';
const controller=new GanbuController(browser);
browser.browserAction.onClicked.addListener(async()=>{
 const url=browser.runtime.getURL('panel.html');
 const tabs=await browser.tabs.query({url});
 if(tabs.length) {await browser.tabs.update(tabs[0].id,{active:true});await browser.windows.update(tabs[0].windowId,{focused:true});}
 else await browser.tabs.create({url});
});
browser.runtime.onMessage.addListener((message,sender)=>{
 if(sender.id!==browser.runtime.id || sender.url!==browser.runtime.getURL('panel.html'))return undefined;
 return (async()=>{
  try {
   let value;
   switch(message?.action) {
    case 'list':value=await controller.list();break;
    case 'containers':value=await controller.containers();break;
    case 'add':value=await controller.add(message);break;
    case 'prepare':value=await controller.prepare(message.id);break;
    case 'inspect':value=await controller.inspect(message.id);break;
    case 'study':value=await controller.study(message.id);break;
    case 'submit':value=await controller.submit(message.id,message);break;
    case 'confirmIdentity':value=await controller.confirmIdentity(message.id,message.identityKey);break;
    case 'switchLogin':value=await controller.switchLogin(message.id,message.identityKey,message.confirmed);break;
    case 'refresh':value=await controller.refresh(message.id);break;
    case 'focus':value=await controller.focus(message.id);break;
    case 'remove':value=await controller.remove(message.id);break;
    case 'diagnostics':value=controller.diagnostics();break;
    default:throw Error('不支持的操作');
   }
   return {ok:true,value};
  }catch(error) {
   // Never return arbitrary browser/page exception text: it may contain secrets.
   if(['prepare','inspect','submit','refresh','focus'].includes(message?.action)) controller.log(controller.rows.some(r=>r.id===message.id)?message.id:'unknown',message.action+'-failed');
   const allowed=/^(账号不存在|请填写有效账号和备注|正在添加账号|此账号已经添加|此容器已绑定其他账号|容器不存在|此账号有操作正在执行|请先准备登录页|登录页或容器已改变，请重新准备|浏览器未在指定容器打开页面|请输入密码|请输入本账号的验证码|不支持的操作|身份已变化，请重新检查|此身份已绑定其他账号|需要确认切换账号)$/;
   return {ok:false,error:allowed.test(error.message)?error.message:'页面尚未就绪、已关闭或连接失效；请稍后检查或重新准备登录页'};
  }
 })();
});
