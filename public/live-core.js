// Pure live-call rules shared by the browser, server and tests.
(function(root) {
  'use strict';
  function vad({silenceMs=650, threshold=.014, onsetMs=80, minSpeechMs=160}={}) {
    silenceMs=Math.max(400,Math.min(2000,Number(silenceMs)||650));
    let last=0, loud=0, onset=0, started=false, previous=null;
    return {push(rms,now){
      const dt=previous===null?20:Math.max(0,Math.min(50,now-previous));previous=now;
      let start=false,end=false;
      if(rms>=threshold){last=now;loud+=dt;onset+=dt;if(!started&&onset>=onsetMs){started=true;start=true;}}
      else onset=0;
      if(started&&loud>=minSpeechMs&&now-last>=silenceMs){end=true;started=false;loud=0;onset=0;}
      return {start,end,active:started,silenceMs:end?now-last:0,speechEnd:last};
    },reset(){last=0;loud=0;onset=0;started=false;previous=null;},get active(){return started;}};
  }
  function updateGate(clock=Date.now,interval=12000) {
    let at=-Infinity,last='';
    return {take(key,{owner=false,speaking=false,busy=false}={}){if(!key||key===last||owner||speaking||busy||clock()-at<interval)return false;last=key;at=clock();return true;}};
  }
  function barge() {
    let epoch=0,owner=false,speaking=false;
    return {startSpeech(){if(owner)return null;speaking=true;return epoch;},ownerStart(){owner=true;speaking=false;return ++epoch;},ownerEnd(){owner=false;},stop(){speaking=false;return ++epoch;},valid(t){return t===epoch&&!owner;},get owner(){return owner;},get speaking(){return speaking;},speechEnd(){speaking=false;}};
  }
  function selectVoice(voices,lang){return voices.filter(v=>v.lang.toLowerCase().startsWith(lang)).sort((a,b)=>score(b)-score(a))[0]||null;
    function score(v){return (/Siri|Paulina|Monica|Moni[cq]a|premium|enhanced/i.test(v.name)?8:0)+(/es-(CL|MX|419)|en-US/i.test(v.lang)?4:0)+(v.localService?1:0);}}
  const api={vad,updateGate,barge,selectVoice};
  if(typeof module==='object')module.exports=api;else root.NexusLiveCore=api;
})(typeof window==='object'?window:globalThis);
