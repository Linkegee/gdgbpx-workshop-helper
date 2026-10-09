'use strict';
function createSessionRequest(native,page,runtime,location,timers) {
    return details => {
        const url=new URL(details.url,location.href);
        if(url.origin!=='https://gbpx.gd.gov.cn') {
            if(url.hostname==='127.0.0.1') { details.onerror?.(); return; }
            return native.GM_xmlhttpRequest(details);
        }
        if(location.hostname!=='gbpx.gd.gov.cn' || !runtime.guard()) { details.onerror?.(); return; }
        const controller=new page.AbortController();
        const timer=timers.setTimeout(()=>controller.abort(),details.timeout||15000);
        Promise.resolve().then(()=>page.fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',signal:controller.signal}))
            .then(async response=>({status:response.status,finalUrl:response.url,responseText:await response.text()}))
            .then(response=>{timers.clearTimeout(timer);if(runtime.guard())details.onload?.(response);},error=>{
                timers.clearTimeout(timer);
                if(!runtime.guard())return;
                if(error.name==='AbortError')details.ontimeout?.();else details.onerror?.();
            });
        return {abort:()=>controller.abort()};
    };
}
module.exports={createSessionRequest};
