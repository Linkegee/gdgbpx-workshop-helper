'use strict';

// One-time same-origin handoff. Authenticated URLs stay in memory, never in
// userscript storage or in the staging URL/history.
function createLaunchChannel({Channel,setTimeout,clearTimeout}) {
    return {
        publish(id,target,allowed) {
            const channel=new Channel('gdgbpx-launch-v1:'+id);
            let closed=false;
            const close=()=>{if(!closed){closed=true;clearTimeout(timer);channel.close();}};
            const timer=setTimeout(close,120000);
            channel.onmessage=event=>{
                if(event.data?.type==='request' && !closed) {
                    if(!allowed()){close();return;}
                    channel.postMessage({type:'target',target});
                } else if(event.data?.type==='received') close();
            };
            return close;
        },
        receive(id) {
            return new Promise((resolve,reject)=>{
                const channel=new Channel('gdgbpx-launch-v1:'+id);
                const timer=setTimeout(()=>{channel.close();reject(new Error('启动主页面未响应，请保留对应专题页后重新开始'));},10000);
                channel.onmessage=event=>{
                    if(event.data?.type!=='target' || typeof event.data.target!=='string') return;
                    clearTimeout(timer);
                    channel.postMessage({type:'received'});channel.close();
                    resolve(event.data.target);
                };
                channel.postMessage({type:'request'});
            });
        }
    };
}
module.exports={createLaunchChannel};
