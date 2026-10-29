'use strict';
const fs=require('node:fs'),path=require('node:path');
const base=__dirname;
fs.mkdirSync(path.join(base,'generated'),{recursive:true});
const adapter=fs.readFileSync(path.join(base,'page-preload.cjs'),'utf8');
let helper=fs.readFileSync(path.join(base,'..','gdgbpx-workshop-helper.user.js'),'utf8');
const authMarker='function readCourseAuth(rootDocument) {',playerMarker='function resolveCoursePlayerUrl(title) {';
for(const marker of [authMarker,playerMarker])if(helper.split(marker).length!==2)throw new Error('Helper adapter seam changed: '+marker);
helper=helper.replace(authMarker,authMarker+'\n        return String(clientReadCourseContext(rootDocument)?.auth || "");\n');
helper=helper.replace(playerMarker,playerMarker+`\n        const context=clientReadCourseContext(document,title);
        if(!context?.auth || !context.playDomain || !context.resourceCode)return null;
        const clientUrl=new URL(context.playDomain);
        if(clientUrl.protocol!=='https:' || !['cs1.gdgbpx.com','wcs1.shawcoder.xyz'].includes(clientUrl.hostname))return null;
        clientUrl.searchParams.set('t',context.auth);clientUrl.searchParams.set('courseId',context.resourceCode);clientUrl.searchParams.set('courseLabel','wlxy');
        return {url:clientUrl.href,resourceCode:context.resourceCode,databaseCourseId:context.databaseCourseId,playDomain:clientUrl.origin+clientUrl.pathname};\n`);
const reader=fs.readFileSync(path.join(base,'course-context.cjs'),'utf8').replace('module.exports={readCourseContextInPage};','');
const media=fs.readFileSync(path.join(base,'media-context.cjs'),'utf8').replace('module.exports={findClientVideo,clientPlayerDocument};','');
for(const marker of ['function getAvailableUpdate() {','function checkForScriptUpdate(force = false) {'])if(helper.split(marker).length!==2)throw new Error('Client version adapter seam changed');
helper=helper.replace('function getAvailableUpdate() {','function getAvailableUpdate() {\n        return null;\n');
helper=helper.replace('function checkForScriptUpdate(force = false) {',`function checkForScriptUpdate(force = false) {
        updateCheckMessage='助手 '+VERSION+' 随客户端更新；此处不执行篡改猴安装';
        if(force)renderPanel(getState());
        return;\n`);
if(helper.split("document.querySelector('video')").length!==4)throw new Error('Video adapter seam changed');
helper=helper.replaceAll("document.querySelector('video')",'findClientVideo()');
for(const marker of ['function detectVisiblePlayerLessonTitle(state = getState()) {','function hasBlockingQuestion() {','function dismissKnownContinuePrompt() {','function playerTick() {']){
  if(helper.split(marker).length!==2)throw new Error('Player document seam changed');
  helper=helper.replace(marker,marker+'\n        const document=clientPlayerDocument();\n');
}
// The helper runs inside the sandboxed, isolated preload world. No IPC bridge
// or Node object is exposed to the remote page's JavaScript world.
fs.writeFileSync(path.join(base,'generated','page.cjs'),adapter+'\n'+reader+'\n'+media+'\n'+helper+'\n}\n');
console.log('Bundled helper '+helper.match(/@version\s+(\S+)/)[1]);
