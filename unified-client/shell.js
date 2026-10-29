'use strict';
const root=document.getElementById('accounts'),cards=new Map();
function element(tag,cls,text=''){const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;}
function button(text,op,id,cls=''){const b=element('button',cls,text);b.type='button';b.onclick=()=>window.client.command(op,id);return b;}
const group=element('div','group-controls'),groupStatus=element('p','group-status'),rescueStatus=element('p','rescue-status');
groupStatus.setAttribute('role','status');rescueStatus.setAttribute('role','status');
group.append(element('strong','','群控'),button('全部开始 / 继续','batch','start'),button('全部暂停','batch','pause'),button('全部停止','batch','stop','danger'),groupStatus,rescueStatus);
for(const [index,action]of ['start','pause','stop'].entries())group.querySelectorAll('button')[index].id='batch-'+action;
document.querySelector('.account-toolbar').before(group);
let rescueEnabled=true;
const rescueToggle=element('button','','关闭异常接管');rescueToggle.type='button';rescueToggle.onclick=()=>window.client.command('rescue-enabled',!rescueEnabled);group.append(rescueToggle);
const resultLabels={'dispatched-needs-verification':'已下发，等待状态核验','already-running':'已在运行','already-stopped':'已停止','already-paused':'已暂停','already-complete':'专题已完成','login-required':'需重新登录','helper-unavailable':'助手未就绪','delivery-unknown':'未收到回执，请检查','account-unavailable':'页面未打开','dispatch-failed':'发送失败','cancelled-by-new-command':'已由新命令取消'};
document.getElementById('add').onclick=()=>window.client.command('add');
let collapseAllNext=false;
document.getElementById('toggle-all').onclick=()=>window.client.command('collapse-all',collapseAllNext);
document.getElementById('reminders').onclick=()=>document.getElementById('bark').showModal();
document.getElementById('bark-cancel').onclick=()=>document.getElementById('bark').close();
document.getElementById('bark-disable').onclick=async()=>{await window.client.command('bark',null);document.getElementById('bark').close();};
document.getElementById('bark-form').onsubmit=async event=>{event.preventDefault();try{await window.client.command('bark',{key:document.getElementById('bark-key').value,minutes:document.getElementById('bark-minutes').value});document.getElementById('bark-key').value='';document.getElementById('bark').close();}catch{document.getElementById('bark-status').textContent='保存失败，请检查 key 和系统加密是否可用';}};
function createCard(id){
 const section=element('section','account');section.dataset.accountId=id;
 const header=element('div','account-header'),title=element('h3','account-name'),badge=element('span','badge'),toggle=element('button','disclosure');
 toggle.type='button';toggle.setAttribute('aria-controls','account-detail-'+id);
 const details=element('div','account-details');details.id='account-detail-'+id;
 toggle.onclick=()=>window.client.command('collapse',{accountId:id,collapsed:!details.hidden});
 header.append(title,badge,toggle);
 const course=element('p','course-summary'),progressRow=element('div','progress-row'),progress=element('progress','course-progress'),progressText=element('span','progress-text');progress.max=100;progressRow.append(progress,progressText);
 const issue=element('p','issue');issue.setAttribute('role','status');
 const actions=element('div','account-actions'),play=button('▶ 查看播放','player',id),home=button('专题 / 首页','home',id);actions.append(play,home,button('重绘画面','repaint',id));
 const renameLabel=element('label','rename-label','账号备注'),rename=element('input','account-rename');rename.setAttribute('aria-label','账号备注');rename.maxLength=40;rename.onchange=()=>window.client.command('rename',{accountId:id,name:rename.value});renameLabel.append(rename);
 const individual=element('div','account-actions');for(const [text,action]of [['开始 / 继续','start'],['暂停','pause'],['停止','stop']])individual.append(button(text,'account-action',{accountId:id,action}));
 const commandResult=element('p','command-result');commandResult.setAttribute('role','status');
 const stateText=element('p','status'),learning=element('div','learning-details'),tabs=element('div','account-tabs');details.append(individual,learning,renameLabel,stateText,tabs);
 section.append(header,course,progressRow,issue,actions,commandResult,details);root.append(section);
 return {section,title,badge,toggle,details,course,progress,progressText,issue,play,rename,stateText,learning,tabs,commandResult,tabSignature:''};
}
function updateCard(card,a,state){
 card.title.textContent=a.name;card.title.title=a.name;
 card.details.hidden=a.collapsed;card.toggle.textContent=a.collapsed?'展开 ▾':'收纳 ▴';card.toggle.setAttribute('aria-expanded',String(!a.collapsed));card.toggle.setAttribute('aria-label',(a.collapsed?'展开':'收纳')+a.name+'详细信息');
 const current=a.states.filter(s=>s.status==='running').sort((a,b)=>(b.media?.at||0)-(a.media?.at||0))[0]||a.states[0];
 const visualFailure=a.tabs.find(t=>t.visualHealth?.phase==='needs-help');
 const problem=a.tabs.find(t=>t.issue)?.issue||(visualFailure?'画面自动重绘未恢复，已交给异常接管':null)||a.states.find(s=>['account-context-changed','login-required','player-open-failed','completed-close-failed','identity-entry-failed','player-lesson-mismatch'].includes(s.phase))?.message||'';
 const ended=current?.media?.duration>0&&current.media.currentTime>=current.media.duration-1&&current.media.paused===true;
 const mediaLabel=ended?'结束待核验':current?.media?.at&&Date.now()-current.media.at>120000?'心跳过期':current?.media?.paused===true?'媒体暂停':'运行中';
 const label=problem?'需处理':current?.status==='running'?mediaLabel:({paused:'已暂停',stopped:'已停止',complete:'已完成'}[current?.status]||'未启动');
 card.badge.textContent=label;card.badge.className='badge '+(problem?'attention':current?.status==='running'?'running':'neutral');
 card.section.classList.toggle('needs-attention',Boolean(problem));
 card.course.textContent=current?.lesson||'尚未选择课程';card.course.title=card.course.textContent;
 const value=Number(current?.progress),known=current?.progress!=null&&Number.isFinite(value);
 card.progress.hidden=!known;card.progress.value=known?Math.max(0,Math.min(100,value)):0;
 card.progress.setAttribute('aria-label',a.name+'服务器课程进度');card.progressText.textContent=known?'服务器 '+Number(value.toFixed(2))+'%':'进度未读取';
 card.issue.textContent=problem;card.issue.hidden=!problem;
 card.commandResult.hidden=!a.operatorResult;card.commandResult.textContent=a.operatorResult?(resultLabels[a.operatorResult.result]||a.operatorResult.result):'';
 card.play.hidden=!a.tabs.some(t=>t.kind==='播放器');
 if(document.activeElement!==card.rename)card.rename.value=a.name;
 card.stateText.textContent=a.states.map(s=>s.message).filter(Boolean).join(' · ')||'从专题助手点击开始';
 const info=a.learning,topic=info?.workshops?.[current?.classId||info?.currentClassId];
 const lines=[['首页显示学时',info?.home?info.home.hours+'（'+new Date(info.home.at).toLocaleString('zh-CN')+'）':'未读取，进入首页后更新'],['当前专题',current?.workshop||topic?.title||'未读取'],['必修完成',topic?topic.completed+' / '+topic.total+' 门':'未读取'],['完成课程标注学时',topic?.completedHours!=null?topic.completedHours+' / '+topic.totalHours+'（非年度累计）':'课程学时未读取'],['已完成专题',String(current?.finishedWorkshops?.length||0)]];
 const learningSignature=JSON.stringify([lines,info?.workshops]);
 if(card.learningSignature!==learningSignature){card.learningSignature=learningSignature;card.learning.replaceChildren(element('h4','','学习情况'));for(const [name,value]of lines){const row=element('p','learning-row');row.append(element('span','learning-label',name),element('span','learning-value',value));card.learning.append(row);}if(topic)card.learning.append(element('p','learning-updated','最近核验：'+new Date(topic.at).toLocaleTimeString('zh-CN')+' · '+(topic.allCompleted?'服务器显示全部完成':topic.verificationComplete?'仍有未完成课程':'课程列表未完整核验')));for(const t of Object.values(info?.workshops||{})){card.learning.append(element('p','topic-row',t.title+' · '+t.completed+'/'+t.total+'门'+(t.allCompleted?' · 已完成':'')));}}
 const signature=JSON.stringify(a.tabs.map(t=>[t.id,t.title,t.kind,t.issue,t.id===state.active]));
 if(signature!==card.tabSignature){card.tabSignature=signature;card.tabs.replaceChildren();for(const t of a.tabs){const row=element('div','page-row');row.append(button(t.kind+' · '+t.title,'show',t.id,'tab'+(t.id===state.active?' active':'')));const controls=element('div','page-actions');controls.append(button('重新加载','reload',t.id),button('助手菜单','menu',t.id),button('关闭','close',t.id,'danger'));row.append(controls);card.tabs.append(row);}}
}
window.client.onState(state=>{
 collapseAllNext=state.accounts.some(a=>!a.collapsed);
 const toggleAll=document.getElementById('toggle-all');toggleAll.textContent=collapseAllNext?'全部收纳':'全部展开';toggleAll.setAttribute('aria-expanded',String(collapseAllNext));toggleAll.disabled=!state.accounts.length;
 const batch=state.batch;
 groupStatus.textContent=batch?({start:'开始 / 继续',pause:'暂停',stop:'停止'}[batch.action])+'：'+batch.results.length+'/'+batch.total+' 已返回'+(batch.running?' · 发送中':' · 已结束，请核对账号状态'): '开始会错峰发送；停止会取消待发送的开始命令。';
 const rescue=state.rescue;
 rescueEnabled=rescue?.status!=='disabled';rescueToggle.textContent=rescueEnabled?'关闭异常接管':'开启异常接管';
 rescueStatus.textContent=rescue&&Date.now()-rescue.at<45000?'本地异常接管：'+({watching:'监听中，异常时触发 Codex',handling:'Codex 正在分析异常',verifying:'正在核验恢复',failed:'接管失败，需检查',disabled:'已关闭'}[rescue.status]||rescue.status):'本地异常接管：等待监听器心跳';
 document.getElementById('reminders').textContent=state.barkEnabled?'Bark 已配置':'Bark 未配置';
 const live=new Set(state.accounts.map(a=>a.id));for(const [id,card]of cards)if(!live.has(id)){card.section.remove();cards.delete(id);}
 for(const a of state.accounts){if(!cards.has(a.id))cards.set(a.id,createCard(a.id));updateCard(cards.get(a.id),a,state);}
 const running=state.accounts.filter(a=>a.states.some(s=>s.status==='running')).length;
 const playing=state.accounts.filter(a=>a.states.some(s=>s.status==='running'&&s.media?.paused===false&&Date.now()-s.media.at<20000)).length;
 document.getElementById('account-count').textContent=state.accounts.length+' 个账号 · '+running+' 任务 / '+playing+' 播放';
});
window.client.command('state');
