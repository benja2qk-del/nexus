'use strict';
// Calls own their session key. Navigation cannot redirect speech or an answer.
const NexusCall = (() => {
  const core=NexusCallCore, voice=NexusVoiceCore;
  let call=null, audio=null, sequence=0, dialogFocus=null;
  const wake=core.wakeLock(navigator.wakeLock,()=>!document.hidden);
  const icon=(name)=>{
    const paths={phone:'M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7l.5 2.6a2 2 0 0 1-.6 1.7L8.7 10.3a16 16 0 0 0 5 5l1.3-1.3a2 2 0 0 1 1.7-.6l2.6.5a2 2 0 0 1 1.7 2Z',end:'m3 3 18 18M4 17v-3a15 15 0 0 1 16 0v3h-5v-3M9 14v3H4',mic:'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',hand:'M8 13V5a2 2 0 0 1 4 0v7M12 11V3a2 2 0 0 1 4 0v9M16 11V6a2 2 0 0 1 4 0v9c0 5-3 7-7 7-3 0-4-1-6-4l-4-5a2 2 0 0 1 3-2l2 2',speaker:'m11 3-6 5H2v8h3l6 5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14',captions:'M3 4h18v16H3ZM10 9H7v6h3M18 9h-3v6h3',down:'m6 9 6 6 6-6',chat:'M3 3h18v14H8l-5 4Z',signal:'M4 20v-4M9 20v-8M14 20V8M19 20V4'};
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${name==='end'?paths.phone+' M22 2 2 22':paths[name]||paths.phone}"/></svg>`;
  };
  const active=()=>!!call&&call.machine.value!=='ended';
  const valid=(c,ticket)=>call===c&&active()&&sequence===ticket&&!c.paused&&!document.hidden;
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const identity=e=>JSON.stringify([e.t,e.id,e.ts,e.text]);
  const baseline=chat=>Object.assign(new Set(chat.events.map(identity)),{anchor:chat.events.length?identity(chat.events.at(-1)):null});
  // Load earlier messages prepends old events during a call; only events after the last one seen before the sentence are new.
  const fresh=(c,chat)=>{const at=c.pending?.anchor?chat.events.findLastIndex(e=>identity(e)===c.pending.anchor):-1;return chat.events.slice(at+1).filter(e=>!c.pending?.has(identity(e)));};
  // An API error after the sentence is the turn's news: its first sentence, without the JSON body some errors carry.
  const failure=(c,events)=>{const e=events.slice(events.findLastIndex(x=>x.t==='user')+1).findLast(x=>x.t==='note'&&x.err&&String(x.text||'').trim());if(!e)return '';
    const s=voice.clean(String(e.text).replace(/\{[\s\S]*\}/g,' ')).replace(/\s+/g,' ').trim(),first=(s.match(/.*?[.!?](?=\s|$)/)||[s])[0].slice(0,300);
    return (({claude:'Claude Code'})[c.session.kind]||agentName(c.session.kind))+(first?' reports: '+first:' reported an error. It is in the conversation.');};
  function mode(c,value,hint='',errorTitle='') {if(call!==c||c.machine.value==='ended')return;c.machine.set(value);c.hint=hint;c.errorTitle=errorTitle;render();}
  const microphoneBlocked=error=>error?.name==='NotAllowedError'||/permission denied|microphone.*(?:blocked|denied)/i.test(error?.message||'');
  function pauseError(c,error,message=error.message){
    const blocked=microphoneBlocked(error);stop();mode(c,'error',blocked?'Allow microphone access in your browser settings, then try again.':message,blocked?'Microphone blocked':'');
  }
  function stop(){sequence++;call?.liveStart?.abort();const old=audio;audio=null;return old?.close();}
  function button(key,label=false){return `<button class="nx-call-entry ${label?'with-label':''}" data-call-session="${esc(key)}" aria-label="Call ${esc(state.byKey.get(key)?.title||'this session')}">${icon('phone')}${label?'<span>Call</span>':''}</button>`;}
  function decorateButton(el){const on=active()&&call.key===state.sel;const html=icon('phone')+`<span>${on?'On call':'Call'}</span>`;if(el.innerHTML!==html)el.innerHTML=html;el.setAttribute('aria-label',on?'Return to call':'Call this session');el.classList.add('nx-composer-call');}
  function mount(){
    if($('#nxCallLayer'))return;
    const layer=document.createElement('div');layer.id='nxCallLayer';
    layer.innerHTML=`<div class="nx-call-scrim" data-call="minimize"></div><section id="nxCall" role="dialog" aria-modal="true" aria-label="Session call" tabindex="-1"><header class="nx-call-header"><button data-call="minimize" aria-label="Minimize call">${icon('down')}</button><div><strong id="nxCallTitle"></strong><span id="nxCallMeta"></span></div><span class="nx-call-signal" aria-label="Connected to your PC">${icon('signal')}</span></header><div class="nx-call-content"><div class="nx-call-body"><button class="nx-call-core" data-call="core" aria-label="Send now"><span class="nx-call-ripples"><i></i><i></i><i></i></span><span class="nx-call-glow"></span><span class="nx-call-shimmer"></span><span class="nx-call-crystal">${Prism.markup()}</span></button><div class="nx-call-state" role="status" aria-live="polite"><h2 id="nxCallState"></h2><p id="nxCallHint"></p></div><button class="nx-call-resume btn" data-call="resume" hidden>Resume call</button><label class="nx-call-progress"><span>Spoken progress updates</span><input type="checkbox" data-call-progress role="switch" aria-label="Spoken progress updates"></label><div id="nxCallCaptions" aria-label="Live captions"><div data-caption="you"><small>You</small><p></p></div><div data-caption="agent"><small></small><p></p></div></div></div><section id="nxCallQuestion" aria-label="Agent question" hidden></section></div><footer class="nx-call-controls">${[['mute','mic','Mute'],['interrupt','hand','Interrupt'],['end','end','End'],['speaker','speaker','Speaker'],['captions','captions','Captions']].map(([action,glyph,label])=>`<span><button data-call="${action}" aria-label="${action==='end'?'End call':label}">${icon(glyph)}</button><small>${label}</small></span>`).join('')}</footer><div id="nxCallEnded" hidden></div></section>`;
    document.body.append(layer);
    const languageButton=document.createElement('button');languageButton.dataset.call='language';languageButton.className='nx-call-language';languageButton.textContent='EN';$('.nx-call-signal').before(languageButton);
    const debug=document.createElement('details');debug.className='nx-call-debug';debug.innerHTML='<summary>Call options &amp; timing</summary><div id="nxCallLatency">Waiting for a voice turn</div><div><button class="btn" data-call="fallback">Use turn-by-turn Call</button><button class="btn" data-call="live">Use Live</button></div><label><span>Use PC voice for fallback</span><input type="checkbox" role="switch" data-call-pc-voice></label></details>';$('.nx-call-body').append(debug);
    const meter=document.createElement('div');meter.className='nx-live-meter';meter.setAttribute('role','meter');meter.setAttribute('aria-label','Microphone level');meter.setAttribute('aria-valuemin','0');meter.setAttribute('aria-valuemax','100');meter.setAttribute('aria-valuenow','0');meter.innerHTML='<i></i>';$('#nxCallState').after(meter);
    layer.addEventListener('click',e=>{const choice=e.target.closest('[data-call-answer]');if(choice){answer(choice.dataset.callAnswer,choice.dataset.signature);return;}const action=e.target.closest('[data-call]')?.dataset.call;if(action)controls(action);});
    layer.addEventListener('change',e=>{if(e.target.matches('[data-call-progress]')&&call){call.narration=e.target.checked;pref.set('callNarration',call.narration?'on':'off');}if(e.target.matches('[data-call-pc-voice]'))pref.set('voiceServerSpeech',e.target.checked?'on':'off');});
  }
  function render(){
    const c=call;if(!c){$('#nxCallLayer')?.remove();$('#nxCallPill')?.remove();document.body.classList.remove('nx-call-open');return;}
    mount();const ended=c.machine.value==='ended',visible=ended||!c.minimized,box=$('#nxCall');
    if($('#nxCallLayer').dataset.presented!==String(visible)){$('#app').inert=visible;$('#nxCallLayer').dataset.presented=String(visible);}
    $('#nxCallLayer').hidden=!visible;document.body.classList.toggle('nx-call-open',visible);
    box.dataset.state=c.machine.value;box.dataset.live=String(!!c.live);box.dataset.agent=c.session.kind;box.style.setProperty('--call-agent','var(--agent-'+c.session.kind+')');
    $('#nxCallTitle').textContent=c.session.title;
    const languageButton=$('[data-call="language"]');languageButton.textContent=(c.language||'en').toUpperCase();languageButton.setAttribute('aria-pressed',String(!!c.forcedLanguage));languageButton.setAttribute('aria-label',(c.forcedLanguage?'Language locked to ':'Language: ')+(c.language==='es'?'Español':'English')+'. Tap to use '+(c.language==='es'?'English':'Español')+' for this call.');languageButton.title=c.forcedLanguage?'Language locked for this call':'Language follows your speech';
    updateHTML($('#nxCallMeta'),nxAgent(c.session)+nxModel(c.session)+`<span>${c.live?'Live'+(c.speechKind==='neural'?' · Neural':c.speechKind==='device'?' · Device voice':''):'Turn-by-turn'}</span><time aria-label="Call duration">${core.formatTime(((c.endedAt||Date.now())-c.startedAt)/1000)}</time>`);
    $('[data-call-pc-voice]').checked=pref.get('voiceServerSpeech','off')==='on';
    $('[data-call="fallback"]').hidden=!c.live;$('[data-call="live"]').hidden=!!c.live;
    if(c.latency)$('#nxCallLatency').textContent=[['vadMs','Pause'],['whisperMs','Words'],['ttftMs','First token'],['synthesisMs','Synthesis'],['ttsMs','Voice'],['totalMs','Total']].map(([k,label])=>label+': '+(Number.isFinite(c.latency[k])?Math.round(c.latency[k])+' ms':'--')).join(' · ');
    const labels={connecting:'Calling '+(agentName(c.session.kind))+'…',listening:'Listening',thinking:'Thinking',working:c.activity?'Working: '+c.activity:'Thinking',speaking:'Speaking','your-turn':'Your turn',paused:'Call paused',muted:'Muted',error:c.errorTitle||'Call paused',ended:'Call ended'};
    $('.nx-call-signal').setAttribute('aria-label',['paused','error'].includes(c.machine.value)?labels[c.machine.value]:c.machine.value==='connecting'?'Connecting to your PC':'Connected to your PC');
    $('#nxCallState').textContent=labels[c.machine.value];
    const hints={connecting:'Connecting to the session on your PC',listening:c.question?'Say one, two or three, or choose below':'Speak, then pause. Tap the core to send now.',thinking:'Working out a reply',working:'Following the session on your PC',speaking:'Tap the core to interrupt and speak','your-turn':'Start talking when ready',paused:'Listening stopped while NEXUS was away.',muted:'Unmute when you are ready to talk'};
    $('#nxCallHint').textContent=c.hint||(c.live&&c.machine.value==='speaking'?'Speak to interrupt. I am still listening.':c.live&&c.machine.value==='listening'?'Talk freely. Say “tell the agent” to relay a request.':hints[c.machine.value])||'';
    const resume=$('[data-call="resume"]');resume.hidden=!['paused','error'].includes(c.machine.value);resume.textContent=c.machine.value==='error'?'Try again':'Resume call';
    $('.nx-call-core').setAttribute('aria-label',c.machine.value==='speaking'?'Interrupt speech and talk':'Send now');
    $('[data-call-progress]').checked=c.narration;
    for(const [name,value] of [['mute',c.muted],['speaker',c.speaker],['captions',c.captions]]){$(`[data-call="${name}"]`).setAttribute('aria-pressed',String(value));}
    $('[data-call="mute"]').setAttribute('aria-label',c.muted?'Unmute':'Mute');$('[data-call="mute"]').nextElementSibling.textContent=c.muted?'Unmute':'Mute';
    $('#nxCallCaptions').hidden=!c.captions;
    $('[data-caption="you"]').hidden=!c.heard;$('[data-caption="you"] p').textContent=c.heard||'';
    // The question card already captions the complete question and spoken choices.
    // NEXUS's own notes (progress, unclear answers, a held sentence) are captioned as NEXUS, never as the agent.
    const own=c.live||c.spokenBy==='nexus';
    $('[data-caption="agent"]').hidden=!c.spoken||!!c.question&&!own;$('[data-caption="agent"] p').textContent=c.live?(c.spoken||''):(NexusDesign.plainSummary(c.spoken)||'');$('[data-caption="agent"] small').textContent=own?'NEXUS':agentName(c.session.kind);
    const q=c.question;$('#nxCallQuestion').hidden=!q||ended;
    if(q)updateHTML($('#nxCallQuestion'),`<small>${agentName(c.session.kind)} is asking</small><p>${esc(q.question)}</p>${q.context?`<pre class="permission-context">${esc(q.context)}</pre>`:''}<div>${q.options.slice(0,3).map((o,i)=>`<button data-call-answer="${esc(o.key)}" data-signature="${esc(q.signature)}"><b>${i+1}</b>${esc(o.label)}</button>`).join('')}</div><span><span>Say one, two or three</span><button class="btn" data-call-answer="esc" data-signature="${esc(q.signature)}">Cancel</button>${q.options.length>3?'<button data-call="conversation">All options in conversation</button>':''}</span>`);
    for(const cls of ['.nx-call-header','.nx-call-content','.nx-call-controls'])$(cls).hidden=ended;
    $('#nxCallEnded').hidden=!ended;
    if(ended)renderEnded(c);
    const shownQuestion=q&&!ended&&visible?q.signature:null;
    if(shownQuestion&&c.shownQuestion!==shownQuestion)$('#nxCallQuestion').scrollIntoView({block:'nearest'});
    c.shownQuestion=shownQuestion;
    if(!visible){
      let pill=$('#nxCallPill');if(!pill){pill=document.createElement('div');pill.id='nxCallPill';pill.setAttribute('role','region');pill.setAttribute('aria-label','Ongoing call');document.body.append(pill);pill.onclick=e=>e.target.closest('[data-call-end]')?end():restore();}
      updateHTML(pill,`<button aria-label="Return to call"><i></i><strong>${esc(c.session.title)}</strong><time>${c.paused?'Call paused':core.formatTime((Date.now()-c.startedAt)/1000)}</time></button><button data-call-end aria-label="End call">${icon('end')}</button>`);
    }else $('#nxCallPill')?.remove();
  }
  async function start(key){
    if(active()){if(call.key===key){restore();return;}toast('Call in progress','End the current call before calling another session.','',restore);return;}
    const s=state.byKey.get(key)||state.terms.find(t=>'term:'+t.id===key);if(!s)return;
    dismiss();dialogFocus=document.activeElement;
    call={key,session:{...s},startedAt:Date.now(),since:Date.now()+(state.receivedAt?state.lastUpdate-state.receivedAt:0),machine:core.machine(),minimized:false,paused:false,muted:false,speaker:true,captions:true,narration:pref.get('callNarration','on')!=='off',progress:core.progress(),pending:null,question:null,heard:'',spoken:'',needsResume:true};
    // Turn-by-turn is the default; Live is kept only when it was chosen in Call options.
    call.live=pref.get('callMode','turns')==='live';
    call.language=voice.sessionLanguage(chatFor(key).events);call.forcedLanguage=null;
    $('#nxIncomingCall')?.remove();render();$('#nxCall').focus({preventScroll:true});wake.start();run(call);
  }
  async function run(c){
    const stopping=stop(),ticket=sequence;await stopping;
    if(!valid(c,ticket))return;
    if(c.live)return runLive(c,ticket);
    const adapter=NexusVoice.callAudio(c.key,{
      state(value){if(!valid(c,ticket))return;if(value==='listening')mode(c,'listening');else if(value==='transcribing')mode(c,'thinking','Turning your recording into words on your PC.');else if(value==='speaking')mode(c,'speaking');else if(value==='your-turn')mode(c,'your-turn');},
      level(value){if(valid(c,ticket))$('#nxCall')?.style.setProperty('--voice-level',String(value));}
    });audio=adapter;
    // An unclear or stale answer is said aloud and the call listens again; hands-free, a silent pause looks like a dead call.
    const retry=async text=>{c.pending=null;await say(c,text,adapter,ticket,'nexus');if(valid(c,ticket)&&c.speaker)await adapter.earcon();};
    try{
      await adapter.unlock();if(!valid(c,ticket))return;
      await loadChat(c.key,true);if(!valid(c,ticket))return;
      if(chatFor(c.key).error)throw Error('Could not reach your PC. Check the connection and try again.');
      if(c.needsResume){
        await ensureChatTerminal(c.key,adapter.signal);if(!valid(c,ticket))return;c.needsResume=false;
        const until=Date.now()+20000;
        do{await loadChat(c.key,true);if(!valid(c,ticket))return;const t=chatFor(c.key).terminal;if(t?.ready||t?.busy||t?.prompt)break;if(Date.now()>until)throw Error('The session is still starting. Try again in a moment.');await wait(300);}while(true);
      }
      while(valid(c,ticket)){
        await loadChat(c.key,true);if(!valid(c,ticket))return;
        const chat=chatFor(c.key);if(chat.error)throw Error('Connection lost. Check the PC connection, then try again.');
        if(chat.terminal?.exited)throw Error('This session ended. Open the conversation to resume it.');
        const prompt=chat.terminal?.prompt;
        if(prompt&&prompt.signature!==c.answered){
          c.question=prompt;render();
          if(c.questionSpoken!==prompt.signature){c.questionSpoken=prompt.signature;await say(c,voice.questionSpeech(prompt),adapter,ticket);if(!valid(c,ticket))return;if(c.speaker)await adapter.earcon();if(!valid(c,ticket))return;}
        }else if(c.pending||chat.terminal?.busy){
          c.question=null;c.pending ||= baseline(chat);
          await working(c,adapter,ticket);continue;
        }else c.question=null;
        if(c.muted){mode(c,'muted');await wait(200);continue;}
        if(!chat.terminal?.ready&&!prompt){mode(c,'thinking','Waiting for the session to be ready.');await wait(500);continue;}
        const signature=prompt?.signature;
        const recording=await adapter.record();if(!valid(c,ticket))return;
        if(!recording.voiced&&!recording.manual)continue;
        const result=await adapter.transcribe(recording.wav,{prior:voice.sessionLanguage(chat.events),forced:c.forcedLanguage});if(!valid(c,ticket))return;
        c.language=voice.turnLanguage(result.text,result,voice.sessionLanguage(chat.events),c.forcedLanguage);
        c.heard=result.text;render();if(!result.text){mode(c,'your-turn','No words heard. Please say that again.');await wait(500);continue;}
        await loadChat(c.key,true);if(!valid(c,ticket))return;
        const latest=chatFor(c.key),question=latest.terminal?.prompt;c.pending=baseline(latest);
        if(question||signature){
          if(!question||question.signature!==signature){await retry('The question changed while you spoke. Nothing was answered.');continue;}
          const choice=voice.spokenAnswer(result.text,question);
          if(!choice){await retry('That answer was unclear, so nothing was sent. Say one, two or three, or use the buttons.');continue;}
          if(!await answerChat(choice,signature,c.key,adapter.signal))throw Error('The answer was not sent. Review the question and try again.');
          c.answered=signature;c.question=null;
        }else{
          if(latest.terminal?.busy){await retry('The agent is still working, so your sentence was not sent. Use Interrupt to stop it, then speak.');continue;}
          mode(c,'thinking','Sending your sentence…');
          const receipt=await sendChat(null,result.text,adapter.signal,c.key);if(!valid(c,ticket))return;
          if(!receipt?.ok)throw Error(receipt?.message?.error||'Your sentence was not delivered. Try again when the session is ready.');
          c.receipt=receipt.message;
        }
        if(valid(c,ticket))mode(c,'thinking');
      }
    }catch(error){if(valid(c,ticket)&&error.name!=='AbortError'){let message=error.message;if(microphoneBlocked(error))message='Allow microphone access in your browser settings, then try again.';if(error.name==='NotFoundError')message='Connect a microphone, then try again.';if(error.name==='NotReadableError')message='The microphone is busy. Close the other recording app, then try again.';
      // Say why the call paused; a voice that cannot reach the PC must not hold the pause back.
      if(!microphoneBlocked(error))await Promise.race([say(c,message,adapter,ticket,'nexus').catch(()=>{}),wait(12000)]);
      if(valid(c,ticket))pauseError(c,error,message);}}
  }
  async function runLive(c,ticket){
    c.liveStart=new AbortController();
    const level=value=>{if(!valid(c,ticket))return;$('#nxCall')?.style.setProperty('--voice-level',String(value));const meter=$('.nx-live-meter');meter?.setAttribute('aria-valuenow',String(Math.round(value*100)));};
    try{
      const adapter=await NexusLiveCall.open(c.key,{signal:c.liveStart.signal,forcedLanguage:c.forcedLanguage,
        language(lang,forced){if(valid(c,ticket)){c.language=lang;c.forcedLanguage=forced;render();}},
        state(value){if(valid(c,ticket)){if(c.muted)value='muted';mode(c,value==='listening'&&c.activity?'working':value);}},
        ready(info){if(valid(c,ticket)){c.brain=info;render();}},level,
        speaker:()=>c.speaker,narration:()=>c.narration,question:()=>c.question,
        heard(text){if(valid(c,ticket)){c.heard=text;render();}},caption(text){if(valid(c,ticket)){c.spoken=text;render();}},
        sentence(text){if(valid(c,ticket)){c.spoken=text;render();}},latency(value){if(valid(c,ticket)){c.latency=value;render();}},renderer(kind){if(valid(c,ticket)){c.speechKind=kind;render();}},
        notice(text){if(valid(c,ticket)){c.hint=text;render();}},error(error){if(valid(c,ticket))pauseError(c,error);},
        fallback(){if(valid(c,ticket)){c.live=false;c.hint='Live voice unavailable. Your heard words are kept above.';run(c);}},
        context(chat){if(!valid(c,ticket))return;c.question=chat.terminal?.prompt||null;c.activity=chat.terminal?.busy?NexusActivity.current(chat.events.findLast(e=>e.t==='tool')):'';if(c.machine.value==='working'&&!c.activity)mode(c,'listening');else render();}
      });
      if(!valid(c,ticket)){adapter.close();return;}audio=adapter;if(c.muted)adapter.setMuted(true);
    }catch(error){if(!valid(c,ticket)||error.name==='AbortError')return;
      if(microphoneBlocked(error))pauseError(c,error);
      else if(/Live voice is unavailable|CLI sign-in|live call|Session unavailable/i.test(error.message)){c.live=false;c.hint='Live voice unavailable. Turn-by-turn Call is ready.';run(c);}
      else pauseError(c,error);
    }
  }
  async function say(c,text,adapter,ticket,from='agent'){
    if(!valid(c,ticket))return;c.spoken=text;c.spokenBy=from;render();
    if(c.speaker)await adapter.speak(text,c.forcedLanguage||voice.replyLanguage(text,c.language));
  }
  async function working(c,adapter,ticket){
    let last='',stable=Date.now(),ran=false;
    while(valid(c,ticket)){
      await loadChat(c.key,true);if(!valid(c,ticket))return;
      const chat=chatFor(c.key);
      if(chat.error)throw Error('Connection lost. Your sent sentence stays in the conversation. Try again to reconnect.');
      if(c.receipt?.status==='failed'){const error=c.receipt.error;c.pending=null;c.receipt=null;throw Error(error);}
      if(chat.terminal?.prompt&&chat.terminal.prompt.signature!==c.answered)return;
      const events=fresh(c,chat),replies=events.filter(e=>e.t==='ai').map(e=>e.text).join('\n\n'),idle=!chat.terminal?.busy&&!!(chat.terminal?.input??chat.terminal?.ready);
      const seen=JSON.stringify([replies,events.length,!!chat.terminal?.busy]);
      // The call saw a turn run: its terminal was busy after the baseline, or a new message started one.
      ran||=!!chat.terminal?.busy||events.some(e=>e.t==='user');
      if(seen!==last){last=seen;stable=Date.now();}
      const finish=async(text,from)=>{c.pending=null;c.receipt=null;c.activity='';await say(c,text,adapter,ticket,from);if(valid(c,ticket)){if(c.speaker)await adapter.earcon();else mode(c,'your-turn');}};
      if(replies&&!chat.more&&!chat.terminal?.busy&&(idle||chat.terminal?.exited)&&Date.now()-stable>=1000)return finish(voice.gist(voice.closingReply(events),c.language),'agent');
      if(chat.terminal?.exited)throw Error('The session ended before replying. Your sentence is in the conversation.');
      // The server queue may hold the sentence (paused queue, failed delivery): it was never typed into the session.
      const held=c.receipt?.status==='queued'&&chat.queue?.items?.some(i=>i.id===c.receipt.id);
      if(held&&(chat.queue.hold||idle&&Date.now()-stable>=3000)){const why=String(chat.queue.hold||chat.queue.reason||'').trim();return finish('Your sentence is waiting in the queue and was not sent yet.'+(why?' '+why:''),'nexus');}
      if(!replies&&!chat.terminal?.prompt&&idle&&!held){
        if(c.answered&&Date.now()-stable>=1000){c.pending=null;c.receipt=null;return;}
        // A turn interrupted elsewhere ends without text; waiting for one would show Thinking for good. It is news only
        // when part of it was recorded after the baseline (a busy screen alone may be a turn that already answered), and
        // the sentence is named only when the call sent it and it is recorded: a refused one never was.
        if(!chat.more&&ran&&Date.now()-stable>=3000){
          if(!events.length){c.pending=null;c.receipt=null;return;}
          const sent=c.receipt&&events.some(e=>e.t==='user'&&String(e.text||'').trim()===String(c.receipt.text||'').trim());
          return finish(failure(c,events)||'The turn ended without a reply.'+(sent?' Your sentence is in the conversation.':''),'nexus');
        }
      }
      c.activity=NexusActivity.current(events.findLast(e=>e.t==='tool'));
      mode(c,c.activity?'working':'thinking');
      const progress=c.progress.take(c.activity,c.narration&&c.speaker&&!!chat.terminal?.busy);
      if(progress){await say(c,progress,adapter,ticket,'nexus');if(!valid(c,ticket))return;mode(c,c.activity?'working':'thinking');}
      await wait(500);
    }
  }
  function minimize(){if(!active())return;call.minimized=true;render();dialogFocus?.isConnected&&dialogFocus.focus({preventScroll:true});}
  function restore(){if(!call)return;call.minimized=false;render();$('#nxCall').focus({preventScroll:true});}
  async function answer(choice,signature){
    const c=call;if(!active()||c.paused||document.hidden||c.action||!c.question||c.question.signature!==signature)return;
    if(c.live){audio?.interrupt();c.action=true;try{if(!await answerChat(choice,signature,c.key,audio?.signal))throw Error('The question changed. Review it and try again.');c.question=null;render();}catch(e){c.hint=e.message;render();}finally{c.action=false;}return;}
    stop();c.action=true;const ticket=sequence;
    try{await loadChat(c.key,true);if(call!==c||!active()||sequence!==ticket)return;c.pending=baseline(chatFor(c.key));
      if(!await answerChat(choice,signature,c.key))throw Error('The question changed or the answer was not delivered. Review it and try again.');
      if(call!==c||!active()||sequence!==ticket)return;c.heard=choice==='esc'?'Cancel':c.question.options.find(o=>o.key===choice)?.label;c.answered=signature;c.question=null;mode(c,'thinking');run(c);
    }catch(error){if(call===c&&active())mode(c,'error',error.message);}finally{c.action=false;}
  }
  async function controls(action){
    const c=call;if(!c)return;
    if(action==='end')return end();if(action==='close')return dismiss();if(action==='minimize')return minimize();if(action==='again')return start(c.key);
    if(action==='conversation'){const key=c.key;if(active())minimize();else dismiss();select(key);return;}
    if(!active())return;
    if(action==='language'){
      const lang=c.language==='es'?'en':'es';
      try{if(c.live){if(!audio?.setLanguage)return;await audio.setLanguage(lang);}c.language=lang;c.forcedLanguage=lang;render();}catch(e){c.hint=e.message;render();}return;
    }
    if(action==='fallback'||action==='live'){c.live=action==='live';pref.set('callMode',c.live?'live':'turns');mode(c,'connecting');run(c);return;}
    if(action==='resume'){c.paused=false;mode(c,'connecting');wake.start();run(c);}
    if(action==='mute'){c.muted=!c.muted;if(c.live&&audio)audio.setMuted(c.muted);else run(c);render();}
    if(action==='speaker'){c.speaker=!c.speaker;if(!c.speaker)audio?.stopSpeech();render();}
    if(action==='captions'){c.captions=!c.captions;render();}
    if(action==='core'){if(c.live){if(c.machine.value==='speaking')audio?.interrupt();else audio?.sendNow();return;}if(c.machine.value==='listening')audio?.sendNow();else if(c.machine.value==='speaking'){if(c.pending&&!c.question)return controls('interrupt');c.pending=null;c.muted=false;run(c);}}
    if(action==='interrupt'&&!c.action){
      if(c.live){audio?.interrupt();try{if(!await answerChat('esc',undefined,c.key,audio?.signal))throw Error('Could not interrupt the agent.');c.activity='';mode(c,'listening');}catch(e){c.hint=e.message;render();}return;}
      stop();c.action=true;const ticket=sequence;
      try{await loadChat(c.key,true);if(!valid(c,ticket))return;
        if(!await answerChat('esc',undefined,c.key))throw Error('Could not interrupt. Check the connection and try again.');
        if(!valid(c,ticket))return;c.pending=null;c.receipt=null;c.question=null;c.activity='';c.answered=null;mode(c,'your-turn','Interrupted. Your turn.');run(c);
      }catch(error){if(call===c&&active())mode(c,'error',error.message);}finally{c.action=false;}
    }
  }
  async function end(show=true){
    const c=call;if(!active())return;
    stop();wake.stop();c.endedAt=Date.now();c.machine.set('ended');c.minimized=false;c.question=null;
    if(!show){dismiss();return;}render();$('#nxCall').focus({preventScroll:true});
    if(c.key.startsWith('term:')){c.recapError='Activity counts will appear after the conversation is saved.';render();return;}
    try{c.recap=await api('/api/recap?key='+encodeURIComponent(c.key)+'&since='+c.since);}catch{c.recapError='Could not load activity counts. Open the conversation to review the work.';}
    if(call===c)render();
  }
  function renderEnded(c){
    const counts=c.recap?.counts,items=counts?[[counts.files,'file updated','files updated'],[counts.commands,'command run','commands run'],[counts.sites,'source checked','sources checked'],[counts.codex,'Codex run','Codex runs'],[counts.errors,'reported error','reported errors']].filter(([n])=>n).map(([n,a,b])=>`${n} ${n===1?a:b}`):[];
    updateHTML($('#nxCallEnded'),`<span class="nx-ended-core">${Prism.markup()}</span><h2>Call ended</h2><p>${esc(c.session.title)} · <time>${core.formatTime((c.endedAt-c.startedAt)/1000)}</time></p><div class="nx-call-recap"><small>What was done</small>${items.length?`<ul>${items.map(t=>`<li><i>✓</i>${esc(t)}</li>`).join('')}</ul>`:`<p>${esc(c.recapError||(counts?'No file, command or source activity recorded during this call.':'Loading activity…'))}</p>`}${c.recap?.partial?'<p>Counts cover the available part of the call.</p>':''}<p>The conversation keeps your messages and the full replies.</p></div><button class="btn primary" data-call="conversation">${icon('chat')}Open conversation</button><div><button class="btn" data-call="again">${icon('phone')}Call again</button><button class="btn" data-call="close">Close</button></div>`);
  }
  function dismiss(){if(active())return;call=null;render();$('#app').inert=false;dialogFocus?.isConnected&&dialogFocus.focus({preventScroll:true});}
  function incoming(s){
    if(pref.get('attention')==='off'||active()&&call.key===keyOf(s))return;
    $('#nxIncomingCall')?.remove();const el=document.createElement('section');el.id='nxIncomingCall';el.className='nx-incoming-call';el.setAttribute('role','alertdialog');el.setAttribute('aria-label',s.title+' needs you');
    el.innerHTML=`<div><span>${icon('phone')}</span><div><strong>Call ${esc(s.title)}?</strong><p>${esc(sessionPreview(s))}</p></div></div><footer><button class="answer">${icon('phone')}Answer</button><button class="dismiss">Dismiss</button></footer>`;
    el.querySelector('.answer').onclick=()=>start(keyOf(s));el.querySelector('.dismiss').onclick=()=>el.remove();document.body.append(el);
  }
  document.addEventListener('visibilitychange',()=>{wake.visibility();if(document.hidden&&active()){stop();call.paused=true;mode(call,'paused');}});
  window.addEventListener('pagehide',()=>{end(false);wake.stop();});
  window.addEventListener('keydown',e=>{
    if(!call||call.minimized)return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();active()?minimize():dismiss();return;}
    if(e.key==='Tab'){const nodes=[...$('#nxCall').querySelectorAll('button,input')].filter(n=>!n.disabled&&n.getClientRects().length),at=nodes.indexOf(document.activeElement),next=e.shiftKey?at-1:at+1;if(next<0||next>=nodes.length){e.preventDefault();nodes[(next+nodes.length)%nodes.length]?.focus();}return;}
    if(e.key.toLowerCase()==='m'&&!e.target.closest('input,textarea')){e.preventDefault();controls('mute');}
    if(call.question&&['1','2','3'].includes(e.key)){e.preventDefault();const option=call.question.options[+e.key-1];if(option)answer(option.key,call.question.signature);}
    // Session shortcuts must not run underneath a call dialog.
    e.stopImmediatePropagation();
  },true);
  document.addEventListener('click',e=>{const b=e.target.closest('[data-call-session]');if(b){e.preventDefault();e.stopImmediatePropagation();start(b.dataset.callSession);}},true);
  setInterval(()=>{if(call)render();if(pref.get('attention')==='off')$('#nxIncomingCall')?.remove();},1000);
  return {start,end,minimize,restore,dismiss,button,decorateButton,incoming,icon,get active(){return active();},get key(){return active()?call.key:null;},get status(){return call?.machine.value||'off';}};
})();

