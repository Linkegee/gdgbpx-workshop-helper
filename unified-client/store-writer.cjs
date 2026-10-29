'use strict';
function createStoreWriter({write,setTimeout,clearTimeout,onError=()=>{}}){
  const dirty=new Set();let timer=null,disposed=false;
  function flush(){if(timer!==null)clearTimeout(timer);timer=null;for(const id of [...dirty]){try{write(id);dirty.delete(id);}catch(error){try{onError(error);}catch{}}}if(dirty.size&&!disposed)timer=setTimeout(flush,10000);}
  return {schedule(id){if(disposed)return;dirty.add(id);if(timer===null)timer=setTimeout(flush,1000);},flush,dispose(){disposed=true;flush();}};
}
module.exports={createStoreWriter};
