'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const root=path.join(process.env.APPDATA||'', 'GanbuUnifiedClient');
async function main(){
 const [accountId,action]=process.argv.slice(2);
 if(!/^[a-f0-9-]{36}$/.test(accountId||'')||!['inspect','retry','reload-main','reload-player','notify'].includes(action))throw new Error('Usage: node control.cjs ACCOUNT_UUID inspect|retry|reload-main|reload-player|notify');
 const request={id:randomUUID(),accountId,action,at:Date.now()},dir=path.join(root,'control/inbox');fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,request.id+'.json');fs.writeFileSync(file+'.tmp',JSON.stringify(request));fs.renameSync(file+'.tmp',file);
 const result=path.join(root,'control/results',request.id+'.json');
 for(let i=0;i<50;i++){if(fs.existsSync(result)){console.log(fs.readFileSync(result,'utf8'));return;}await new Promise(resolve=>setTimeout(resolve,250));}
 console.log(JSON.stringify({id:request.id,result:'not-acknowledged',note:'客户端离线、版本未升级或命令处理延迟；不能视为恢复成功'}));process.exitCode=2;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
