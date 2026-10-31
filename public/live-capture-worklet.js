// One 20 ms PCM frame per message; independent of rendering and TTS playback.
class LiveCapture extends AudioWorkletProcessor {
  constructor(){super();this.frame=new Float32Array(Math.round(sampleRate*.02));this.used=0;}
  process(inputs){const data=inputs[0]?.[0];if(data)for(const sample of data){this.frame[this.used++]=sample;if(this.used===this.frame.length){this.port.postMessage(this.frame);this.frame=new Float32Array(this.frame.length);this.used=0;}}return true;}
}
registerProcessor('nexus-live-capture',LiveCapture);
