'use strict';
// One owner, one session, one microphone. No SpeechRecognition dependency.
const NexusVoice = (() => {
  const core = NexusVoiceCore;
  let active = null, context, capture = null, speechStop, playback, generation = 0;
  let checks = {};
  function checkStep(id, phase, detail = '', ms = null, fix = '') {
    checks[id] = { phase, detail, ms, fix };
    document.dispatchEvent(new CustomEvent('nexus:voice-check'));
  }
  function resetChecks() { checks = Object.fromEntries(['mic','playback','stt','tts'].map(id=>[id,{phase:'idle'}])); document.dispatchEvent(new CustomEvent('nexus:voice-check')); }
  const panel = () => document.getElementById('talkPanel');
  const alive = turn => !!turn && active === turn && !turn.controller.signal.aborted && (turn.call ? !document.hidden : turn.check || state.sel === turn.key && state.view === 'focus' && state.tab === 'chat');
  const delay = (ms, signal) => new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  });
  function audioContext() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw Error('Audio is unavailable in this browser. Open NEXUS in Safari, Chrome or Edge.');
    context ||= new Audio();
    return context;
  }
  function unlock() {
    const ctx = audioContext(); const resumed = ctx.resume();
    const source = ctx.createBufferSource(); source.buffer = ctx.createBuffer(1, 1, 22050); source.connect(ctx.destination); source.start();
    if (window.speechSynthesis) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance('')); }
    return resumed;
  }
  function stopSpeech() { speechStop?.(); speechStop = null; if (window.speechSynthesis) speechSynthesis.cancel(); if (playback) { try { playback.stop(); } catch {} playback = null; } }
  function stopCapture() { if (capture) { capture.cancelled = true; capture.stop(); } }
  function end() {
    generation++; const old = active; active = null;
    old?.controller.abort(); stopCapture(); stopSpeech(); panel()?.remove();
    if(old?.check)for(const [id,c]of Object.entries(checks))if(c.phase==='running')checkStep(id,'fail','Check stopped.',null,'Run the check again when you are ready.');
    if (old?.check) $('#app').inert = false;
    document.body.classList.remove('talk-active'); updateControls();
    if (old?.focus?.isConnected) old.focus.focus({preventScroll:true});
  }
  function stateLabel(mode, text) {
    if (!active) return;
    active.mode = mode;
    if (active.call) { active.callbacks.state?.(mode, text); return; }
    const p = panel(); if (!p) return;
    p.dataset.state = mode;
    p.querySelector('#talkState').textContent = text;
    const send = p.querySelector('[data-talk=send]');
    send.disabled = mode !== 'listening'; send.textContent = 'Send now';
    p.querySelector('#talkHint').textContent = mode === 'speaking' ? 'Tap here to interrupt and speak.' : mode === 'listening' ? 'Speak, then pause. Or tap Send now.' : mode === 'waiting' ? 'Your message is in the chat. Waiting for the reply.' : mode === 'transcribing' ? 'Turning your recording into words on your PC.' : '';
    if (active.check && mode === 'listening') { send.hidden = true; p.querySelector('#talkHint').textContent = 'Say a short sentence. Recording stops automatically.'; }
    updateControls();
  }
  function heard(text) { if (active) { active.heard = text; if(active.call)active.callbacks.heard?.(text);else panel().querySelector('#talkHeard').textContent = text; } }
  function showPanel(check = false, inline = false) {
    document.body.classList.add('talk-active');
    const el = document.createElement('section'); el.id = 'talkPanel'; el.className = 'talk-panel'; el.setAttribute('aria-label', check ? 'Voice check' : 'Talk conversation');
    el.innerHTML = `<div class="talk-heading"><span>${check ? 'VOICE CHECK' : 'TALK · ' + esc(agentName(state.byKey.get(state.sel)?.kind || selTerm()?.kind).toUpperCase())}</span><button class="btn" data-talk="end">${check ? 'Close' : 'End'}</button></div><div id="talkState" role="status" aria-live="polite">Getting ready</div><div class="talk-meter" role="meter" aria-label="Microphone level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><p id="talkHint"></p><p id="talkHeard" aria-label="Heard text"></p><div id="voiceResults" aria-live="polite"></div><div class="talk-actions"><button class="btn" data-talk="retry" hidden>Try again</button><button class="btn primary" data-talk="send" disabled>Send now</button></div><details class="talk-settings"><summary>Voice options &amp; help</summary><label>Send after a pause <select id="talkSilence"><option value="1300">1.3 seconds</option><option value="2000">2 seconds</option><option value="0">Only when I tap</option></select></label><label><input type="checkbox" id="talkServerSpeech"> Use PC voice for playback</label><p>Audio is transcribed on your PC and deleted. Keep NEXUS open. End stops voice; an already sent message stays in the chat.</p></details>`;
    if (check && inline && $('#nxVoiceLive')) { $('#nxVoiceLive').append(el); el.classList.add('nx-inline-check'); }
    else if (check) { document.body.append(el); el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); $('#app').inert = true; } else $('#steer').before(el);
    el.querySelector('[data-talk=end]').focus({preventScroll:true});
    el.querySelector('#talkSilence').value = pref.get('voiceSilence', '1300');
    el.querySelector('#talkServerSpeech').checked = pref.get('voiceServerSpeech', 'off') === 'on';
    el.onchange = e => { if (e.target.id === 'talkSilence') pref.set('voiceSilence', e.target.value); if (e.target.id === 'talkServerSpeech') pref.set('voiceServerSpeech', e.target.checked ? 'on' : 'off'); };
    el.onclick = e => {
      const action = e.target.closest('[data-talk]')?.dataset.talk;
      if (action === 'end') return end();
      if (active?.mode === 'speaking') { const turn = active; e.preventDefault(); if(turn.check)turn.checkInterrupted=true;stopSpeech(); if (!turn.check) listen(turn).catch(error => problem(turn, error)); return; }
      if (action === 'send') capture?.stop(true);
      if (action === 'retry') { const turn = active; el.querySelector('[data-talk=retry]').hidden = true; (turn.check ? runCheck(turn) : listen(turn)).catch(error => problem(turn, error)); }
    };
  }
  function problem(turn, error) {
    if (!alive(turn) || error.name === 'AbortError') return;
    stopCapture(); stopSpeech();
    let text = error.message || 'Voice stopped. Try Voice check in More.';
    if (error.name === 'NotAllowedError') text = 'Microphone access is blocked. Allow the microphone in your browser settings, then try again.';
    if (error.name === 'NotFoundError') text = 'No microphone was found. Connect one, then try again.';
    if (error.name === 'NotReadableError') text = 'The microphone is busy. Close the other recording app, then try again.';
    stateLabel('error', 'Voice paused'); panel().querySelector('#talkHint').textContent = text;
    panel().querySelector('[data-talk=retry]').hidden = false;
  }
  async function record(turn, { check = false } = {}) {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw Error('This browser cannot record here. Open the secure NEXUS address in Safari, Chrome or Edge.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    if (!alive(turn)) { stream.getTracks().forEach(t => t.stop()); throw new DOMException('Cancelled', 'AbortError'); }
    let ctx, source, analyser, recorder;
    try {
      ctx = audioContext(); await ctx.resume();
      if (!alive(turn)) throw new DOMException('Cancelled', 'AbortError');
      source = ctx.createMediaStreamSource(stream); analyser = ctx.createAnalyser(); analyser.fftSize = 1024; source.connect(analyser);
      const mime = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    } catch (error) { source?.disconnect(); analyser?.disconnect(); stream.getTracks().forEach(t => t.stop()); throw error; }
    stateLabel('listening', check ? 'Record for 3 seconds' : 'Listening');
    const started = performance.now(), samples = new Float32Array(analyser.fftSize), chunks = [];
    let lastLoud = started, voicedMs = 0, previous = started, bytes = 0;
    const result = await new Promise((resolve, reject) => {
      const rec = { cancelled: false, manual: false, stop(manual = false) { rec.manual ||= manual; if (!rec.cancelled && alive(turn)) stateLabel('transcribing', 'Transcribing'); if (recorder.state !== 'inactive') recorder.stop(); stream.getTracks().forEach(t => t.stop()); } };
      capture = rec;
      const cleanup = () => { clearInterval(timer); source.disconnect(); analyser.disconnect(); stream.getTracks().forEach(t => t.stop()); if (capture === rec) capture = null; };
      recorder.ondataavailable = e => { if (e.data.size) { chunks.push(e.data); bytes += e.data.size; if (bytes > 10 * 1024 * 1024) rec.stop(); } };
      recorder.onerror = () => { cleanup(); reject(Error('Recording stopped. Try the microphone again.')); };
      recorder.onstop = () => { cleanup(); rec.cancelled ? reject(new DOMException('Cancelled', 'AbortError')) : bytes > 10 * 1024 * 1024 ? reject(Error('Recording too large. Try a shorter turn.')) : resolve({ blob: new Blob(chunks, { type: recorder.mimeType }), voiced: voicedMs > 150, manual: rec.manual, duration: performance.now() - started }); };
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length), now = performance.now();
        if (rms > .014) { lastLoud = now; voicedMs += Math.min(100, now - previous); }
        previous = now;
        const meter = panel()?.querySelector('.talk-meter'), level = Math.min(100, Math.round(rms * 500));
        if (meter) { meter.setAttribute('aria-valuenow', String(level)); meter.firstElementChild.style.width = level + '%'; }
        if (turn.call) turn.callbacks.level?.(level / 100);
        const silence = Number(pref.get('voiceSilence', '1300'));
        if (check ? now - started >= 3000 : (silence && voicedMs > 200 && now - lastLoud >= silence) || now - started >= 119000) rec.stop();
      }, 50);
      try { recorder.start(250); } catch (error) { cleanup(); reject(error); }
    });
    if (!alive(turn)) throw new DOMException('Cancelled', 'AbortError');
    stateLabel('transcribing', 'Transcribing');
    const decoded = await ctx.decodeAudioData(await result.blob.arrayBuffer());
    if (decoded.duration > 120) throw Error('Keep each voice turn under two minutes.');
    const wav = core.encodeWav(Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i)), decoded.sampleRate);
    return { ...result, wav, mime: recorder.mimeType };
  }
  async function request(route, body, type, turn, headers = {}) {
    const response = await fetch(route, { method: 'POST', headers: { 'X-Nexus': '1', 'Content-Type': type, ...headers }, body, signal: turn.controller.signal });
    if (!response.ok) { let message; try { message = (await response.json()).error; } catch {} throw Error(message || 'The PC could not be reached. Check the connection and try again.'); }
    return response;
  }
  async function transcribe(wav, turn, context = {}) { return (await request('/api/voice/transcribe', wav, 'audio/wav', turn, {...(['es','en'].includes(context.prior)?{'X-Nexus-Language-Prior':context.prior}:{}),...(['es','en'].includes(context.forced)?{'X-Nexus-Language':context.forced}:{})})).json(); }
  async function play(wav, turn) {
    const ctx = audioContext(); await ctx.resume();
    const buffer = await ctx.decodeAudioData(wav.slice(0)); if (!alive(turn)) return;
    await new Promise(resolve => {
      const source = ctx.createBufferSource(); playback = source; source.buffer = buffer; source.connect(ctx.destination);
      const finish = () => { source.disconnect(); if (playback === source) playback = null; if (speechStop === stop) speechStop = null; resolve(); };
      const stop = () => { try { source.stop(); } catch {} finish(); };
      speechStop = stop; source.onended = finish; source.start();turn.callbacks?.audioStart?.();
    });
  }
  async function speak(text, turn, preferredLanguage) {
    stopCapture(); stopSpeech(); if (!alive(turn)) return;
    const serial = ++turn.speech;
    stateLabel('speaking', 'Speaking');
    const lang = ['es','en'].includes(preferredLanguage)?preferredLanguage:core.language(text);
    let nativeOk = false, interrupted = false;
    if (window.speechSynthesis && pref.get('voiceServerSpeech', 'off') !== 'on') {
      nativeOk = await new Promise(resolve => {
          const utterance = new SpeechSynthesisUtterance(text); utterance.lang = lang === 'es' ? 'es-CL' : 'en-US';
        const voices = speechSynthesis.getVoices(); utterance.voice = typeof NexusLiveCore==='undefined'?voices.find(v => v.lang.startsWith(lang))||null:NexusLiveCore.selectVoice(voices,lang);
        if(utterance.voice)utterance.lang=utterance.voice.lang;
        let started = false, settled = false;
        const finish = ok => { if (settled) return; settled = true; clearTimeout(startTimer); clearTimeout(endTimer); if (speechStop === stop) speechStop = null; resolve(ok); };
        const stop = () => { interrupted = true; finish(true); speechSynthesis.cancel(); };
        speechStop = stop;
        const startTimer = setTimeout(() => { if (!started) { finish(false); speechSynthesis.cancel(); } }, 1800);
        const endTimer = setTimeout(() => { finish(false); speechSynthesis.cancel(); }, Math.min(45000, Math.max(8000, text.length * 95)));
        utterance.onstart = () => { started = true;turn.callbacks?.audioStart?.(); }; utterance.onend = () => finish(started); utterance.onerror = () => finish(false);
        try { if(voices.length&&!utterance.voice)finish(false);else speechSynthesis.speak(utterance); } catch { finish(false); }
      });
    }
    if (!alive(turn) || interrupted || serial !== turn.speech) return;
    if (!nativeOk) {
      const response = await request('/api/voice/tts', JSON.stringify({ text, lang }), 'application/json', turn);
      if (!alive(turn) || serial !== turn.speech) return;
      await play(await response.arrayBuffer(), turn);
    }
    if (alive(turn) && serial === turn.speech && !turn.check && !turn.call && turn.mode === 'speaking') await yourTurn(turn);
  }
  async function yourTurn(turn) {
    if (!alive(turn)) return;
    stateLabel('your-turn', 'Your turn');
    const ctx = audioContext(); await ctx.resume();
    const oscillator = ctx.createOscillator(), gain = ctx.createGain(); oscillator.frequency.value = 740;
    gain.gain.setValueAtTime(0, ctx.currentTime); gain.gain.linearRampToValueAtTime(.08, ctx.currentTime + .015); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .14);
    oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(); oscillator.stop(ctx.currentTime + .16); oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    await delay(300, turn.controller.signal); if (alive(turn) && !turn.call) await listen(turn);
  }
  async function listen(turn) {
    if (!alive(turn) || capture) return;
    turn.speech++; // Invalidate a server speech request after barge-in.
    const prompt = chatFor(turn.key).terminal?.prompt;
    turn.promptSignature = prompt?.signature;
    const audio = await record(turn);
    if (!audio.voiced && !audio.manual) { stateLabel('your-turn', 'No speech heard'); await delay(500, turn.controller.signal); return listen(turn); }
    const result = await transcribe(audio.wav, turn);
    if (!alive(turn)) return;
    heard(result.text);
    if (!result.text) { stateLabel('your-turn', 'Please say that again'); await delay(600, turn.controller.signal); return listen(turn); }
    await loadChat(turn.key, true); if (!alive(turn)) return;
    const chat = chatFor(turn.key), currentPrompt = chat.terminal?.prompt;
    const baseline = chat.events.length;
    if (currentPrompt || turn.promptSignature) {
      if (!currentPrompt || currentPrompt.signature !== turn.promptSignature) throw Error('The question changed while you spoke. Review it, then try again.');
      const answer = core.spokenAnswer(result.text, currentPrompt);
      if (!answer) throw Error('That answer was unclear. Say an option number, or use the question buttons.');
      turn.answeredPrompt = currentPrompt.signature;
      if (!await answerChat(answer, turn.promptSignature)) throw Error('Your answer was not sent. Review the question in the chat.');
    } else {
      if (chat.terminal?.busy) throw Error('The session is still working. Wait for its reply, then try again.');
      stateLabel('waiting', 'Sending');
      const receipt = await sendChat(null, result.text, turn.controller.signal);
      if (!receipt?.ok) throw Error(receipt?.message?.error || 'Message not delivered. Your heard text is kept here; try again when the session is ready.');
      turn.receipt = receipt.message;
    }
    if (!alive(turn)) return;
    const agent = agentName(state.byKey.get(turn.key)?.kind || state.terms.find(t=>'term:'+t.id===turn.key)?.kind);
    stateLabel('waiting', 'Sent · ' + agent + ' is working');
    await waitReply(turn, baseline);
  }
  async function waitReply(turn, baseline) {
    let last = '', stable = Date.now(); const start = Date.now();
    while (alive(turn)) {
      await loadChat(turn.key, true); if (!alive(turn)) return;
      const chat = chatFor(turn.key);
      if (chat.error) throw Error('Connection lost. Your message stays in the chat. Reconnect, then tap Talk.');
      const prompt = chat.terminal?.prompt;
      if (prompt && prompt.signature !== turn.answeredPrompt) return speak(core.questionSpeech(prompt), turn);
      if (turn.receipt?.status === 'failed') throw Error(turn.receipt.error);
      const replies = chat.events.slice(baseline).filter(e => e.t === 'ai').map(e => e.text).join('\n\n');
      if (replies !== last) { last = replies; stable = Date.now(); }
      if (replies && !chat.more && !chat.terminal?.busy && ((chat.terminal?.input ?? chat.terminal?.ready) || chat.terminal?.exited) && Date.now() - stable >= 1000) { turn.receipt = null; return speak(core.gist(replies), turn); }
      if (chat.terminal?.exited && !replies) throw Error('The session ended before replying. Your message is in the chat.');
      if (Date.now() - start > 180000) throw Error('The session is taking longer. Follow its progress in the chat and tap Talk when ready.');
      await delay(500, turn.controller.signal);
    }
  }
  async function start(check = false, inline = false) {
    end();
    const turn = { key: state.sel, check, inline, controller: new AbortController(), speech: 0, mode: 'starting', generation: ++generation, focus:document.activeElement };
    active = turn;
    showPanel(check, inline);
    try {
      if(check){resetChecks();turn.checkStep='mic';checkStep('mic','running','Allow the microphone, then say a short sentence.');}
      await unlock();
      if (!alive(turn)) return;
      if (check) return await runCheck(turn);
      await loadChat(turn.key, true); if (!alive(turn)) return;
      const chat = chatFor(turn.key);
      if (chat.terminal?.prompt) return await speak(core.questionSpeech(chat.terminal.prompt), turn);
      if (chat.terminal?.busy) { stateLabel('waiting', 'Waiting for the current reply'); return await waitReply(turn, chat.events.length); }
      await listen(turn);
    } catch (error) { if(check&&alive(turn))checkStep(turn.checkStep||'mic','fail',error.message,null,'Allow microphone access and check your audio device, then run again.'); problem(turn, error); }
  }
  async function runCheck(turn) {
    resetChecks();
    const results = panel().querySelector('#voiceResults'); results.innerHTML = '';
    const line = text => { if (alive(turn)) { const p = document.createElement('p'); p.textContent = text; results.append(p); } };
    try {
      turn.checkStep='mic';let started=performance.now();checkStep('mic','running','Say a short sentence. Recording for 3 seconds…');
      line('Say a short sentence. Nothing from this check is sent to a session.');
      const audio = await record(turn, { check: true });
      checkStep('mic',audio.voiced?'pass':'fail',audio.voiced?'Recorded your voice.':'No voice was detected.',performance.now()-started,audio.voiced?'':'Speak close to the microphone and check the input volume.');
      line('Microphone: allowed. Recorded 3 seconds (' + audio.mime + ').');
      turn.checkStep='playback';turn.checkInterrupted=false;started=performance.now();checkStep('playback','running','Playing your recording…');
      stateLabel('speaking', 'Playing your recording'); await play(audio.wav, turn); if (!alive(turn)) return;
      checkStep('playback',turn.checkInterrupted?'fail':'pass',turn.checkInterrupted?'Playback was interrupted.':'Playback completed. Confirm you heard your sentence.',performance.now()-started,'Run again and let the recording finish.');
      line('Recording playback finished. You should have heard your sentence.');
      stateLabel('transcribing', 'Checking transcription');
      turn.checkStep='stt';started=performance.now();checkStep('stt','running','Transcribing on your PC…');
      const result = await transcribe(audio.wav, turn); if (!alive(turn)) return;
      checkStep('stt',result.text?'pass':'fail',result.text?'Heard “'+result.text+'”':'No words were detected.',performance.now()-started,result.text?'':'Speak clearly, then run the check again.');
      heard(result.text || 'No words detected.');
      line('Transcription: ' + (result.text ? 'received' : 'no words heard') + ' in ' + ((performance.now() - started) / 1000).toFixed(1) + ' s (PC ' + (result.elapsedMs / 1000).toFixed(1) + ' s).');
      turn.checkStep='tts';turn.checkInterrupted=false;started=performance.now();checkStep('tts','running','Playing a short phrase…');
      await speak('Voice check complete. Your microphone and local transcription are connected.', turn); if (!alive(turn)) return;
      checkStep('tts',turn.checkInterrupted?'fail':'pass',turn.checkInterrupted?'Speech playback was interrupted.':'Speech playback completed. If silent, use PC voice or raise the volume.',performance.now()-started,'Run again and let the phrase finish.');
      line('Speech playback finished. If silent, enable Use PC voice for playback below and run again.');
      stateLabel('checked', 'Voice check complete'); panel().querySelector('[data-talk=retry]').hidden = false;
    } catch (error) { if(alive(turn)) { const reason=error.name==='NotAllowedError'?'Microphone access is blocked.':error.name==='NotFoundError'?'No microphone was found.':error.message;checkStep(turn.checkStep,'fail',reason,null,turn.checkStep==='mic'?'Allow microphone access in your browser and connect a microphone.':turn.checkStep==='stt'?'Check the PC connection and local Whisper setup, then run again.':'Raise the volume or enable Use PC voice, then run again.'); } line('Check stopped at the step above.'); problem(turn, error); }
  }
  function updateControls() {
    const chat = typeof state !== 'undefined' && state.sel ? chatFor() : null;
    const button = document.querySelector('[data-steer=talk]');
    const calling = typeof NexusCall !== 'undefined' && NexusCall.active && NexusCall.key === state.sel;
    if (button) { if(typeof NexusCall!=='undefined')NexusCall.decorateButton(button);else button.textContent = active && !active.check ? 'End talk' : 'Talk'; button.setAttribute('aria-pressed', String(calling || !!active && !active.check && !active.call)); }
    const send = document.querySelector('[data-steer=send]'), input = $('#steerIn');
    if (send && input) {
      const reason = calling || active && !active.check && !active.call ? 'End the call to type a message.' : chat?.terminal?.prompt ? 'Answer the question above first.' : chat?.sending ? 'Sending your message.' : attachments.blocked(state.sel) ? 'Wait for the attachment to finish.' : !input.value.trim() ? 'Write a message first.' : '';
      send.disabled = !!reason; send.title = reason || 'Send message'; send.setAttribute('aria-label', reason ? 'Send. ' + reason : 'Send message');
    }
  }
  document.addEventListener('input', e => {
    if (e.target.id === 'steerIn') {
      const css = getComputedStyle(e.target), border = parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
      const maximum = 5 * parseFloat(css.lineHeight) + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) + border;
      e.target.style.height = '48px'; e.target.style.height = Math.min(maximum, Math.max(48, e.target.scrollHeight + border)) + 'px';
    }
    updateControls();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) end(); });
  window.addEventListener('pagehide', end);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && active && !active.call) { e.preventDefault(); e.stopImmediatePropagation(); end(); }
    if (e.key === 'Tab' && active?.check && !active.inline) {
      const nodes = [...panel().querySelectorAll('button,summary,input,select')].filter(el => !el.disabled && el.getClientRects().length);
      const index = nodes.indexOf(document.activeElement), next = e.shiftKey ? index - 1 : index + 1;
      if (next < 0 || next >= nodes.length) { e.preventDefault(); nodes[(next + nodes.length) % nodes.length]?.focus(); }
    }
  });
  setInterval(() => {
    if (active && (!active.check && !active.call && (state.sel !== active.key || state.view !== 'focus' || state.tab !== 'chat'))) end();
    updateControls();
  }, 200);
  function callAudio(key, callbacks) {
    end();
    const turn={key,call:true,callbacks,controller:new AbortController(),speech:0,mode:'starting'};
    active=turn;
    return {
      unlock,
      record:()=>record(turn),
      transcribe:(wav,context)=>transcribe(wav,turn,context),
      speak:(text,lang)=>speak(text,turn,lang),
      earcon:()=>yourTurn(turn),
      sendNow:()=>capture?.stop(true),
      stopSpeech:()=>{turn.speech++;stopSpeech();},
      close:()=>{turn.controller.abort();if(active===turn)end();},
      get signal(){return turn.controller.signal;}
    };
  }
  return { callAudio, start: () => start(false), check: (inline=false) => {if(typeof NexusCall!=='undefined'&&NexusCall.active)NexusCall.end(false);return start(true,inline);}, end, navigation:()=>{if(!active?.call)end();}, toggle: () => typeof NexusCall!=='undefined'?NexusCall.start(state.sel):active ? end() : start(false), updateControls, get checks(){return checks;}, get status() { return active?.mode || 'off'; } };
})();
