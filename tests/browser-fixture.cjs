// Local-only interactive integration fixture. No real course/player requests.
// Run: node tests/browser-fixture.cjs, then open http://127.0.0.1:17892/gdceportal/dist/
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let mode = 'maintenance';
const helper = fs.readFileSync(path.join(__dirname, '..', 'gdgbpx-workshop-helper.user.js'), 'utf8')
    .replace("const MAIN_HOST = 'gbpx.gd.gov.cn';", "const MAIN_HOST = '127.0.0.1';")
    .replaceAll('`https://${MAIN_HOST}`', 'location.origin');

function html() {
    return `<!doctype html><meta charset="utf-8"><title>${mode === 'maintenance' ? '维护公告' : '学院测试页面'}</title>
<style>body{font:18px sans-serif;padding:30px}button{margin:8px;padding:10px}.notice-main{margin:40px}#app{margin:40px}</style>
<h1>维护恢复本地测试（不连接真实学院）</h1>
<button onclick="setMode('maintenance')">模拟维护</button><button onclick="setMode('open')">模拟开放</button>
<button onclick="setMode('login')">模拟登录失效</button><button onclick="advance()">推进31秒并检查</button>
<button onclick="localStorage.clear();location.reload()">重置测试</button>
<p id="fixture-mode">服务器：${mode}</p><p id="fixture-opened">打开播放器次数：0</p>
${mode === 'maintenance' ? '<div class="notice-main">维护公告<p>9月24日-27日，9月30日-10月7日晚上21:00至次日8:00系统关闭，造成不便敬请谅解</p></div>'
    : mode === 'login' ? '<div id="app">登录已失效 <input type="password" aria-label="测试密码"></div>'
    : '<div id="app"><div id="pane-required"><div class="item_box"><span class="item_title">测试课程</span><span class="item_status">未完成</span><span role="progressbar" aria-valuenow="84">84%</span></div></div></div>'}
<script>
const stateKey='gdgbpx_workshop_helper_state_v1';
const realNow=Date.now; let offset=Number(localStorage.getItem('clock-offset')||0);
Date.now=()=>realNow()+offset;
function advance(){offset+=31000;localStorage.setItem('clock-offset',offset);window.dispatchEvent(new Event('focus'));}
async function setMode(mode){await fetch('/mode/'+mode,{method:'POST'});document.querySelector('#fixture-mode').textContent='服务器：'+mode;}
if(!location.hash)location.hash='#/workshop/workshopindex/mergeClass?classId=fixture-class&type=1';
if(!localStorage.getItem(stateKey))localStorage.setItem(stateKey,JSON.stringify({status:'running',phase:'watching-video',currentClassId:'fixture-class',currentLessonTitle:'测试课程',currentLessonKey:'fixture-class::测试课程',currentLessonProgress:83.13}));
window.GM_getValue=(key,fallback)=>localStorage.getItem(key)===null?fallback:JSON.parse(localStorage.getItem(key));
window.GM_setValue=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
window.GM_deleteValue=key=>localStorage.removeItem(key);
window.GM_addValueChangeListener=()=>1;window.GM_removeValueChangeListener=()=>{};window.GM_registerMenuCommand=()=>{};
window.GM_setClipboard=()=>{};
window.GM_addStyle=css=>{const style=document.createElement('style');style.textContent=css;document.head.appendChild(style);};
window.GM_xmlhttpRequest=details=>{
  if(!details.url.startsWith(location.origin+'/gdceportal/'))return;
  fetch(details.url,{cache:'no-store'}).then(async response=>details.onload({status:response.status,finalUrl:response.url,responseText:await response.text()})).catch(()=>details.onerror());
};
window.GM_openInTab=()=>{const count=Number(localStorage.getItem('open-count')||0)+1;localStorage.setItem('open-count',count);document.querySelector('#fixture-opened').textContent='打开播放器次数：'+count;return {close(){this.closed=true;this.onclose?.();}};};
document.querySelector('#fixture-opened').textContent='打开播放器次数：'+(localStorage.getItem('open-count')||0);
window.unsafeWindow=window;
const title=document.querySelector('.item_title');
if(title)title.__vue__={info:{playDomain:location.origin+'/fixture-player'},$$Request:{course_auth:'fixture-only'},listNav:{requiredCourseList:{listInfo:[{courseName:'测试课程',courseId:'db-fixture',resourceCode:'resource-fixture'}]}}};
</script><script src="/helper.js"></script>`;
}

http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'POST' && /^\/mode\/(maintenance|open|login)$/.test(req.url)) {
        mode = req.url.split('/').at(-1); res.end('ok'); return;
    }
    if (req.url === '/helper.js') {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8'); res.end(helper); return;
    }
    if (!req.url.startsWith('/gdceportal/dist/')) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html());
}).listen(17892, '127.0.0.1', () => console.log('Fixture ready: http://127.0.0.1:17892/gdceportal/dist/'));
