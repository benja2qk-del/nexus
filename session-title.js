'use strict';
const fs = require('fs');
function appendRecord(file,record,codex=false){
  const fd=fs.openSync(file,fs.constants.O_RDWR|fs.constants.O_APPEND|(codex?fs.constants.O_CREAT:0));
  try{
    const stat=fs.fstatSync(fd);if(!stat.isFile())throw Error('Conversation file is unavailable.');
    let prefix='';
    if(stat.size){
      const tail=Buffer.alloc(Math.min(stat.size,16384));fs.readSync(fd,tail,0,tail.length,stat.size-tail.length);
      if(tail.at(-1)!==10){
        if(!codex)throw Error('The conversation is being written. Try renaming again in a moment.');
        try{JSON.parse(tail.toString('utf8').split('\n').at(-1));prefix='\n';}catch{throw Error('The session index is being written. Try renaming again in a moment.');}
      }
    }
    fs.writeSync(fd,prefix+JSON.stringify(record)+'\n');
  }finally{fs.closeSync(fd);}
}
// Claude Code /rename records verified read-only in installed CLI transcripts.
function rename(session, title, codexIndex) {
  if (!session || !['claude','astra'].includes(session.kind)) throw Error('Unknown conversation.');
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 200 || /[\x00-\x1f\x7f]/.test(title)) throw Error('Use a name of 1 to 200 characters on one line.');
  const customTitle = title.trim();
  if(session.kind==='astra'){
    if(!codexIndex)throw Error('Codex session index is unavailable.');
    appendRecord(codexIndex,{id:session.id,thread_name:customTitle,updated_at:new Date().toISOString()},true);
    return {title:customTitle};
  }
  // Open an existing discovered file only; never create a file from a supplied ID.
  appendRecord(session.file,{type:'custom-title',customTitle,sessionId:session.id});
  return { title: customTitle };
}
module.exports = {rename};
