'use strict';
// Durable intent, with a write-ahead marker before any PTY input. A restart
// never retries an ambiguous delivery. The terminal adapter owns all I/O.
const {randomUUID}=require('crypto');
const slash=require('./slash-commands');
const copy=value=>JSON.parse(JSON.stringify(value));
const inputUp=t=>!!t&&(t.input??t.ready);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class MessageQueue {
  constructor({load=()=>({}),save,inspect,send,now=Date.now}) {
    this.data=copy(load());this.save=save;this.inspect=inspect;this.send=send;this.now=now;this.locks=new Map();
    for(const q of Object.values(this.data)) {
      if(q.active){q.hold='Delivery interrupted by a NEXUS restart. Check the conversation before retrying.';q.active.status='failed';q.items.unshift(q.active);q.active=null;}
      for(const item of q.items||[])if(['sending','confirm','control'].includes(item.status))item.status='queued';
      for(const item of q.items||[])if(item.status==='opening'){item.status='failed';item.error='NEXUS restarted while opening a control. Check its result before retrying.';q.hold=item.error;}
    }
  }
  serial(key,work) {const task=(this.locks.get(key)||Promise.resolve()).catch(()=>{}).then(work);this.locks.set(key,task);return task.finally(()=>{if(this.locks.get(key)===task)this.locks.delete(key);});}
  queue(key) {if(typeof key!=='string'||!/^(claude|astra|copilot|term):[\w.-]+$/.test(key))throw Error('Unknown session.');return this.data[key]||= {items:[],history:[],active:null,hold:''};}
  async persist(){await this.save(copy(this.data));}
  reason(q,s) {
    if(q.hold)return q.hold;
    if(!s?.terminal||s.terminal.exited)return q.items.length?'Terminal closed. Open this session in NEXUS to continue.':'Open this session in NEXUS to queue messages';
    if(s.terminal.prompt)return 'Waiting for your answer or permission.';
    if(s.terminal.menu)return 'Waiting for you to close the terminal menu.';
    if(q.active)return 'Waiting for the current delivery and turn to finish.';
    if(s.terminal.busy||s.streaming)return 'Agent is working. Messages will send when it finishes.';
    if(!inputUp(s.terminal))return 'Waiting for the session\'s message box. If the session looks finished, check Raw terminal.';
    if(q.items[0]?.status==='confirm')return 'Confirm the destructive command before sending.';
    if(q.items[0]?.status==='control')return 'Open the NEXUS control to continue.';
    if(q.items[0]?.status==='opening')return 'A NEXUS control is opening. Check its result before retrying.';
    return '';
  }
  view(key) {const q=this.queue(key),s=this.inspect(key);return copy({...q,reason:this.reason(q,s),hosted:!!s?.terminal&&!s.terminal.exited});}
  validate(text){if(typeof text!=='string'||!text.trim()||text.length>90000||/[\x00-\x08\x0b-\x1f\x7f]/.test(text.replace(/\r\n/g,'\n')))throw Error('Enter a message without terminal control characters.');}
  async add(key,{id=randomUUID(),text}) {return this.serial(key,async()=>{
    this.validate(text);if(!/^[a-zA-Z0-9-]{1,80}$/.test(id))throw Error('Invalid message ID.');
    const q=this.queue(key),old=[...q.items,...q.history,q.active].filter(Boolean).find(i=>i.id===id);
    if(old){if(old.text!==text)throw Error('Message ID already used.');return this.view(key);}
    const s=this.inspect(key);if(!s?.terminal||s.terminal.exited)throw Error('Open this session in NEXUS to queue messages');
    if(q.items.length>=100)throw Error('Queue is full (100 messages).');
    const item={id,text,at:this.now(),status:'queued'};q.items.push(item);
    try{await this.persist();}catch(error){q.items=q.items.filter(i=>i!==item);throw error;}return this.view(key);
  });}
  async submit(key,{id=randomUUID(),text,commandConfirmation}){
    await this.add(key,{id,text});
    return this.serial(key,async()=>{
      await this.pump(key,{confirmedId:commandConfirmation===text?id:undefined});
      const queue=this.view(key),active=queue.active?.id===id?queue.active:null;
      return {serverQueue:true,queued:!active,queue,...(active?{submittedAt:active.submittedAt,command:active.command}: {})};
    });
  }
  async rekey(from,to){
    if(from===to||!this.data[from])return;
    return this.serial(from,()=>this.serial(to,async()=>{
      const source=this.data[from];if(!source)return;
      if(!this.data[to])this.data[to]=source;
      else {const target=this.data[to],ids=new Set([...target.items,...target.history,target.active].filter(Boolean).map(i=>i.id));target.items.push(...source.items.filter(i=>!ids.has(i.id)));target.history.push(...source.history.filter(i=>!ids.has(i.id)));if(source.active){if(target.active){target.items.unshift({...source.active,status:'failed'});target.hold='Check the earlier delivery before resuming.';}else target.active=source.active;}}
      delete this.data[from];await this.persist();
    }));
  }
  async change(key,action,{id,text,index,confirmed,expectedText,controlToken,error}={}) {return this.serial(key,async()=>{
    const q=this.queue(key),i=q.items.findIndex(x=>x.id===id),item=q.items[i];
    if(action==='resume'){if(q.items.some(x=>x.status==='failed'))throw Error('Remove or explicitly retry the failed delivery first.');q.hold='';await this.persist();return this.view(key);}
    if(!item)throw Error('Queued message changed. Refresh before trying again.');
    if(item.status==='opening'&&!['control-done','control-failed','remove','retry'].includes(action))throw Error('This control is already opening. Check its result before changing it.');
    if(action==='edit'){this.validate(text);item.text=text;item.status='queued';delete item.error;}
    else if(action==='move'){if(!Number.isInteger(index)||index<0||index>=q.items.length)throw Error('Invalid queue position.');q.items.splice(i,1);q.items.splice(index,0,item);for(const m of q.items)if(['confirm','control'].includes(m.status))m.status='queued';}
    else if(action==='remove'||action==='cancel'){
      q.items.splice(i,1);
      if(item.status==='failed'&&q.hold===item.error&&!q.items.some(x=>x.status==='failed'))q.hold='';
      if(slash.core.parse(item.text))q.history.push({...item,status:item.status==='opening'?'uncertain':'cancelled',summary:item.status==='opening'?'control result unconfirmed; check the session':'nothing changed',finishedAt:this.now()});
    } else if(action==='retry') {if(confirmed!==true||expectedText!==item.text)throw Error('Confirm retry after checking the conversation.');item.status='queued';delete item.error;q.hold='';}
    else if(action==='control-claim') {
      const s=this.inspect(key);if(item.status!=='control'||i!==0||q.active||!inputUp(s?.terminal)||s.terminal.busy||s.terminal.prompt||s.terminal.menu)throw Error('Control is no longer ready.');
      item.status='opening';item.controlToken=randomUUID();
    }
    else if(action==='control-done'||action==='control-failed') {
      if(item.status!=='opening'||controlToken!==item.controlToken)throw Error('Control is no longer waiting.');
      if(action==='control-done'){q.items.splice(i,1);q.history.push({...item,status:'opened',finishedAt:this.now()});q.hold='Queue paused for the NEXUS control. Resume when you are ready.';}
      else {item.status='failed';item.error=String(error||'Control did not open. Check before retrying.').slice(0,500);q.hold=item.error;}
    }
    else if(action==='push') {
      const s=this.inspect(key);if(!s?.terminal||s.terminal.exited)throw Error('Open this session in NEXUS to send it.');
      if(s.terminal.prompt||s.terminal.menu)throw Error('Answer the question or close the terminal menu first.');
      if(slash.core.parse(item.text))throw Error('Slash commands wait until the session is ready.');
      q.items.splice(i,1);
      try{const result=await this.send(s.terminal.id,item.text,{commandId:item.id,midTurn:true});q.history.push({...item,status:'pushed',submittedAt:result.submittedAt||this.now(),finishedAt:this.now()});}
      catch(error){q.items.splice(i,0,item);throw error;}
    }
    else if(action==='confirm'||action==='send-now') {
      if(confirmed!==true||expectedText!==item.text)throw Error('Confirm '+(action==='send-now'?'interrupting the current turn':'this command')+' before sending.');
      let s=this.inspect(key);if(!s?.terminal||s.terminal.exited)throw Error('Terminal closed.');
      if(s.terminal.prompt||s.terminal.menu)throw Error('Answer the question or close the terminal menu first.');
      if(action==='send-now') {
        // Persist the interrupted prior delivery; never lose it or resend it.
        if(q.active){q.history.push({...q.active,status:'interrupted',finishedAt:this.now()});q.active=null;}
        q.hold='Interrupt requested. Check the terminal if it does not become ready.';await this.persist();
        await this.send(s.terminal.id,undefined,{answer:'esc'});
        const deadline=this.now()+10000;
        while(!inputUp((s=this.inspect(key))?.terminal)||s.terminal.busy||s.streaming){if(!s?.terminal||s.terminal.exited||s.terminal.prompt||s.terminal.menu||this.now()>deadline)throw Error('The session did not become ready. Queue remains paused.');await pause(100);}
        q.items.splice(i,1);q.items.unshift(item);q.hold='';
      } else if(i!==0||q.active||s.terminal.busy||s.streaming||!inputUp(s.terminal))throw Error('Wait until this command reaches the ready input.');
      await this.pump(key,{confirmedId:item.id});return this.view(key);
    } else throw Error('Unknown queue action.');
    q.history=q.history.slice(-100);await this.persist();return this.view(key);
  });}
  async pump(key,{confirmedId}={}) {
    // Every session ever opened in Chat has an entry; reading one with nothing queued is wasted work.
    const q=this.queue(key);if(!q.active&&!q.items.length)return;
    let s=this.inspect(key),t=s?.terminal;
    if(q.active){
      const a=q.active;if(t?.busy||s?.streaming)a.sawBusy=true;
      const command=t?.commands?.find(r=>r.id===a.id),event=s?.events?.find(e=>['user','cmd'].includes(e.t)&&e.text?.trim()===a.text.trim()&&Date.parse(e.ts)>=a.submittedAt);
      if(t?.exited&&command?.status==='acknowledged'){
        q.history.push({...a,status:'confirmed',received:true,command,finishedAt:this.now()});q.history=q.history.slice(-100);q.active=null;await this.persist();return;
      }
      if(command?.status==='rejected'||command?.status==='uncertain'||!t||t.exited||this.now()-a.submittedAt>45000&&!a.sawBusy&&!event&&!command?.evidence){
        a.status='failed';a.error=command?.output||'Delivery was not confirmed. Check the conversation before retrying.';q.hold=a.error;q.items.unshift(a);q.active=null;await this.persist();return;
      }
      const received=event||command&&['acknowledged','closed','menu'].includes(command.status)||a.sawBusy&&inputUp(t)&&!t.busy;
      if(received&&!a.received){a.received=true;a.evidence=event?'transcript':command?.evidence||'terminal';await this.persist();}
      if(!received||t.prompt||t.menu||t.busy||s.streaming||!inputUp(t)||this.now()-a.submittedAt<750)return;
      q.history.push({...a,status:'confirmed',...(command?{command}:{}),finishedAt:this.now()});q.history=q.history.slice(-100);q.active=null;await this.persist();
      // Each delivery completes before a subsequent scheduler tick can send.
      return;
    }
    if(q.hold||!t||t.exited||t.prompt||t.menu||t.busy||s.streaming||!inputUp(t)||!q.items.length||this.now()<(q.retryAt||0))return;
    const item=q.items[0],command=slash.core.parse(item.text),entry=slash.builtin(s.kind,item.text);
    if(item.status==='opening')return;
    if(item.status==='failed'){q.hold=item.error||'Delivery failed. Check the conversation before retrying.';await this.persist();return;}
    if(slash.core.risk(command)&&confirmedId!==item.id){if(item.status!=='confirm'){item.status='confirm';await this.persist();}return;}
    if(command&&!command.args&&(entry?.native||s.kind==='copilot'&&command.name==='plan')){if(item.status!=='control'){item.status='control';await this.persist();}return;}
    q.items.shift();q.active={...item,status:'sending',submittedAt:this.now(),sawBusy:false};
    try {
      await this.persist();
      const result=await this.send(t.id,item.text,{commandId:item.id,commandConfirmation:confirmedId===item.id?item.text:undefined,queueDelivery:true});
      Object.assign(q.active,{status:'pending',submittedAt:result.submittedAt||q.active.submittedAt,command:result.command});await this.persist();
    } catch(error) {
      // Nothing was typed: put it back and try again shortly. Only an uncertain delivery pauses the queue.
      const attempts=(q.active?.attempts||0)+1;
      if(error.notSent&&attempts<6&&q.active){q.items.unshift({...q.active,status:'queued',attempts});q.active=null;q.retryAt=this.now()+1000*attempts;await this.persist();return;}
      if(q.active){q.items.unshift({...q.active,status:'failed',error:error.message});q.active=null;}
      q.hold='Delivery failed. '+error.message;await this.persist();
    }
  }
  async tick(){await Promise.all(Object.keys(this.data).map(key=>this.serial(key,()=>this.pump(key))));}
}
module.exports={MessageQueue};
