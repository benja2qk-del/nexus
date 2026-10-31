'use strict';
// Owns continuous capture and one brain for a call; all UI changes are callbacks.
const NexusLiveCall={async open(key,hooks){
  let closed=false,id=null,capture=null,fetching=null,queue=Promise.resolve(),speech=Promise.resolve(),epoch=0,thinking=false,speaking=false,muted=false,lastOwner=0,ownerSignature=null,spokenLanguage=null,forcedLanguage=hooks.forcedLanguage||null;
  const prior=NexusVoiceCore.sessionPrior();let sessionLanguage='en';
  const controller=new AbortController(),barge=NexusLiveCore.barge(),latency={};
  function audioStarted(extra=0){if(latency.measured||!latency.speechEnd)return;latency.measured=true;latency.ttsMs=performance.now()-latency.ttsRequested+extra;latency.totalMs=performance.now()-latency.speechEnd+extra;hooks.latency({...latency});}
  const audio=NexusVoice.callAudio(key,{state(){},audioStart(){latency.voice='Device speech';audioStarted();},level:hooks.level});
  const neural=NexusNeuralAudio.create({onStart(info){if(closed)return;speaking=true;hooks.state('speaking');audioStarted(info.delayMs);},onIdle(){if(closed)return;barge.speechEnd();speaking=false;hooks.state(thinking?'thinking':'listening');}});
  const sentenceTimes=new Map();let deviceBarrier=Promise.resolve(),fallbackNotice=false;
  const post=async(route,data,signal=controller.signal)=>{const response=await fetch('/api/live/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Nexus':'1'},body:JSON.stringify({id,...data}),signal});if(!response.ok)throw Error((await response.json()).error||'Live voice disconnected.');return response;};
  function quiet(){epoch++;barge.stop();neural.cancel();sentenceTimes.clear();audio.stopSpeech();speech=Promise.resolve();deviceBarrier=Promise.resolve();speaking=false;hooks.state(thinking?'thinking':'listening');}
  function interrupt(){quiet();fetching?.abort();post('cancel',{}).catch(()=>{});}
  function say(text,ticket,lang=spokenLanguage){speech=speech.then(async()=>{if(closed||ticket!==epoch||barge.owner||!hooks.speaker())return;const stamp=barge.startSpeech();if(stamp===null)return;speaking=true;hooks.state('speaking');latency.ttsRequested=performance.now();await audio.speak(text,lang);barge.speechEnd();if(closed||ticket!==epoch)return;speaking=false;hooks.state(thinking?'thinking':'listening');}).catch(()=>{if(!closed&&ticket===epoch){barge.speechEnd();speaking=false;hooks.notice('This language voice is still loading. Your reply is in the captions.');hooks.state(thinking?'thinking':'listening');}});deviceBarrier=speech;}
  async function turn(text,event=false,recording=null,signature=null,recognition=null){
    if(closed||event&&(barge.owner||thinking||speaking||muted||Date.now()-lastOwner<2000))return;
    const ticket=epoch;thinking=true;if(!event)hooks.state('thinking');fetching=new AbortController();
    try{
      const response=await post('turn',{text,event,signature,recognition,forcedLanguage,owner:barge.owner,speaking},fetching.signal);
      if(response.headers.get('content-type')?.includes('application/json'))return;
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
      for(;;){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line)continue;const msg=JSON.parse(line);if(closed||ticket!==epoch)continue;
        if(msg.type==='caption')hooks.caption(msg.text);
        if(msg.type==='language'){spokenLanguage=msg.language;hooks.language?.(msg.language,msg.forcedLanguage);}
        if(msg.type==='sentence'){hooks.sentence?.(msg.text);sentenceTimes.set(msg.id,performance.now());if(!msg.neural)say(msg.text,ticket,msg.lang);}
        if(msg.type==='audio'&&!barge.owner&&hooks.speaker()){
          hooks.renderer?.('neural');if(fallbackNotice){fallbackNotice=false;hooks.notice('');}
          barge.startSpeech();if(!latency.measured){latency.ttsRequested=sentenceTimes.get(msg.id)||performance.now();latency.synthesisMs=msg.ttsMs;latency.voice=msg.voice;}
          // Schedule subsequent chunks while previous chunks play; track completion
          // so a device fallback cannot overlap a preceding neural sentence.
          const playback=deviceBarrier.then(()=>{if(closed||ticket!==epoch||barge.owner||!hooks.speaker())return;return neural.push(msg.audio);});speech=Promise.all([speech,playback]).catch(e=>{if(!closed&&ticket===epoch)hooks.notice('Audio could not play. Try the device voice or resume the call.');});
        }
        if(msg.type==='speech-fallback'){fallbackNotice=true;hooks.renderer?.('device');hooks.notice(msg.reason);say(msg.text,ticket,msg.lang);}
        if(msg.type==='done'){latency.brainMs=msg.brainMs;latency.ttftMs=msg.ttftMs;hooks.latency({...latency});}
        if(msg.type==='action')hooks.action?.(msg);
        if(msg.type==='error')hooks.notice(msg.message);
        if(msg.type==='unavailable'){hooks.fallback();return;}
        if(msg.type==='confirmation')hooks.notice('Confirm relay: '+msg.text);
      }}
    }catch(e){if(!closed&&e.name!=='AbortError')hooks.notice(e.message);}
    finally{thinking=false;fetching=null;if(!closed&&!speaking&&!barge.owner)hooks.state(muted?'muted':'listening');}
  }
  let heartbeat,ticker,closing;
  function close(){if(closing)return closing;closed=true;epoch++;clearInterval(heartbeat);clearInterval(ticker);controller.abort();fetching?.abort();capture?.close();neural.close();audio.close();closing=id?fetch('/api/live/stop',{method:'POST',headers:{'X-Nexus':'1','Content-Type':'application/json'},body:JSON.stringify({id}),keepalive:true}).catch(()=>{}):Promise.resolve();return closing;}
  hooks.signal?.addEventListener('abort',close,{once:true});if(hooks.signal?.aborted){await close();throw new DOMException('Cancelled','AbortError');}
  try{
    await Promise.all([audio.unlock(),neural.unlock()]);await ensureChatTerminal(key,controller.signal);
    const info=await(await post('start',{key,forcedLanguage})).json();id=info.id;spokenLanguage=info.language;sessionLanguage=info.language;hooks.ready(info);hooks.language?.(info.language,forcedLanguage);
    heartbeat=setInterval(()=>post('heartbeat',{}).catch(e=>{hooks.error(e);close();}),5000);
    capture=await NexusLiveAudio.open({silenceMs:info.silenceMs,onLevel:hooks.level,
      onStart(){lastOwner=Date.now();ownerSignature=hooks.question()?.signature??null;barge.ownerStart();interrupt();hooks.state('listening');},
      onTurn(recording){lastOwner=Date.now();barge.ownerEnd();const signature=ownerSignature,turnEpoch=epoch;for(const key of Object.keys(latency))delete latency[key];latency.measured=false;latency.speechEnd=recording.speechEnd;latency.vadMs=recording.vadMs;hooks.state('thinking');
        queue=queue.then(async()=>{if(closed||turnEpoch!==epoch)return;const result=await audio.transcribe(recording.wav,{prior:sessionLanguage,forced:forcedLanguage});if(closed||turnEpoch!==epoch)return;latency.whisperMs=result.elapsedMs;hooks.heard(result.text);if(!result.text){hooks.notice('No words heard. Please try again.');return;}spokenLanguage=NexusVoiceCore.turnLanguage(result.text,result,sessionLanguage,forcedLanguage);await turn(result.text,false,recording,signature,result);}).catch(e=>{if(!closed)hooks.error(e);});},
      onError(e){hooks.error(e);close();}});
    if(closed){capture.close();throw new DOMException('Cancelled','AbortError');}hooks.state('listening');
    ticker=setInterval(async()=>{if(closed)return;try{await loadChat(key,true);if(closed)return;sessionLanguage=prior(chatFor(key).events);hooks.context(chatFor(key));if(hooks.narration()&&!thinking&&!speaking&&!barge.owner)await turn('',true);}catch(e){if(!closed)hooks.notice(e.message);}},1000);
    return {close,sendNow:()=>capture.sendNow(),stopSpeech:quiet,async setLanguage(lang){if(!['es','en'].includes(lang))return;interrupt();await post('language',{language:lang});forcedLanguage=lang;spokenLanguage=lang;hooks.language?.(lang,lang);},setMuted(value){muted=value;interrupt();barge.ownerEnd();capture.setMuted(value);hooks.state(value?'muted':'listening');},interrupt,get signal(){return controller.signal;},get id(){return id;}};
  }catch(e){await close();throw e;}
}};
