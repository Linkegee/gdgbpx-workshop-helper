// Local MultiLogin compatibility probe. Contains synthetic markers only.
// node experiments/account-isolation/session-probe.cjs
'use strict';
const http = require('node:http');
const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>MultiLogin 会话隔离测试</title>
<style>body{max-width:850px;margin:32px auto;font:16px/1.6 sans-serif}button,a{margin:6px;padding:8px}pre{background:#eee;padding:16px;white-space:pre-wrap}iframe{width:100%;height:220px}</style>
<h1>MultiLogin 会话隔离测试</h1><p>仅使用本地测试标记，不登录学院，不读取学院 Cookie，也不产生学习记录。</p>
<p>先由 MultiLogin 为本标签分配会话，再写入 A 或 B；另一个会话写入另一标记。刷新与子页读取不应串号。</p>
<button id="a">写入测试账号 A</button><button id="b">写入测试账号 B</button><button id="read">重新读取</button>
<a href="/child" target="_blank">普通链接打开子标签</a><button id="popup">window.open 打开子标签</button>
<button id="frame">加载同源 iframe</button><pre id="report">等待读取</pre><div id="frames"></div>
<script>
const key='gbpx_multilogin_probe';
function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open(key,1);r.onupgradeneeded=()=>r.result.createObjectStore('markers');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function idb(value){const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('markers',value===undefined?'readonly':'readwrite');const req=value===undefined?tx.objectStore('markers').get('account'):tx.objectStore('markers').put(value,'account');let result;req.onsuccess=()=>{result=req.result};tx.oncomplete=()=>resolve(result||null);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
function ownCookie(){return document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(key+'='))?.split('=')[1]||null;}
async function read(){try{const echo=await fetch('/echo',{cache:'no-store',credentials:'include'}).then(r=>r.json());const data={localStorage:localStorage.getItem(key),javascriptCookie:ownCookie(),requestCookie:echo.marker,indexedDB:await idb()};document.getElementById('report').textContent=JSON.stringify(data,null,2);}catch(e){document.getElementById('report').textContent='测试读取失败：'+e.message;}}
async function write(value){localStorage.setItem(key,value);document.cookie=key+'='+value+'; Path=/; SameSite=Lax';await idb(value);await read();}
document.getElementById('a').onclick=()=>write('A');document.getElementById('b').onclick=()=>write('B');document.getElementById('read').onclick=read;
document.getElementById('popup').onclick=()=>window.open('/child','_blank');
document.getElementById('frame').onclick=()=>{const f=document.createElement('iframe');f.title='同源会话测试子页';f.src='/child';document.getElementById('frames').replaceChildren(f);};read();
</script></html>`;
function handler(req,res){
    res.setHeader('Cache-Control','no-store');
    if(req.url==='/echo'){
        const marker=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('gbpx_multilogin_probe='))?.split('=')[1];
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({marker:['A','B'].includes(marker)?marker:null}));return;
    }
    if(req.url!=='/'&&req.url!=='/child'){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page);
}
if(require.main===module)http.createServer(handler).listen(17893,'127.0.0.1',()=>console.log('Session probe: http://127.0.0.1:17893/'));
module.exports={handler};
