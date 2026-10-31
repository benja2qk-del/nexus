'use strict';
// Auditions use the paired NEXUS origin. No phone ever connects to the TTS port.
const NexusVoicePicker=(()=>{
  let data=null,loading=null,player=null,playing='',busy='',message='',language='en';
  function stop(){if(player){player.pause();player.src='';player=null;}playing='';}
  function content(){
    if(!data)return `<p role="status">${esc(message||'Loading voices…')}</p>${message?'<button class="btn" data-voice-retry>Try again</button>':''}`;
    return `<p class="nx-voice-intro">Choose by ear. Your English and Spanish choices follow you on the PC and paired phone.</p><p class="nx-voice-status" role="status">${esc(message||data.status)}</p><div class="nx-voice-tabs" role="group" aria-label="Voice language">${[['en','English'],['es','Español']].map(([id,label])=>`<button class="btn" data-voice-language="${id}" aria-pressed="${language===id}">${label}</button>`).join('')}</div>${[language].map(lang=>`<div class="nx-voice-language"><h3>${lang==='en'?'English':'Español'}</h3><div class="nx-voice-options">${data.voices.filter(v=>v.lang===lang).sort((a,b)=>lang==='es'?({piper:0,qwen:1,kokoro:2,chatterbox:3}[a.engine]-{piper:0,qwen:1,kokoro:2,chatterbox:3}[b.engine]):0).map(v=>{
      const selected=data.selected[lang]===v.id,latency=Number.isFinite(v.ttfaMs)?`Warm: ${Math.round(v.ttfaMs)} ms to first audio`:'Not measured on this PC';
      return `<article class="nx-voice-option${selected?' selected':''}"><div class="nx-voice-title"><strong>${esc(v.name)}</strong><span>${selected?'Selected':esc(v.engine)}</span></div><p>${esc(v.description)}</p><small>${esc(latency)}</small><details><summary>License &amp; source</summary>${Number.isFinite(v.rtf)?`<p>Generation: ${v.rtf.toFixed(2)} seconds per second of audio.</p>`:''}<a href="${esc(v.source)}" target="_blank" rel="noopener noreferrer">${esc(v.license)}</a></details><div class="nx-voice-samples">${v.samples.map(s=>`<button class="btn" data-voice-play="${v.id}" data-sample="${s.index}" aria-label="${playing===v.id+'-'+s.index?'Stop':'Play'} sample ${s.index+1} for ${esc(v.name)}" ${s.available?'':'disabled'}>${playing===v.id+'-'+s.index?'Stop':'Play '+(s.index+1)}</button>`).join('')}</div><button class="btn nx-voice-use" data-voice-use="${v.id}" data-language="${lang}" ${selected||!v.installed||busy?'disabled':''}>${busy===v.id?'Saving…':selected?'Selected':v.installed?'Use this voice':'Not installed'}</button></article>`;
    }).join('')}</div></div>`).join('')}<details class="nx-voice-phrases"><summary>What the samples say</summary>${['en','es'].map(lang=>`<ol lang="${lang}">${data.voices.find(v=>v.lang===lang)?.samples.map(s=>`<li>${esc(s.text)}</li>`).join('')||''}</ol>`).join('')}</details><p class="nx-coverage">Voices run locally for free. While a voice loads, Live uses device speech. Listen to the samples to choose the accent you prefer.</p>`;
  }
  function render(){const host=document.querySelector('#nxVoicePicker');if(host)updateHTML(host,content());}
  async function load(){if(loading)return loading;loading=(async()=>{try{data=await api('/api/voices');message='';}catch{message='Could not load voices. Check that NEXUS is running on your PC.';}finally{loading=null;render();}})();return loading;}
  const original=nxRenderSettings;nxRenderSettings=function(){original();const section=document.querySelector('#nxSetting-voice');if(!section)return;let host=document.querySelector('#nxVoicePicker');if(!host){host=document.createElement('div');host.id='nxVoicePicker';section.insertBefore(host,section.querySelector('.nx-voice-check'));}render();if(!data)load();};
  nxSettingsSections.find(s=>s[0]==='voice')[1]='Voice';
  document.addEventListener('click',async event=>{
    const tab=event.target.closest('[data-voice-language]');if(tab){stop();language=tab.dataset.voiceLanguage;message='';render();return;}
    const play=event.target.closest('[data-voice-play]');
    if(play){const id=play.dataset.voicePlay,index=Number(play.dataset.sample),key=id+'-'+index;if(playing===key){stop();render();return;}stop();playing=key;message='Playing sample '+(index+1)+'…';render();const sample=data?.voices.find(v=>v.id===id)?.samples[index];if(!sample)return;
      const current=new Audio(sample.url);player=current;current.onended=()=>{if(player!==current)return;stop();message='Choose the voice you prefer.';render();};current.onerror=()=>{if(player!==current)return;stop();message='Sample could not play. Try again or check the PC connection.';render();};try{await current.play();}catch{if(player===current){stop();message='Tap Play again to allow audio on this device.';render();}}return;}
    const use=event.target.closest('[data-voice-use]');if(use&&!busy){busy=use.dataset.voiceUse;message='Saving your voice…';render();try{const result=await postNexus('/api/voices/select',{lang:use.dataset.language,voice:busy});data.selected=result.selected;message='Voice saved. Live will use it for '+(use.dataset.language==='es'?'Spanish.':'English.');}catch(e){message=e.message||'Could not save the voice. Try again.';}finally{busy='';render();}}
    if(event.target.closest('[data-voice-retry]')){message='';render();load();}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();render();}});
  const previous=setView;setView=function(view){if(view!=='settings')stop();return previous(view);};
  return {load,stop};
})();
