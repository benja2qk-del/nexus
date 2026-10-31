// Complete WAV chunks arrive over the authenticated call response. Decode ahead
// and schedule contiguously. Cancel invalidates queued/decoding and playing audio.
(function(root){
  'use strict';
  function create({context,onStart=()=>{},onIdle=()=>{}}={}){
    let ctx=context,epoch=0,next=0,chain=Promise.resolve(),closed=false;
    const sources=new Set(),pending=new Set();
    const get=()=>ctx||(ctx=new (root.AudioContext||root.webkitAudioContext)());
    async function unlock(){await get().resume();}
    function cancel(){epoch++;next=0;chain=Promise.resolve();for(const source of sources){try{source.stop();}catch{}source.disconnect();}sources.clear();for(const finish of pending)finish();pending.clear();}
    function push(encoded){
      const ticket=epoch;
      const played=new Promise((resolve,reject)=>{
        pending.add(resolve);
        chain=chain.then(async()=>{
          if(closed||ticket!==epoch){pending.delete(resolve);resolve();return;}
          const raw=typeof encoded==='string'?Uint8Array.from(root.atob(encoded),c=>c.charCodeAt(0)):encoded;
          const audio=get();await audio.resume();
          const buffer=await audio.decodeAudioData(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
          if(closed||ticket!==epoch){pending.delete(resolve);resolve();return;}
          const source=audio.createBufferSource();source.buffer=buffer;source.connect(audio.destination);sources.add(source);
          const at=Math.max(audio.currentTime+.008,next);next=at+buffer.duration;
          source.onended=()=>{source.disconnect();sources.delete(source);pending.delete(resolve);resolve();if(!sources.size&&ticket===epoch)onIdle();};
          source.start(at);onStart({scheduledAt:at,delayMs:(at-audio.currentTime)*1000});
        }).catch(error=>{pending.delete(resolve);reject(error);});
      });
      return played;
    }
    return {unlock,push,cancel,async close(){closed=true;cancel();if(ctx&&ctx.state!=='closed')await ctx.close();},get playing(){return sources.size>0;}};
  }
  const api={create};if(typeof module==='object')module.exports=api;else root.NexusNeuralAudio=api;
})(typeof window==='object'?window:globalThis);
