(async function(native) {
    'use strict';
    /* ACCOUNT_MODULES */
    const page = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    const isMain = location.hostname === 'gbpx.gd.gov.cn';
    const ready = () => document.readyState === 'loading'
        ? new Promise(resolve => document.addEventListener('DOMContentLoaded',resolve,{once:true})) : Promise.resolve();
    try {
        // MultiLogin must have installed its page storage proxy before we bind a main tab.
        if (isMain) await ready();
        const accountRuntime = await createAccountRuntime(native, {
            href:()=>location.href,isMain,isTop:window.top===window,
            isPlayer:['wcs1.shawcoder.xyz','cs1.gdgbpx.com'].includes(location.hostname),
            now:()=>Date.now(),uuid:()=>crypto.randomUUID(),setTimeout,clearTimeout,
            saveLaunch(value) { try { page.sessionStorage.setItem('gdgbpxLaunchRelayV2',JSON.stringify(value)); } catch (_) {} },
            readLaunch() { try { return JSON.parse(page.sessionStorage.getItem('gdgbpxLaunchRelayV2')||'null'); } catch (_) { return null; } },
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
            isLoginPage:()=>Boolean(document.querySelector('input[type="password"]')),
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
        document.body?.appendChild(node);
    }
})({GM_getValue,GM_setValue,GM_deleteValue,GM_addValueChangeListener,GM_removeValueChangeListener,GM_getTab,GM_saveTab,GM_xmlhttpRequest});
