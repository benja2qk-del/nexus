// Model-free call rules. Browser adapters supply audio, the clock and wake locks.
(function(root) {
  'use strict';
  const transitions = {
    connecting:['listening','thinking','working','speaking','muted','paused','error','ended'],
    listening:['thinking','speaking','working','paused','muted','error','ended'],
    thinking:['listening','working','speaking','paused','muted','error','ended'],
    working:['thinking','speaking','listening','your-turn','paused','muted','error','ended'],
    speaking:['working','thinking','your-turn','listening','paused','muted','error','ended'],
    'your-turn':['listening','thinking','working','speaking','paused','muted','error','ended'],
    muted:['listening','thinking','working','speaking','your-turn','paused','error','ended'],
    paused:['connecting','listening','thinking','working','speaking','muted','error','ended'],
    error:['connecting','listening','thinking','working','speaking','paused','muted','ended'],
    ended:[]
  };
  function machine() {
    let value='connecting';
    return {get value(){return value;}, set(next){if(next===value)return value;if(next==='connecting'&&value!=='ended')return value=next;if(!transitions[value]?.includes(next))throw Error('Invalid call transition: '+value+' -> '+next);return value=next;}};
  }
  function progress(clock=Date.now, interval=20000) {
    let at=clock(), last='';
    return {take(activity,enabled=true){const text=String(activity||'').trim().replace(/\s+/g,' ');if(!enabled||!text||text===last||clock()-at<interval)return '';at=clock();last=text;return 'Still on it: '+text[0].toLowerCase()+text.slice(1);}};
  }
  function formatTime(seconds) {const n=Math.max(0,Math.floor(seconds));return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
  // An in-flight request is invalidated on release, even if permission resolves later.
  function wakeLock(provider, visible=()=>true) {
    let desired=false, sentinel=null, pending=null, epoch=0;
    async function acquire(){
      if(!desired||!visible()||sentinel||pending||!provider?.request)return;
      const ticket=epoch;
      const job=Promise.resolve().then(async()=>{try{const lock=await provider.request('screen');if(ticket!==epoch||!desired||!visible()){await lock.release();return;}sentinel=lock;lock.addEventListener('release',()=>{if(sentinel===lock)sentinel=null;},{once:true});}catch{}finally{if(pending===job)pending=null;}});
      pending=job;await job;
    }
    async function release(){epoch++;const lock=sentinel;sentinel=null;pending=null;try{await lock?.release();}catch{}}
    return {async start(){desired=true;await acquire();},async visibility(){if(visible())await acquire();else await release();},async stop(){desired=false;await release();},get held(){return !!sentinel;}};
  }
  const api={machine,progress,formatTime,wakeLock};
  if(typeof module==='object')module.exports=api;else root.NexusCallCore=api;
})(typeof window==='object'?window:globalThis);
