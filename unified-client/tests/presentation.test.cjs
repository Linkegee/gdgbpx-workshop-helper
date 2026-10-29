'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {present}=require('../presentation.cjs');
test('showing a background account makes exactly that view visible and topmost without navigation',()=>{
 const views=[1,2,3].map(id=>({webContents:{id},setBounds(v){this.bounds=v;},setVisible(v){this.visible=v;}})),pages=new Map(views.map(v=>[v.webContents.id,{view:v}]));
 const win={getContentBounds:()=>({width:1200,height:800}),contentView:{children:[...views],addChildView(v){this.children=this.children.filter(x=>x!==v).concat(v);}}};
 for(const active of [1,2,3,1,2,1]){present({win,pages,active});assert.equal(win.contentView.children.at(-1).webContents.id,active);assert.deepEqual(views.filter(v=>v.visible).map(v=>v.webContents.id),[active]);assert.equal(win.contentView.children.length,3);assert.deepEqual(pages.get(active).view.bounds,{x:300,y:68,width:900,height:732});}
});
