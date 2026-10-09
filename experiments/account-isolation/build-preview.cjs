'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const original = fs.readFileSync(path.join(root, 'gdgbpx-workshop-helper.user.js'), 'utf8');
// Fail loudly when production changes instead of silently losing isolation hooks.
for (const anchor of ["const VERSION = '1.5.22';", '// @run-at       document-idle',
    'GM_openInTab(target.url, {', "if (!lesson.titleElement) return 'none';",
    'if (retryPlayerOpen && openCurrentLessonFromUserGesture()) return;',
    "updateState({ message: '请先手动进入“专题学习 → 在学”页面' });",
    '专题学习助手 v${VERSION}', '    installGlobalErrorLogging();']) {
    if (original.split(anchor).length !== 2) throw new Error('Preview build anchor changed: ' + anchor);
}
const end = original.indexOf('// ==/UserScript==') + '// ==/UserScript=='.length;
let header = original.slice(0, end)
    .replace(/\/\/ @name .*/, '// @name         广东干部学院学习助手（多账号测试版）')
    .replace(/\/\/ @namespace .*/, '// @namespace    https://gbpx.gd.gov.cn/multi-account-preview/')
    .replace(/\/\/ @version .*/, '// @version      0.2.0')
    .replace(/^\/\/ @(?:updateURL|downloadURL).*\r?\n/gm, '')
    .replace('// @run-at       document-idle', '// @grant        GM_getTab\n// @grant        GM_saveTab\n// @match        https://gbpx.gd.gov.cn/gdceportal/index.aspx*\n// @run-at       document-start');
let body = original.slice(end).replace("const VERSION = '1.5.22';", "const VERSION = '0.2.0-preview';")
    .replace('setTimeout(() => checkForScriptUpdate(false), 3000);', '// Preview has no automatic production update check.')
    .replace("GM_registerMenuCommand('检查脚本更新', () => checkForScriptUpdate(true));", '// Preview updates are installed explicitly.')
    .replace('const availableUpdate = getAvailableUpdate();', 'const availableUpdate = null;')
    .replace('GM_openInTab(target.url, {', 'GM_openInTab(prepareScopedPlayerUrl(native, accountScope, target.url, scopeEnvironment), {')
    .replace(/        if \(!lesson.titleElement\) return 'none';[\s\S]*?        return 'site-click';/, "// A native site popup has no scoped launch ticket.\n        return 'none';")
    .replace('if (retryPlayerOpen && openCurrentLessonFromUserGesture()) return;', '// Retry through the scoped managed-tab path; reuse the existing tab handle.')
    .replace("updateState({ message: '请先手动进入“专题学习 → 在学”页面' });", "updateState({ status: 'running', phase: 'list-ready', message: '正在进入专题学习 → 在学' });\n                location.assign('https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop/workshopindex/classList?classType=3');")
    .replace("专题学习助手 v${VERSION}", "专题学习助手 v${VERSION} · ${accountScope.id.slice(0, 6)}");
// Keep production untouched. Bundle the preview's storage adapter and bootstrap.
const storage = fs.readFileSync(path.join(__dirname,'storage.cjs'),'utf8').replace(/^module.exports.*$/m,'');
const context = fs.readFileSync(path.join(__dirname,'tab-context.cjs'),'utf8').replace(/^module.exports.*$/m,'');
const output = header + `
(async function(native) {
${storage}
${context}
const scopeEnvironment = { href: location.href, isTop: window.top === window,
 isMain: location.hostname === 'gbpx.gd.gov.cn',
 isPlayer: ['wcs1.shawcoder.xyz','cs1.gdgbpx.com'].includes(location.hostname),
 now: () => Date.now(), uuid: () => crypto.randomUUID(), setTimeout, clearTimeout };
try {
const accountScope = await resolveTabScope(native, scopeEnvironment);
const { GM_getValue, GM_setValue, GM_deleteValue, GM_addValueChangeListener, GM_removeValueChangeListener } = createAccountStorage(native, accountScope.id);
// Website session isolation must apply to maintenance checks too. Use the page's
// fetch implementation rather than extension-global cookies. No off-origin request.
const GM_xmlhttpRequest = details => {
 const url = new URL(details.url, location.href);
 if (url.origin === 'https://gbpx.gd.gov.cn' && location.hostname === 'gbpx.gd.gov.cn') {
   const page = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
   const controller = new page.AbortController();
   const timer = setTimeout(() => controller.abort(), details.timeout || 15000);
   page.fetch(url.href, { credentials:'include', cache:'no-store', signal:controller.signal })
    .then(async response => ({status:response.status,finalUrl:response.url,responseText:await response.text()}))
    .then(response => { clearTimeout(timer); details.onload?.(response); },
      error => { clearTimeout(timer); if(error.name==='AbortError') details.ontimeout?.(); else details.onerror?.(); });
   return {abort:()=>controller.abort()};
 }
 // Preview diagnostics remain in scoped GM storage, not a shared debug bridge.
 if (url.hostname === '127.0.0.1') { details.onerror?.(); return; }
 return native.GM_xmlhttpRequest(details);
};
if(document.readyState === 'loading') await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
${body}
} catch(error) {
 const show = () => { const node=document.createElement('div');node.setAttribute('role','alert');
 node.style.cssText='position:fixed;left:0;bottom:0;z-index:2147483647;background:white;color:#a40000;padding:12px;border:1px solid red';
 node.textContent='多账号助手未启动：'+error.message;document.body.appendChild(node); };
 if(document.body)show();else document.addEventListener('DOMContentLoaded',show,{once:true});
}
})({GM_getValue,GM_setValue,GM_deleteValue,GM_addValueChangeListener,GM_removeValueChangeListener,GM_getTab,GM_saveTab,GM_xmlhttpRequest});
`;
const out = path.join(__dirname,'gdgbpx-multi-account-preview.user.js');
fs.writeFileSync(out, output);
console.log(out);
