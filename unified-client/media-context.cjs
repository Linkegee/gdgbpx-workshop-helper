'use strict';
// Use ordinary same-origin DOM access from the isolated top-level preload.
// Do not enable Node in subframes or expose an IPC bridge to page JavaScript.
function findClientVideo(root=document,depth=0){
  if(!root||depth>8)return null;
  const video=root.querySelector('video');if(video)return video;
  for(const frame of root.querySelectorAll('iframe')){
    try{const child=frame.contentDocument;if(child){const found=findClientVideo(child,depth+1);if(found)return found;}}catch{}
  }
  return null;
}
function clientPlayerDocument(){return findClientVideo()?.ownerDocument||document;}
module.exports={findClientVideo,clientPlayerDocument};
