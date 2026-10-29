'use strict';
const {randomUUID}=require('node:crypto');
const HOSTS=new Set(['gbpx.gd.gov.cn','wcs1.shawcoder.xyz','cs1.gdgbpx.com']);
function allowedPage(value) {
  try {const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && HOSTS.has(u.hostname) && !u.port;} catch {return false;}
}
function partition(id) {
  if(!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid account id');
  return 'persist:gdgbpx-'+id;
}
function account(name) {return {id:randomUUID(),name:String(name||'新账号').slice(0,40)};}
function summarize(values,scopes=null) {
  return Object.entries(values).filter(([key])=>key.endsWith(':gdgbpx_workshop_helper_state_v1')&&(!scopes||scopes.has(key.split(':')[1])))
    .map(([,s])=>({status:s.status,phase:s.phase,message:String(s.message||'').slice(0,220),
      lesson:String(s.currentLessonTitle||'').slice(0,120),progress:s.currentLessonProgress}));
}
module.exports={allowedPage,partition,account,summarize};
