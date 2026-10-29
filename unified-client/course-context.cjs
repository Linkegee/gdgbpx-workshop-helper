'use strict';
// Serialized by contextBridge and executed in the page world. Return only plain
// course fields; never return Vue objects, functions, cookies, or storage.
function readCourseContextInPage({frameIndex=-1,title=''}) {
  try{
    let root=document;
    if(frameIndex!==-1){
      if(!Number.isInteger(frameIndex)||frameIndex<0)return null;
      root=document.querySelectorAll('iframe')[frameIndex]?.contentDocument;
      if(!root||root.location.origin!==document.location.origin)return null;
    }
    const normalize=value=>String(value||'').replace(/\s+/g,' ').trim();
    const elements=Array.from(root.querySelectorAll('.item_title'));
    let node=title?elements.find(el=>normalize(el.textContent)===normalize(title)):elements[0];
    let depth=0;while(node&&!node.__vue__&&depth++<100)node=node.parentElement;
    let vm=node?.__vue__;depth=0;while(vm&&!vm.info?.playDomain&&depth++<100)vm=vm.$parent;
    if(!vm)return null;
    const auth=typeof vm.$$Request?.course_auth==='string'?vm.$$Request.course_auth:'';
    const playDomain=typeof vm.info?.playDomain==='string'?vm.info.playDomain:'';
    if(!auth||auth.length>16000||playDomain.length>2048)return null;
    const lists=[vm.listNav?.requiredCourseList?.listInfo,vm.listNav?.optionalCourseList?.listInfo,vm.info?.requiredCourseList,vm.info?.optionalCourseList].filter(Array.isArray);
    const course=title?lists.flat().find(item=>normalize(item?.courseName)===normalize(title)):null;
    return {auth,playDomain,resourceCode:String(course?.resourceCode||'').slice(0,300),databaseCourseId:String(course?.courseId||'').slice(0,300)};
  }catch{return null;}
}
module.exports={readCourseContextInPage};
