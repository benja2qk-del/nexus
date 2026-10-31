// Pure audio/text helpers, shared by browser and model-free tests.
(function(root) {
  'use strict';
  function resample(channels, rate, target = 16000) {
    if (!Array.isArray(channels) || !channels.length || !channels[0].length || !Number.isFinite(rate) || rate < 8000 || rate > 192000 || !Number.isFinite(target) || target < 8000 || target > 192000 || channels.some(c => c.length !== channels[0].length)) throw Error('Invalid audio samples');
    const count = channels[0].length, mono = new Float32Array(count);
    for (const channel of channels) for (let i = 0; i < count; i++) mono[i] += (Number.isFinite(channel[i]) ? channel[i] : 0) / channels.length;
    if (rate === target) return mono;
    const output = new Float32Array(Math.round(count * target / rate));
    // Windowed-sinc low pass avoids folding high-frequency noise into speech.
    const cutoff = Math.min(1, target / rate) * .94, radius = Math.ceil(24 / cutoff);
    for (let i = 0; i < output.length; i++) {
      const position = i * rate / target, center = Math.floor(position);
      let value = 0, weight = 0;
      for (let j = Math.max(0, center - radius); j <= Math.min(count - 1, center + radius); j++) {
        const d = j - position, x = Math.PI * d * cutoff;
        const w = (Math.abs(x) < 1e-8 ? 1 : Math.sin(x) / x) * (.5 + .5 * Math.cos(Math.PI * d / (radius + 1)));
        value += mono[j] * w; weight += w;
      }
      output[i] = weight ? value / weight : 0;
    }
    return output;
  }
  function encodeWav(channels, rate) {
    const samples = resample(channels, rate), data = new ArrayBuffer(44 + samples.length * 2), view = new DataView(data);
    const str = (at, text) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); view.setInt16(44 + i * 2, Math.round(s * (s < 0 ? 32768 : 32767)), true); }
    return data;
  }
  function clean(text) {
    return String(text || '').replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, '')
      .replace(/^.*\|.*\|.*$/gm, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+|www\.\S+/gi, '')
      .replace(/`[^`]*`/g, '').replace(/(?:[A-Z]:\\|\\\\|(?:^|\s)(?:\.{0,2}\/|~\/))[^\s,;]+/gm, ' ')
      .replace(/\b(?:[\w.-]+[\\/])+[\w.-]+/g, '').replace(/^\s*(?:#{1,6}|>|[-*+] |\d+\. )\s*/gm, '')
      .replace(/[*_~]/g, '').replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').trim();
  }
  const languageWords={
    es:new Set('el la los las un una de y para puedes quieres listo respuesta archivo si necesito esta hecho hola dime dile uno dos tres opcion interrumpe confirmo como que escuchas escucho perfecto gracias pruebas agente ahora quiero sigue continua dale al tiro oye cachai cachay bacan fome harto weon po revisa revisar abre sesion pasaron estas todo bien mientras cambios estoy espera vamos puedes vos podes queres decime tenes aca'.split(' ')),
    en:new Set('the you your is are will would can have hello thanks please i check tests test run go ahead current session and then tell me whether all passed ready what how doing good now this that with for to it we let yes no continue'.split(' '))
  };
  function languageEvidence(text){
    const tokens=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z]+/g)||[];
    const scores={es:0,en:0};for(const token of tokens)for(const lang of ['es','en'])if(languageWords[lang].has(token))scores[lang]++;
    const total=scores.es+scores.en,lang=scores.es===scores.en?null:scores.es>scores.en?'es':'en';
    return {language:lang,confidence:total?Math.max(scores.es,scores.en)/total:0,evidence:total,words:tokens.length,scores};
  }
  function language(text,prior='en'){return languageEvidence(text).language||(prior==='es'?'es':'en');}
  function replyLanguage(text,owner='en'){return language(text,owner);}
  function turnLanguage(text,recognition={},prior='en',forced=null){
    if(['es','en'].includes(forced))return forced;
    const detected=['es','en'].includes(recognition?.language)?recognition.language:null;
    const confidence=Number.isFinite(recognition?.confidence)?recognition.confidence:0;
    const evidence=languageEvidence(text);
    // Acoustic ID can be confidently wrong on accented/code-switched clips.
    // Require several agreeing words before correcting it from the transcript.
    if(evidence.evidence>=4&&evidence.confidence>=.8)return evidence.language;
    if(detected&&confidence>=.8)return detected;
    if(/^(hola|gracias|dale|dos|tres|confirmo|hello|thanks)[.!?\s]*$/i.test(String(text).trim()))return language(text,prior);
    if(evidence.evidence>=2&&evidence.confidence>=.7)return evidence.language;
    // A short/uncertain clip cannot erase the session's established language.
    if(evidence.words<=4||confidence<.65)return prior==='es'?'es':'en';
    return detected||evidence.language||(prior==='es'?'es':'en');
  }
  function sessionLanguage(events=[],fallback='en'){
    const counts={es:0,en:0};let last=null;
    for(const event of events){if(event.t!=='user'&&event.role!=='user')continue;const found=languageEvidence(event.text);if(found.language&&found.evidence){counts[found.language]++;last=found.language;}}
    return counts.es===counts.en?(last||fallback):counts.es>counts.en?'es':'en';
  }
  function sessionPrior(){let key=null,value='en';return events=>{const owner=(events||[]).filter(e=>e.t==='user'||e.role==='user');const next=JSON.stringify(owner.map(e=>e.text));if(next!==key){key=next;value=sessionLanguage(owner,value);}return value;};}
  function gist(text) {
    const cleaned = clean(text), spanish = language(cleaned) === 'es';
    if (!cleaned) return spanish ? 'La respuesta completa está en el chat.' : 'Full reply is in the chat.';
    const paragraph = cleaned.split(/\n\s*\n/)[0].replace(/\n/g, ' ');
    const sentences = paragraph.match(/[^.!?]+[.!?]+(?:[”"]|$)?|[^.!?]+$/g) || [paragraph];
    let short = sentences.slice(0, 2).join('').trim();
    if (short.length > 360) short = short.slice(0, 360).replace(/\s+\S*$/, '') + '.';
    const longer = cleaned !== short || /```|~~~|https?:|\|.*\|/.test(String(text));
    return short + (longer ? (spanish ? ' La respuesta completa está en el chat.' : ' Full reply is in the chat.') : '');
  }
  const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.,!?¿¡]/g, '').replace(/\s+/g, ' ').trim();
  function spokenAnswer(text, prompt) {
    if (!prompt?.options?.length) return null;
    const s = normalize(text).replace(/(?: por favor| please)$/,''), choices = prompt.options.slice(0, 3);
    if (['cancel', 'cancelar', 'cancela', 'escape'].includes(s)) return 'esc';
    const n = {one:0, uno:0, una:0, primera:0, primero:0, '1':0, two:1, dos:1, segunda:1, segundo:1, '2':1, three:2, tres:2, tercera:2, tercero:2, '3':2}[s.replace(/^(?:option|opcion|numero|la|el) /, '')];
    if (n !== undefined) return choices[n]?.key || null;
    if (['yes', 'si', 'no'].includes(s)) {
      const yes = s !== 'no';
      const matches = prompt.options.filter(o => (yes ? /^(yes|si|allow|approve|accept|permitir|aceptar)\b/ : /^(no|deny|reject|decline|rechazar)\b/).test(normalize(o.label)));
      return matches.length === 1 && choices.includes(matches[0]) ? matches[0].key : null;
    }
    return null;
  }
  function questionSpeech(prompt) {
    const es = language(prompt.question) === 'es';
    return clean(prompt.question).slice(0, 350) + ' ' + prompt.options.slice(0, 3).map((o, i) => `${i + 1}. ${clean(o.label).slice(0, 180)}`).join('. ') + (es ? '. Di uno, dos o tres, o cancelar.' : '. Say one, two or three, or cancel.');
  }
  const api = { resample, encodeWav, clean, gist, language, replyLanguage, languageEvidence, turnLanguage, sessionLanguage, sessionPrior, spokenAnswer, questionSpeech };
  if (typeof module === 'object') module.exports = api; else root.NexusVoiceCore = api;
})(typeof window === 'object' ? window : globalThis);
