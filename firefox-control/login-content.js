(() => {
'use strict';
if(globalThis.__ganbuLoginAdapterV1)return;
globalThis.__ganbuLoginAdapterV1=true;
const $=s=>document.querySelector(s);
let challenge=null, submittedAt=0;
function loggedIn() {return Boolean($('#ctl00_thetheUser')?.textContent.trim());}
function fill(element,value) {
 const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
 setter.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));
}
async function inspect() {
 if(loggedIn()) {
  challenge=null;
  const header=($('#header_right_box')?.innerText||'').replace(/\s+/g,' ').trim().slice(0,500);
  const hours=header.match(/累计学时\s*[:：]\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  const name=header.match(/([\p{Script=Han}·]{2,20})\s*(?:已关联微信|关联微信|退出登录)/u);
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode($('#ctl00_thetheUser').textContent.trim()));
  const identityKey=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  return {status:'logged-in-unverified',identityKey,name:name?.[1]||'',creditedHours:hours?Number(hours[1]):null,header};
 }
 const image=$('#imgValid'),user=$('#txtLoginName'),password=$('#txtPassword'),code=$('#txtValid');
 if(!user||!password||!code||!image)return {status:'unsupported-page'};
 if(!image.complete || !image.naturalWidth)return {status:'captcha-loading'};
 let bitmap;
 try {
  if(image.naturalWidth>1000||image.naturalHeight>1000)throw Error('size');
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  canvas.getContext('2d').drawImage(image,0,0);bitmap=canvas.toDataURL('image/png');
 }catch{return {status:'captcha-unavailable'};}
 if(!challenge||challenge.source!==image.currentSrc||challenge.bitmap!==bitmap)challenge={source:image.currentSrc,bitmap,token:crypto.randomUUID()};
 // Only classify hints. Never echo arbitrary page messages which may contain credentials.
 const hint=$('#hintMsg')?.innerText||'';
 let hintCode='';
 if(/验证码/.test(hint))hintCode='captcha';else if(/密码|用户名|账号/.test(hint))hintCode='credentials';else if(/正在登录/.test(hint))hintCode='pending';
 return {status:'awaiting-captcha',captchaImage:bitmap,challenge:challenge.token,agreementAccepted:Boolean($('#cbAgree')?.checked),hintCode};
}
browser.runtime.onMessage.addListener((message,sender)=>{
 if(sender.id!==browser.runtime.id || message?.channel!=='gdgbpx-login-v1')return undefined;
 return Promise.resolve().then(async()=>{
  if(message.action==='inspect')return inspect();
  if(message.action==='logout') {
   const current=await inspect();
   if(current.status!=='logged-in-unverified')return current;
   if(!message.identityKey || current.identityKey!==message.identityKey)return {status:'identity-changed'};
   const button=$('#header_right_box [onclick*="logOut"]') || $('a[href*="javascript:logOut("]');
   if(!button)return {status:'logout-manual-required'};
   challenge=null;button.click();return {status:'logging-out'};
  }
  if(message.action==='refresh') {
   if(loggedIn())return inspect();
   challenge=null;$('#imgValid')?.click();return {status:'captcha-loading'};
  }
  if(message.action!=='submit')return {status:'unsupported-action'};
  if(loggedIn())return inspect();
  if(Date.now()-submittedAt<15000)return {status:'submission-pending'};
  const current=await inspect();
  if(current.status!=='awaiting-captcha')return current;
  if(!message.challenge||current.challenge!==message.challenge)return {status:'captcha-changed'};
  const agreement=$('#cbAgree');
  if(message.agree===true && agreement && !agreement.checked)agreement.click();
  if(!agreement?.checked)return {status:'agreement-required'};
  if(typeof message.username!=='string'||!message.username||typeof message.password!=='string'||!message.password||typeof message.captcha!=='string'||!message.captcha)return {status:'missing-fields'};
  const button=$('#user-login-form .loginBtnBox[onclick*="lnkbtnLogin"]');
  if(!button)return {status:'unsupported-page'};
  fill($('#txtLoginName'),message.username);fill($('#txtPassword'),message.password);fill($('#txtValid'),message.captcha);
  submittedAt=Date.now();challenge=null;
  try {button.click();}finally {
   // The site's observed handler reads all fields synchronously before its AJAX request.
   fill($('#txtPassword'),'');fill($('#txtValid'),'');
  }
  return {status:'submitted'};
 }).catch(()=>({status:'page-operation-failed'}));
});
})();
