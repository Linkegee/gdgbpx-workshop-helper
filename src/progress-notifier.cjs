// Local progress monitoring: no model calls and no credentials in diagnostics.
function createProgressNotifier(api, scope, clock = Date.now) {
    const configKey='gdgbpx_bark_config_v1', ledgerKey='gdgbpx_bark_watch_v1:'+scope;
    function tick(state) {
        const config=api.GM_getValue(configKey,null);
        if(!config || !/^[A-Za-z0-9_-]+$/.test(config.key||''))return;
        const now=clock(), minutes=Math.max(3,Math.min(120,Number(config.minutes)||10));
        const active=state.status==='running' || (state.status==='paused' && !state.userPaused && ['player-open-failed','completed-close-failed','completion-unverified'].includes(state.phase));
        if(!active || state.maintenance || !state.currentLessonKey) {api.GM_deleteValue(ledgerKey);return;}
        const previous=api.GM_getValue(ledgerKey,null), progress=Number(state.currentLessonProgress)||0;
        if(!previous || previous.lesson!==state.currentLessonKey || progress>previous.progress || now<previous.since) {
            api.GM_setValue(ledgerKey,{lesson:state.currentLessonKey,progress,since:now,sent:false});return;
        }
        if(previous.sent || now-previous.since<minutes*60000)return;
        // Reserve before sending. Unknown deliveries must not create duplicate alerts.
        const reserved={...previous,sent:true,result:'attempting',at:now};
        api.GM_setValue(ledgerKey,reserved);
        const finish=result=>{const latest=api.GM_getValue(ledgerKey,null);if(latest?.at===now && latest?.lesson===reserved.lesson)api.GM_setValue(ledgerKey,{...latest,result});};
        try {api.GM_xmlhttpRequest({method:'POST',url:'https://api.day.app/push',timeout:15000,
            headers:{'Content-Type':'application/json'},data:JSON.stringify({device_key:config.key,title:'学院学习进度未更新',
                body:`账号标识：${scope.slice(0,8)}\n课程：${state.currentLessonTitle||'未知'}\n服务器进度：${progress}%\n已约 ${Math.floor((now-previous.since)/60000)} 分钟无增长。\n状态：${state.phase}；请查看学院页面或下载日志交给 Codex 排查。`,group:'干部学院',isArchive:'1'}),
            onload:r=>{let ok=false;try{ok=r.status===200 && JSON.parse(r.responseText).code===200;}catch(_){}finish(ok?'accepted':'rejected');},
            onerror:()=>finish('delivery-unknown'),ontimeout:()=>finish('delivery-unknown')});
        }catch(_){finish('delivery-unknown');}
    }
    return {tick,configure(key,minutes=10){
        if(key && !/^[A-Za-z0-9_-]+$/.test(key))throw new Error('Bark key 格式无效');
        if(key)api.GM_setValue(configKey,{key,minutes:Math.max(3,Math.min(120,Number(minutes)||10))});
        else api.GM_deleteValue(configKey);
    }};
}
module.exports={createProgressNotifier};
