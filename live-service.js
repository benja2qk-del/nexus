'use strict';
const {randomBytes}=require('crypto'),protocol=require('./live-protocol'),{createBrain}=require('./live-brain');
const {updateGate}=require('./public/live-core'),voice=require('./public/voice-core');
// A call is bound to one paired device and session. Heartbeats hold a short
// lease; abandoned pages cannot leave a subscription process running forever.
function createLiveService({config={},snapshot,send,tts=null,brainFactory=createBrain,clock=Date.now,onStart=async()=>{},onStop=async()=>{}}){
  const calls=new Map();let starting=false;
  async function stop(c){if(!c||c.closed)return;c.closed=true;c.audioAbort?.abort();calls.delete(c.id);await Promise.all([c.brain.close(),onStop()]);}
  const janitor=setInterval(()=>{for(const c of calls.values())if(clock()-c.seen>20000)stop(c);},5000);janitor.unref();
  async function handle(req,res,route,device,authorized){
    const json=(status,data)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}};
    let body='',c;
    try{
      for await(const chunk of req){body+=chunk;if(body.length>16000)throw Error('Voice request is too large.');}
      const data=JSON.parse(body||'{}');if(!authorized())return json(401,{error:'Pair this device again.'});
      if(route==='/api/live/start'){
        if(starting||calls.size)throw Error('Another live call is already active on this PC.');
        const state=snapshot(data.key);if(!state)throw Error('Session unavailable.');starting=true;
        let brain;try{brain=await brainFactory(config,state.session.title);await onStart();}catch(error){await brain?.close();await onStop();throw error;}finally{starting=false;}
        if(res.destroyed||!authorized()){await brain.close();await onStop();return;}
        const prior=voice.sessionPrior(),language=prior(state.chat.events);
        c={id:randomBytes(24).toString('hex'),key:data.key,device,brain,prior,language,forcedLanguage:['es','en'].includes(data.forcedLanguage)?data.forcedLanguage:null,seen:clock(),gate:updateGate(clock,12000),busy:false,closed:false,pending:null,lastContext:JSON.stringify(protocol.context(state.session,state.chat))};calls.set(c.id,c);
        return json(200,{id:c.id,backend:brain.kind,model:brain.model,language:c.forcedLanguage||language,silenceMs:Math.max(400,Math.min(2000,Number(config.liveSilenceMs)||650))});
      }
      c=calls.get(data.id);if(!c||c.device!==device)throw Error('This live call ended. Start a new call.');c.seen=clock();
      if(route==='/api/live/stop'){await stop(c);return json(200,{ok:true});}
      if(route==='/api/live/heartbeat')return json(200,{ok:true});
      if(route==='/api/live/cancel'){c.epoch=(c.epoch||0)+1;c.audioAbort?.abort();return json(200,{ok:true});}
      if(route==='/api/live/language'){
        if(!['es','en',null].includes(data.language))throw Error('Choose English or Español.');
        c.forcedLanguage=data.language;c.epoch=(c.epoch||0)+1;c.audioAbort?.abort();
        if(data.language)c.language=data.language;
        return json(200,{language:c.language,forcedLanguage:c.forcedLanguage});
      }
      if(route!=='/api/live/turn')return json(404,{error:'Unknown live call request.'});
      if(c.busy&&data.event)return json(200,{skipped:true});
      const waitUntil=clock()+5000;while(c.busy&&!c.closed&&clock()<waitUntil)await new Promise(r=>setTimeout(r,50));
      if(c.busy||c.closed)throw Error('The voice reply is still finishing. Please try again.');
      const state=snapshot(c.key);if(!state)throw Error('The called session is no longer available.');
      const context=protocol.context(state.session,state.chat),contextKey=JSON.stringify(context),event=data.event===true,owner=typeof data.text==='string'?data.text.trim().slice(0,4000):'';
      if(event&&(contextKey===c.lastContext||!c.gate.take(contextKey,{owner:data.owner===true,speaking:data.speaking===true,busy:c.busy})))return json(200,{skipped:true});
      if(!event&&!owner)throw Error('No words were heard.');
      if(event)c.lastContext=contextKey;c.busy=true;const epoch=c.epoch||0;
      c.audioAbort=new AbortController();const audioAbort=c.audioAbort;
      const valid=()=>!res.destroyed&&!c.closed&&epoch===(c.epoch||0)&&authorized()&&!audioAbort.signal.aborted;
      const emit=value=>{if(valid())res.write(JSON.stringify(value)+'\n');};
      res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.flushHeaders();
      let abandoned=false;const disconnect=()=>{if(!res.writableEnded){abandoned=true;audioAbort.abort();}};res.on('close',disconnect);
      const prior=c.prior(state.chat.events);
      if(owner)c.language=voice.turnLanguage(owner,data.recognition,prior,c.forcedLanguage);
      const es=(c.forcedLanguage||c.language)==='es';
      emit({type:'language',language:es?'es':'en',forcedLanguage:c.forcedLanguage});
      let speech=Promise.resolve(),sentenceId=0,firstAudioMs=null;const turnStarted=clock();
      const say=text=>{
        const id=sentenceId++,lang=voice.replyLanguage(text,es?'es':'en');
        emit({type:'sentence',text,id,lang,neural:!!tts});
        if(!tts)return;
        speech=speech.then(async()=>{if(!valid())return;let chunks=0;
          try{await tts.synthesize(text,lang,chunk=>{if(!valid())return;chunks++;if(firstAudioMs===null)firstAudioMs=clock()-turnStarted;emit({...chunk,type:'audio',id,lang});},{signal:audioAbort.signal});if(valid())emit({type:'audio-end',id});}
          catch(e){if(!valid())return;if(!chunks)emit({type:'speech-fallback',id,text,lang,reason:'Neural voice is warming up or unavailable. Using device speech.'});else{emit({type:'audio-end',id});emit({type:'error',message:'Voice playback was interrupted. The full reply is in the captions.'});}}
        });
      };
      try{
        let action,metrics;
        const confirmed=protocol.confirmation(owner,c.pending);
        if(confirmed&&!event){action={type:'relay',text:confirmed.text};c.pending=null;}
        else{
          // Any different owner utterance invalidates an outstanding confirmation.
          if(!event)c.pending=null;
          const parser=protocol.parser(say,text=>emit({type:'caption',text}));
          metrics=await c.brain.ask(JSON.stringify({owner:event?null:owner,event,language:es?'es':'en',instruction:es?'Responde en español latinoamericano neutro y natural.':'Reply in English.',context}),chunk=>parser.push(chunk));
          action=protocol.guard(parser.finish().action,{owner,question:context.question,signature:data.signature,event});
        }
        if(abandoned||c.closed||epoch!==(c.epoch||0)||!authorized())return;
        const latest=snapshot(c.key);if(!latest)throw Error('The session ended before the action.');
        if(action.type==='confirm'){
          c.pending={text:action.text,at:clock()};emit({type:'confirmation',text:action.text});say(es?'Para enviar esa instrucción, di confirmo.':'To send that instruction, say confirm.');
        }else if(action.type!=='status'){
          if(event)throw Error('Agent events cannot trigger actions.');
          if(action.type==='relay'&&(latest.chat.terminal?.prompt||latest.chat.terminal?.busy||!latest.chat.terminal?.ready))throw Error(es?'El agente esta ocupado. Puedes pedir que lo interrumpa.':'The agent is busy. You can ask me to interrupt it.');
          if(confirmed&&clock()-confirmed.at>30000)throw Error('That confirmation expired. Ask again.');
          await send(c.key,action,latest);
          emit({type:'action',action:action.type,text:action.text,option:action.option});
          const brief=voice.clean(action.text||'').slice(0,180);
          say(action.type==='relay'?(es?'Le envie: '+brief:'I relayed: '+brief):action.type==='answer'?(es?'Respondi la opcion '+action.option+'.':'I answered option '+action.option+'.'):(es?'Interrumpi al agente.':'I interrupted the agent.'));
        }
        await speech;
        emit({type:'done',ttftMs:metrics?.ttftMs??0,brainMs:metrics?.totalMs??0,firstAudioMs});
      }catch(e){emit({type:/Live voice is unavailable/.test(e.message)?'unavailable':'error',message:e.message});}
      finally{await speech;audioAbort.abort();c.busy=false;res.removeListener('close',disconnect);if(!res.destroyed)res.end();}
    }catch(e){json(400,{error:e.message});}
  }
  return {handle,async close(){clearInterval(janitor);await Promise.all([...calls.values()].map(stop));},get size(){return calls.size;}};
}
module.exports={createLiveService};