// Preserve the app's navigation handlers, with a persistent call pill above them.
const nxCallSetView=setView;
setView=function(view){if(NexusCall.active&&view!==state.view)NexusCall.minimize();return nxCallSetView(view);};
const nxCallSelect=select;
select=function(key,opts){if(NexusCall.active&&key!==state.sel)NexusCall.minimize();return nxCallSelect(key,opts);};
const nxCallPhoneRow=nxPhoneRow;
nxPhoneRow=function(s){const active=['ready','busy'].includes(statusLabel(s)[0]);return `<div class="nx-call-row-wrap ${active?'':'nx-swipe-row'}" ${active?'':'data-swipe-row'}>${nxCallPhoneRow(s)}${NexusCall.button(keyOf(s))}</div>`;};
// Reveal saved-row Call without treating a horizontal gesture as an Open tap.
let nxSwipe=null,nxSwipeClick=null;
document.addEventListener('pointerdown',e=>{const row=e.target.closest('[data-swipe-row]');nxSwipe=row?{row,x:e.clientX,y:e.clientY}:null;});
document.addEventListener('pointerup',e=>{if(!nxSwipe)return;const {row,x,y}=nxSwipe;nxSwipe=null;const dx=e.clientX-x,dy=e.clientY-y;if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)*1.5){row.classList.toggle('revealed',dx<0);nxSwipeClick=row;setTimeout(()=>nxSwipeClick=null,400);}});
document.addEventListener('pointercancel',()=>nxSwipe=null);
document.addEventListener('click',e=>{if(nxSwipeClick?.contains(e.target)&&!e.target.closest('[data-call-session]')){e.preventDefault();e.stopImmediatePropagation();nxSwipeClick=null;}},true);
document.addEventListener('keydown',e=>{const row=e.target.closest('[data-swipe-row]');if(row&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();row.classList.toggle('revealed',e.key==='ArrowLeft');}},true);
