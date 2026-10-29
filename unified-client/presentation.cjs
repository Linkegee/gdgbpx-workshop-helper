'use strict';
function present({win,pages,active}){
 const {width,height}=win.getContentBounds();
 for(const p of pages.values()){
  p.view.setBounds({x:300,y:68,width:Math.max(1,width-300),height:Math.max(1,height-68)});
  p.view.setVisible(p.view.webContents.id===active);
 }
 const selected=pages.get(active);
 // Electron's documented addChildView(existing) reorders without detaching.
 // Detaching/re-attaching a live view can itself leave its compositor hidden.
 if(selected&&win.contentView.children.at(-1)!==selected.view)win.contentView.addChildView(selected.view);
}
module.exports={present};
