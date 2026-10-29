'use strict';
function recoveryDecision(request,state,budget={},now=Date.now()){
 if(!request||!/^[a-f0-9-]{36}$/.test(request.id||'')||!Number.isFinite(request.at)||now-request.at<0||now-request.at>60000)return {allowed:false,reason:'invalid-or-expired'};
 if(!['inspect','capture-player','repaint-player','retry','reload-main','reload-player','notify'].includes(request.action))return {allowed:false,reason:'unsupported-action'};
 if(['inspect','notify','capture-player','repaint-player'].includes(request.action))return {allowed:true};
 if(!state||state.userPaused||['idle','complete','stopped'].includes(state.status))return {allowed:false,reason:'not-running-or-user-stopped'};
 if(['login-required','account-context-changed','maintenance-login','identity-entry-failed'].includes(state.phase))return {allowed:false,reason:'human-login-required'};
 if(state.status==='paused'&&!['player-open-failed','completed-close-failed','completion-unverified','player-stalled'].includes(state.phase))return {allowed:false,reason:'manual-or-unknown-pause'};
 if(state.maintenance)return {allowed:false,reason:'maintenance'};
 if(now-(budget.lastAt||0)<300000 || (budget.attempts||[]).filter(at=>now-at<3600000).length>=3)return {allowed:false,reason:'rate-limited'};
 if(request.action==='retry'&&state.status!=='paused')return {allowed:false,reason:'retry-requires-known-failure'};
 return {allowed:true};
}
module.exports={recoveryDecision};
