/* Water-help voice guide with resident-approved action drafts.
 * Real audio in both directions. No long-lived key, recording or transcript storage.
 */
(() => {
 'use strict';
 let disposeCurrent=()=>{},focusCurrent=()=>{};
 const el=(tag,copy,cls)=>{const e=document.createElement(tag);if(copy)e.textContent=copy;if(cls)e.className=cls;return e;};
 const button=(copy,cls)=>{const b=el('button',copy,cls);b.type='button';return b;};
 function mount(parent,data){
  disposeCurrent();
  if(!data.voice_token)return;
  const box=el('section',null,'water-voice');box.setAttribute('aria-labelledby','water-voice-title');
  const top=el('div',null,'voice-top'),orb=el('span','◉','voice-orb');orb.setAttribute('aria-hidden','true');
  const heading=el('div');heading.append(el('p','LET’S TALK IT THROUGH','voice-kicker'));
  const title=el('h2','Let’s work out your next step.');title.id='water-voice-title';heading.append(title,el('p','Talk about your results, testing costs, renting, unanswered requests, or helping neighbors. Your AI guide can prepare the next step with you. No typing needed.','voice-intro'));top.append(orb,heading);
  const consent=el('div',null,'voice-consent');
  consent.append(el('p','Your microphone audio, water findings, and public help options go to Google Gemini. Google may use them to improve its products, including human review. We do not send your street address or save the conversation.'));
  const terms=el('a','How Google uses this data');terms.href='https://ai.google.dev/gemini-api/terms#unpaid-services';terms.target='_blank';terms.rel='noopener noreferrer';consent.append(terms);
  const checkLabel=el('label',null,'voice-check'),check=document.createElement('input');check.type='checkbox';checkLabel.append(check,el('span','I’m 18 or older, using this from the United States, and agree to share audio and water findings with Google for this call.'));consent.append(checkLabel);
  const actions=el('div',null,'voice-actions'),start=button('Start voice call','voice-start'),mute=button('Mute microphone','voice-secondary'),end=button('End call','voice-end'),next=button('Show next steps ↓','voice-secondary');
  start.disabled=true;mute.hidden=end.hidden=true;actions.append(start,mute,end,next);
  const status=el('p','Up to 3 minutes per call.','voice-status');status.setAttribute('role','status');
  const captions=el('details',null,'voice-captions'),log=el('div',null,'voice-log');captions.append(el('summary','Show conversation captions'),log);
  box.append(top,consent,actions,status,captions,el('p','AI can make mistakes. These are public records, not a test of your own water.','voice-note'));parent.append(box);
  let selectedLane=null;
  let stream=null,ctx=null,source=null,processor=null,silent=null,socket=null,stopped=true,muted=false,ready=false,activeNodes=new Set(),playAt=0,clock=null,deadline=0,attempt=0,lastSpeaker='',captionRow=null,lastTurn=true;
  const stopAudio=()=>{for(const n of activeNodes){try{n.stop();}catch{}}activeNodes.clear();playAt=ctx?.currentTime||0;};
  function stop(message='Call ended. Your results and next steps are still here.'){
   stopped=true;attempt++;ready=false;clearInterval(clock);stream?.getTracks().forEach(t=>t.stop());stream=null;processor?.disconnect();source?.disconnect();silent?.disconnect();processor=source=silent=null;stopAudio();if(ctx){ctx.close().catch(()=>{});ctx=null;}if(socket){const old=socket;socket=null;try{if(old.readyState===WebSocket.OPEN)old.send(JSON.stringify({type:'end'}));old.close();}catch{}}mute.hidden=end.hidden=true;start.hidden=false;start.disabled=!check.checked;start.textContent='Start voice call';consent.hidden=false;box.classList.remove('is-live');status.textContent=message;
  }
  function play(data,rate){
   if(!ctx||stopped)return;const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));if(bytes.length%2)return;const view=new DataView(bytes.buffer),samples=new Float32Array(bytes.length/2);for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(i*2,true)/32768;
   if(playAt-ctx.currentTime>20){stop('Audio could not keep up. Please try another call.');return;}
   const audio=ctx.createBuffer(1,samples.length,rate),node=ctx.createBufferSource();audio.copyToChannel(samples,0);node.buffer=audio;node.connect(ctx.destination);activeNodes.add(node);node.onended=()=>activeNodes.delete(node);playAt=Math.max(playAt,ctx.currentTime+.02);node.start(playAt);playAt+=audio.duration;
  }
  function caption(speaker,copy){if(lastSpeaker!==speaker||lastTurn||!captionRow){captionRow=el('p');captionRow.append(el('strong',speaker+': '),el('span'));log.append(captionRow);lastSpeaker=speaker;lastTurn=false;}const span=captionRow.lastElementChild;span.textContent=(span.textContent+copy).slice(-6000);while(log.children.length>40)log.firstElementChild.remove();log.scrollTop=log.scrollHeight;}
  check.addEventListener('change',()=>{start.disabled=!check.checked;});
  next.addEventListener('click',()=>{const target=document.querySelector('#water-action-help')||document.querySelector('.access-plan')||document.querySelector('.what-now');if(target){target.scrollIntoView({behavior:'smooth',block:'start'});target.setAttribute('tabindex','-1');target.focus({preventScroll:true});}});
  end.addEventListener('click',()=>stop());
  mute.addEventListener('click',()=>{muted=!muted;stream?.getAudioTracks().forEach(t=>{t.enabled=!muted;});mute.textContent=muted?'Unmute microphone':'Mute microphone';mute.setAttribute('aria-pressed',String(muted));if(muted&&socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'mute'}));});
  start.addEventListener('click',async()=>{
   if(!check.checked||!stopped)return;
   if(!navigator.mediaDevices?.getUserMedia||!(window.AudioContext||window.webkitAudioContext)){status.textContent='This browser does not support voice calls. Try an updated Chrome, Safari, Firefox or Edge browser.';return;}
   stopped=false;const current=++attempt;muted=false;start.disabled=true;start.hidden=true;end.hidden=false;consent.hidden=true;status.textContent='Allow microphone access to start your call…';log.replaceChildren();lastSpeaker='';captionRow=null;
   try{
    ctx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000});await ctx.resume();if(stopped||current!==attempt)return;
    const acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    if(stopped||current!==attempt){acquired.getTracks().forEach(t=>t.stop());return;}stream=acquired;
    await ctx.audioWorklet.addModule('/water-voice-worklet.js?v=2');if(stopped||current!==attempt)return;
    source=ctx.createMediaStreamSource(stream);processor=new AudioWorkletNode(ctx,'water-mic');silent=ctx.createGain();silent.gain.value=0;source.connect(processor);processor.connect(silent);silent.connect(ctx.destination);
    socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/api/national/voice');
    const ws=socket;status.textContent='Connecting your AI water-help guide…';
    processor.port.onmessage=event=>{if(ready&&!stopped&&!muted&&ws.readyState===WebSocket.OPEN){if(ws.bufferedAmount>131072){stop('Your connection is too slow for a voice call. Please try again.');return;}ws.send(event.data);}};
    ws.onopen=()=>{if(stopped||current!==attempt)return;ws.send(JSON.stringify({type:'start',token:data.voice_token,consent:true,lane:selectedLane}));};
    ws.onmessage=event=>{if(stopped||current!==attempt)return;let m;try{m=JSON.parse(event.data);}catch{return stop('The voice connection was interrupted.');}
     if(m.type==='ready'){ready=true;mute.hidden=false;mute.textContent='Mute microphone';mute.setAttribute('aria-pressed','false');box.classList.add('is-live');deadline=Date.now()+m.seconds*1000;const tick=()=>{const left=Math.max(0,Math.ceil((deadline-Date.now())/1000));status.textContent=(muted?'Microphone muted':'Call connected — speak naturally')+' · '+Math.floor(left/60)+':'+String(left%60).padStart(2,'0')+' left';if(!left)stop('Your three-minute call has ended. Choose Show next steps for testing options and potential savings.');};tick();clock=setInterval(tick,500);}
     else if(m.type==='audio')play(m.data,m.rate);
     else if(m.type==='action')window.WaterActions?.present(m.action);
     else if(m.type==='caption')caption(m.speaker,m.text);
     else if(m.type==='interrupted'){stopAudio();lastTurn=true;}
     else if(m.type==='turn-complete')lastTurn=true;
     else if(m.type==='ended')stop(m.message);
    };
    ws.onerror=()=>{if(!stopped&&current===attempt&&socket===ws)stop('The call could not connect. Please try again.');};
    ws.onclose=()=>{if(!stopped&&current===attempt&&socket===ws)stop('The voice connection ended. Your results are still here. Please try again later.');};
   }catch(error){if(current!==attempt)return;stop(error.name==='NotAllowedError'?'Microphone access was not allowed. Enable it in your browser to use the voice guide.':'The microphone could not start. Check that it is connected and try again.');}
  });
  focusCurrent=lane=>{selectedLane=lane;if(ready&&socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'focus',lane}));else {box.scrollIntoView({behavior:'smooth',block:'start'});status.textContent='Ready to help with this. Agree above, then start your call.';}};
  const exit=()=>stop();window.addEventListener('pagehide',exit);
  disposeCurrent=()=>{stop();window.removeEventListener('pagehide',exit);};
 }
 window.WaterVoice={mount,stop:()=>disposeCurrent(),focusLane:lane=>focusCurrent(lane)};
})();
