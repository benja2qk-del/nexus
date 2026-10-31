'use strict';
const {risk}=require('../public/slash-core');
function catalog(version, rows) {
  return {version, commands:rows.map(([name,argsHint,description,kind='instant',native='',source='built-in',model=false])=>{
    const danger=risk({name,args:''});
    return {name,argsHint,description,kind:kind==='session-ending'?kind:danger||kind,source,...(native?{native}:{}),model,
      handling:native?'NEXUS '+native+' for the bare command; arguments go to the terminal':kind==='menu'?'Terminal drawer; returns to Chat when the menu closes':'Terminal; command receipt in Chat',
      ...(danger?{confirmation:true}: {})};
  })};
}
module.exports=catalog;
