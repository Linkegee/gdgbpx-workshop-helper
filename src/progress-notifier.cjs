// Local progress monitoring: no model calls and no credentials in diagnostics.
function createProgressNotifier(api, scope, clock = Date.now) {
    const configKey='gdgbpx_bark_config_v1', ledgerKey='gdgbpx_bark_watch_v1:'+scope,
        incidentKey='gdgbpx_bark_incident_v1:'+scope;
    function send(config,title,body,finish) {
        try {api.GM_xmlhttpRequest({method:'POST',url:'https://api.day.app/push',timeout:15000,
            headers:{'Content-Type':'application/json'},data:JSON.stringify({device_key:config.key,title,body,group:'干部学院',isArchive:'1'}),
            onload:r=>{let ok=false;try{ok=r.status===200 && JSON.parse(r.responseText).code===200;}catch(_){}finish(ok?'accepted':'rejected');},
            onerror:()=>finish('delivery-unknown'),ontimeout:()=>finish('delivery-unknown')});
        }catch(_){finish('delivery-unknown');}
    }
    function test(finish) {
        const config=api.GM_getValue(configKey,null);
        if(!config || !/^[A-Za-z0-9_-]+$/.test(config.key||'')){finish('not-configured');return;}
        const key='gdgbpx_bark_test_at_v1',now=clock(),last=api.GM_getValue(key,null);
        if(last!==null && now-last>=0 && now-last<30000){finish('rate-limited');return;}
        api.GM_setValue(key,now);
        send(config,'学院助手 Bark 测试','这是你手动发送的测试通知。收到表示浏览器到手机的 Bark 推送链路可用；不会暂停课程或改变进度提醒计时。',finish);
    }
    function tick(state,onIncident=()=>{}) {
        const config=api.GM_getValue(configKey,null);
        if(!config || !/^[A-Za-z0-9_-]+$/.test(config.key||''))return;
        const now=clock(), minutes=Math.max(3,Math.min(120,Number(config.minutes)||10));
        const incidents={'login-required':'播放器授权或登录已失效，请在对应容器检查登录',
            'identity-entry-failed':'无法确认学院账号，请在对应容器检查登录',
            'account-context-changed':'账号会话发生变化，请核对对应容器',
            'player-open-failed':'播放器未能启动，请检查对应账号',
            'completed-close-failed':'已完成课程的播放器未确认关闭，请检查',
            'completion-unverified':'课程完成状态无法确认，请检查',
            'player-lesson-mismatch':'播放器课程与当前任务不一致，请核对',
            'maintenance-login':'系统开放后登录已失效，请在对应容器重新登录'};
        const incident=incidents[state.phase] && !state.userPaused && (!state.maintenance || state.phase==='maintenance-login')
            && (state.status==='paused' || (state.status==='stopped' && state.phase==='account-context-changed'));
        if(incident) {
            const old=api.GM_getValue(incidentKey,null);
            if(old?.phase!==state.phase || old?.lesson!==(state.currentLessonKey||'')) {
                const reservation={phase:state.phase,lesson:state.currentLessonKey||'',at:now,result:'attempting'};
                api.GM_setValue(incidentKey,reservation);
                try {onIncident(state.phase);}catch(_){}
                send(config,'学院学习需要检查',`账号标识：${scope.slice(0,8)}\n${incidents[state.phase]}。\n课程：${state.currentLessonTitle||'尚未选择'}\n请查看学院页面或下载日志交给 Codex 排查。`,result=>{
                    const latest=api.GM_getValue(incidentKey,null);
                    if(latest?.at===now && latest?.phase===reservation.phase)api.GM_setValue(incidentKey,{...latest,result});
                });
            }
            return;
        }
        api.GM_deleteValue(incidentKey);
        if(state.status!=='running' || state.maintenance) {api.GM_deleteValue(ledgerKey);return;}
        const lesson=state.currentLessonKey || 'phase:'+(state.phase||'unknown');
        const previous=api.GM_getValue(ledgerKey,null), progress=Number(state.currentLessonProgress)||0;
        if(!previous || previous.lesson!==lesson || progress>previous.progress || now<previous.since) {
            api.GM_setValue(ledgerKey,{lesson,progress,since:now,sent:false});return;
        }
        if(previous.sent || now-previous.since<minutes*60000)return;
        // Reserve before sending. Unknown deliveries must not create duplicate alerts.
        const reserved={...previous,sent:true,result:'attempting',at:now};
        api.GM_setValue(ledgerKey,reserved);
        try {onIncident('progress-stalled');}catch(_){}
        const finish=result=>{const latest=api.GM_getValue(ledgerKey,null);if(latest?.at===now && latest?.lesson===reserved.lesson)api.GM_setValue(ledgerKey,{...latest,result});};
        const detail=state.currentLessonKey?`课程：${state.currentLessonTitle||'未知'}\n服务器进度：${progress}%`:'课程：未知（尚未进入课程）';
        send(config,'学院学习进度未更新',
            `账号标识：${scope.slice(0,8)}\n${detail}\n已约 ${Math.floor((now-previous.since)/60000)} 分钟无进展。\n状态：${state.phase}；请查看学院页面或下载日志交给 Codex 排查。`,finish);
    }
    return {tick,test,configure(key,minutes=10){
        if(key && !/^[A-Za-z0-9_-]+$/.test(key))throw new Error('Bark key 格式无效');
        if(key)api.GM_setValue(configKey,{key,minutes:Math.max(3,Math.min(120,Number(minutes)||10))});
        else api.GM_deleteValue(configKey);
    }};
}
module.exports={createProgressNotifier};
