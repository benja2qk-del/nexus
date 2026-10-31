'use strict';
const NexusLiveAudio={async open({silenceMs=650,onLevel,onStart,onTurn,onError}){
  let closed=false,stream,context,source,node,mute=false,frames=[],pre=[],samples=0;
  const vad=NexusLiveCore.vad({silenceMs});
  function reset(){frames=[];pre=[];samples=0;vad.reset();}
  function finish(manual=false,endpoint=null){if(!frames.length)return;const joined=new Float32Array(samples);let at=0;for(const frame of frames){joined.set(frame,at);at+=frame.length;}const speechEnd=endpoint?.end?endpoint.speechEnd:performance.now(),vadMs=endpoint?.end?endpoint.silenceMs:0;reset();onTurn({wav:NexusVoiceCore.encodeWav([joined],context.sampleRate),manual,speechEnd,vadMs});}
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    context=new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000});await context.resume();await context.audioWorklet.addModule('/live-capture-worklet.js');
    source=context.createMediaStreamSource(stream);node=new AudioWorkletNode(context,'nexus-live-capture');source.connect(node);const silent=context.createGain();silent.gain.value=0;node.connect(silent);silent.connect(context.destination);
    node.port.onmessage=e=>{if(closed||mute)return;try{const frame=e.data,rms=Math.sqrt(frame.reduce((n,x)=>n+x*x,0)/frame.length);onLevel?.(Math.min(1,rms*5));const v=vad.push(rms,performance.now());
      if(v.start){frames=pre.slice();samples=frames.reduce((n,f)=>n+f.length,0);pre=[];onStart?.();}
      if(v.active||v.end){frames.push(frame);samples+=frame.length;}else{pre.push(frame);if(pre.length>10)pre.shift();}
      if(v.end||samples>=context.sampleRate*30)finish(false,v);
    }catch(error){onError?.(error);}};
    const track=stream.getAudioTracks()[0];track.onended=()=>{if(!closed)onError?.(Error('Microphone disconnected. Resume the call.'));};
    // iOS can mute capture while changing audio routes; never pretend to listen.
    track.onmute=()=>{if(!closed)onError?.(Error('Microphone paused by the device. Resume the call or use turn-by-turn Call.'));};
  }catch(e){stream?.getTracks().forEach(t=>t.stop());context?.close();throw e;}
  return {sendNow:()=>finish(true),setMuted(value){mute=value;for(const track of stream.getTracks())track.enabled=!value;reset();onLevel?.(0);},get owner(){return vad.active;},close(){closed=true;node.port.onmessage=null;node.disconnect();source.disconnect();stream.getTracks().forEach(t=>t.stop());context.close();reset();}};
}};
