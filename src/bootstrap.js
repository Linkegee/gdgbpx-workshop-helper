(async function(native) {
    'use strict';
    /* ACCOUNT_MODULES */
    const page = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    const bootstrapDocumentTag = crypto.randomUUID();
    const bootstrapTrace = [];
    let diagnosticSink = null;
    function recordBootstrap(event, detail = {}) {
        const route = new URL(location.href);
        const record = {time:new Date().toISOString(), event, detail,
            documentTag:bootstrapDocumentTag, origin:route.origin,path:route.pathname,
            topLevel:window.top===window};
        bootstrapTrace.push(record);
        if (bootstrapTrace.length > 80) bootstrapTrace.shift();
        try { diagnosticSink?.(record); } catch (_) {}
    }
    function bindBootstrapDiagnostics(sink) {
        diagnosticSink = sink;
        for (const record of bootstrapTrace) { try { sink(record); } catch (_) {} }
    }
    const isMain = location.hostname === 'gbpx.gd.gov.cn';
    const ready = () => document.readyState === 'loading'
        ? new Promise(resolve => document.addEventListener('DOMContentLoaded',resolve,{once:true})) : Promise.resolve();
    try {
        // MultiLogin must have installed its page storage proxy before we bind a main tab.
        if (isMain) await ready();
        const accountRuntime = await createAccountRuntime(native, {
            onDiagnostic:recordBootstrap,
            href:()=>location.href,isMain,isTop:window.top===window,
            isPlayer:['wcs1.shawcoder.xyz','cs1.gdgbpx.com'].includes(location.hostname),
            now:()=>Date.now(),uuid:()=>crypto.randomUUID(),setTimeout,clearTimeout,
            saveLaunch(value) {
                try {
                    page.sessionStorage.setItem('gdgbpxLaunchRelayV2',JSON.stringify(value));
                    recordBootstrap('launch-relay-saved');
                } catch (_) { recordBootstrap('launch-relay-save-failed'); }
            },
            readLaunch() {
                try {
                    const saved=JSON.parse(page.sessionStorage.getItem('gdgbpxLaunchRelayV2')||'null');
                    recordBootstrap('launch-relay-read',{present:Boolean(saved)});
                    return saved;
                } catch (_) { recordBootstrap('launch-relay-read-failed');return null; }
            },
            sessionMarker() {
                const key='gdgbpxSessionMarkerV2';
                let marker=page.localStorage.getItem(key);
                if (!/^[a-f0-9-]{36}$/.test(marker||'')) {
                    marker=crypto.randomUUID();page.localStorage.setItem(key,marker);
                }
                if(page.localStorage.getItem(key)!==marker) throw new Error('会话存储不可用');
                return marker;
            },
            routeUid() { return new URLSearchParams((location.hash.split('?')[1]||'')).get('uid')||''; },
            async digest(value) {
                const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
                return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
            },
            // The logged-in homepage retains a hidden login form.
            isLoginPage:()=>Array.from(document.querySelectorAll('input[type="password"]'))
                .some(input=>input.getClientRects().length>0),
            onReady:()=>window.dispatchEvent(new Event('gbpx-account-ready')),
            onBlocked:()=>window.dispatchEvent(new Event('gbpx-account-ready'))
        });
        const storage = createAccountStorage(native,accountRuntime.id);
        if(isMain && window.top===window) migratePreferences(native,storage);
        const {GM_getValue,GM_setValue,GM_deleteValue,GM_addValueChangeListener,GM_removeValueChangeListener}=storage;
        const GM_xmlhttpRequest = createSessionRequest(native,page,accountRuntime,location,{setTimeout,clearTimeout});
        if(isMain && window.top===window) {
            setInterval(()=>accountRuntime.guard(),1000);
            document.addEventListener('click',event=>{
                const node=event.target?.closest?.('a,button,[role="menuitem"],li');
                if(node && /^(退出|退出登录|注销)$/.test(node.textContent.trim())) accountRuntime.invalidate('已退出登录；刷新后重新开始');
            },true);
        }
        await ready();
        /* HELPER_CORE */
    } catch(error) {
        await ready();
        const node=document.createElement('div');node.setAttribute('role','alert');
        node.style.cssText='position:fixed;left:0;bottom:0;z-index:2147483647;background:white;color:#a40000;padding:12px;border:1px solid red';
        node.textContent='学习助手未启动：'+error.message;
        recordBootstrap('bootstrap-failed', {errorType:error?.name || 'Error'});
        const download=document.createElement('button');
        download.textContent='下载启动诊断';
        download.addEventListener('click',()=>{
            const data={schemaVersion:2,scriptVersion:null /* SCRIPT_VERSION */,generatedAt:new Date().toISOString(),
                context:'bootstrap-failure',documentTag:bootstrapDocumentTag,
                userAgent:navigator.userAgent,trace:bootstrapTrace};
            const href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));
            const link=document.createElement('a');link.href=href;
            link.download='gdgbpx-startup-'+bootstrapDocumentTag.slice(0,8)+'.json';
            document.body.appendChild(link);link.click();link.remove();
            setTimeout(()=>URL.revokeObjectURL(href),1000);
        });
        node.appendChild(download);
        document.body?.appendChild(node);
    }
})({GM_getValue,GM_setValue,GM_deleteValue,GM_addValueChangeListener,GM_removeValueChangeListener,GM_getTab,GM_saveTab,GM_xmlhttpRequest});
