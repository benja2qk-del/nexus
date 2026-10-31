'use strict';
const {parse,screenReceipt,transcriptReceipt}=require('./public/slash-core');
const {inputMenu,inputBusy,inputReady}=require('./public/conversation');
function begin(t,text,id,entry,screen) {
  t.commandReceipts ||= [];
  const submittedAt=Date.now();
  for(const previous of t.commandReceipts){
    if(!previous.supersededAt)previous.supersededAt=submittedAt;
    if(['submitted','uncertain'].includes(previous.status))previous.status='uncertain';
  }
  const receipt={id,text,name:parse(text).name,kind:entry?.kind||'args',status:'submitted',submittedAt,before:screen,revision:t.outputRevision||0};
  t.commandReceipts.push(receipt);if(t.commandReceipts.length>100)t.commandReceipts.shift();
  return receipt;
}
function update(t,screen,events=[]) {
  const settled=!t.display.synchronized&&!t.display.pending&&Date.now()-t.lastOut>=600;
  const menu=inputMenu(screen),ready=inputReady(screen,{seenInput:t.kind==='copilot'?false:t.seenInput}),busy=inputBusy(screen);
  for(const receipt of t.commandReceipts||[]){
    const transcript=transcriptReceipt(receipt,events);
    if(transcript?.output){receipt.output=transcript.output;receipt.evidence='transcript';}
    if(receipt.status==='menu'){
      if(settled&&!menu&&ready||t.exited){receipt.status='closed';receipt.closedAt=Date.now();}
      continue;
    }
    if(receipt.status==='rejected'||receipt.status==='closed')continue;
    // A later command's screen cannot establish what this earlier command did.
    // A delayed transcript can still provide evidence within the attempt's bounds.
    if(receipt.supersededAt){if(transcript)Object.assign(receipt,transcript);continue;}
    const commandMenu=menu||receipt.kind==='menu'&&!ready&&!busy;
    if(settled&&commandMenu&&receipt===t.commandReceipts.at(-1)&&!receipt.terminalDone&&(t.outputRevision||0)>receipt.revision){receipt.status='menu';receipt.evidence='terminal';continue;}
    if(transcript?.output){Object.assign(receipt,transcript);receipt.terminalDone=settled&&ready;continue;}
    if(receipt.status==='acknowledged'&&receipt.output)continue;
    const evidence=screenReceipt(receipt,{screen,ready,menu,busy,exited:t.exited,settled,changed:(t.outputRevision||0)>receipt.revision});
    if(evidence){Object.assign(receipt,evidence);receipt.terminalDone=evidence.status==='acknowledged';}
    else if(transcript){Object.assign(receipt,transcript);receipt.terminalDone=settled&&ready;}
    else if(t.exited||Date.now()-receipt.submittedAt>45000)receipt.status='uncertain';
  }
  return (t.commandReceipts||[]).map(({before,revision,terminalDone,...publicReceipt})=>publicReceipt);
}
module.exports={begin,update};
