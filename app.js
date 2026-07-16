(() => {
"use strict";
const cfg=window.CHAT_CONFIG,$=id=>document.getElementById(id);
const ui={
setup:$("setupScreen"),chat:$("chatScreen"),joinForm:$("joinForm"),code:$("inviteCode"),joinError:$("joinError"),
conn:$("connectionStatus"),presence:$("presenceStatus"),messages:$("messages"),empty:$("emptyState"),
form:$("messageForm"),input:$("messageInput"),send:$("sendButton"),file:$("fileInput"),camera:$("cameraInput"),
attach:$("attachButton"),cameraBtn:$("cameraButton"),voice:$("voiceButton"),emojiBtn:$("emojiButton"),
emojiPanel:$("emojiPanel"),uploadBar:$("uploadBar"),uploadName:$("uploadName"),cancelFile:$("cancelFile"),
typing:$("typingBar"),replyBar:$("replyBar"),replyName:$("replyName"),replyText:$("replyText"),cancelReply:$("cancelReply"),
searchBtn:$("searchButton"),searchPanel:$("searchPanel"),searchInput:$("searchInput"),closeSearch:$("closeSearch"),
pinnedPanel:$("pinnedPanel"),openPinned:$("openPinned"),closePinned:$("closePinned"),sound:$("soundButton"),
install:$("installButton"),logout:$("logoutButton"),drop:$("dropOverlay"),menu:$("contextMenu"),reactionPicker:$("reactionPicker"),
callBtn:$("callButton"),callModal:$("callModal"),callTitle:$("callTitle"),callState:$("callState"),
acceptCall:$("acceptCall"),muteCall:$("muteCall"),endCall:$("endCall"),remoteAudio:$("remoteAudio"),toast:$("toast")
};
let db,me,otherMember,messages=[],reactions=[],selectedFile=null,replyTo=null,selectedMessage=null;
let channel,callChannel,deferredInstall,soundEnabled=localStorage.getItem("chatSound")!=="off";
let mediaRecorder,audioChunks=[],typingTimer,typingSent=false,toastTimer;
let pc,localStream,pendingOffer,currentCallTarget,muted=false;
const emojis=["😀","😂","🥰","😍","😊","😉","😎","😭","😡","👍","👎","❤️","🔥","🎉","🤔","😴","🙈","🙏","💯","✨","😘","🤝","👌","😅","🤣","😇","🥳","😜","🤍","💙","💜","🫶","👀","😱","🤦","🙃","😏","🤗","💬","📷"];
const quickReactions=["❤️","👍","😂","😮","😢","🔥"];

function okConfig(){return cfg?.supabaseUrl?.startsWith("https://")&&!cfg.supabaseUrl.includes("PASTE_")&&cfg.supabaseKey&&!cfg.supabaseKey.includes("PASTE_")}
function toast(t){ui.toast.textContent=t;ui.toast.classList.remove("hidden");clearTimeout(toastTimer);toastTimer=setTimeout(()=>ui.toast.classList.add("hidden"),3000)}
function bytes(n){if(!Number.isFinite(n))return"";let u=["Б","КБ","МБ","ГБ"],i=0;while(n>=1024&&i<3){n/=1024;i++}return`${n.toFixed(i?1:0)} ${u[i]}`}
function time(v){return new Intl.DateTimeFormat("ru-RU",{hour:"2-digit",minute:"2-digit"}).format(new Date(v))}
function safeName(n){const p=n.lastIndexOf("."),e=p>=0?n.slice(p).replace(/[^a-zA-Z0-9.]/g,""):"";return`${crypto.randomUUID()}${e.slice(0,12)}`}
function scrollBottom(){requestAnimationFrame(()=>ui.messages.scrollTop=ui.messages.scrollHeight)}
function setBusy(v){[ui.input,ui.send,ui.attach,ui.cameraBtn,ui.voice,ui.emojiBtn].forEach(x=>x.disabled=v)}
function notifySound(){if(!soundEnabled)return;try{const C=window.AudioContext||window.webkitAudioContext,c=new C,o=c.createOscillator(),g=c.createGain();o.frequency.value=760;g.gain.value=.035;o.connect(g);g.connect(c.destination);o.start();g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.22);o.stop(c.currentTime+.23)}catch{}}
function updateSound(){ui.sound.textContent=soundEnabled?"🔔":"🔕"}
async function signed(path){if(!path)return null;const{data,error}=await db.storage.from("chat-files").createSignedUrl(path,3600);return error?null:data.signedUrl}
function messageById(id){return messages.find(m=>m.id===id)}
function groupedReactions(id){const map=new Map();reactions.filter(r=>r.message_id===id).forEach(r=>{const a=map.get(r.emoji)||[];a.push(r.user_id);map.set(r.emoji,a)});return map}
function readState(m){if(m.sender_id!==me.user_id||!otherMember)return"";return new Date(otherMember.last_read_at)>=new Date(m.created_at)?"✓✓":"✓"}
async function bubble(m){
 const row=document.createElement("div");row.className=`message-row ${m.sender_id===me.user_id?"mine":"theirs"}`;row.dataset.id=m.id;
 const b=document.createElement("div");b.className="bubble";
 const sender=document.createElement("span");sender.className="sender";sender.textContent=m.sender_name||"Собеседник";b.append(sender);
 if(m.reply_to){const original=messageById(m.reply_to),rp=document.createElement("div");rp.className="reply-preview";rp.innerHTML=`<strong>${original?.sender_name||"Сообщение"}</strong><span></span>`;rp.querySelector("span").textContent=original?.deleted_at?"Удалено":(original?.body||original?.file_name||"Вложение");rp.onclick=()=>focusMessage(m.reply_to);b.append(rp)}
 if(m.deleted_at){const t=document.createElement("div");t.className="message-text";t.textContent="Сообщение удалено";t.style.fontStyle="italic";t.style.opacity=".65";b.append(t)}
 else{
  if(m.file_path){const url=await signed(m.file_path),a=document.createElement("a");a.className="attachment";a.href=url||"#";a.target="_blank";a.rel="noopener";
   if(url&&m.file_type?.startsWith("image/")){const x=document.createElement("img");x.src=url;x.loading="lazy";a.append(x)}
   else if(url&&m.file_type?.startsWith("video/")){const x=document.createElement("video");x.src=url;x.controls=true;a.append(x)}
   else if(url&&m.file_type?.startsWith("audio/")){const x=document.createElement("audio");x.src=url;x.controls=true;a.append(x)}
   else{const c=document.createElement("div");c.className="file-card";c.innerHTML=`<span class="file-icon">📄</span><span class="file-info"><span class="file-name"></span><span class="file-size">${bytes(m.file_size)}</span></span>`;c.querySelector(".file-name").textContent=m.file_name||"Файл";a.append(c)}
   b.append(a)}
  if(m.body){const t=document.createElement("div");t.className="message-text";t.textContent=m.body;b.append(t)}
 }
 const meta=document.createElement("div");meta.className="message-meta";
 if(m.pinned_at){const p=document.createElement("span");p.className="pinned-mark";p.textContent="📌";meta.append(p)}
 if(m.edited_at&&!m.deleted_at){const e=document.createElement("span");e.className="edited";e.textContent="изменено";meta.append(e)}
 const tm=document.createElement("span");tm.className="message-time";tm.textContent=time(m.created_at);meta.append(tm);
 const rs=document.createElement("span");rs.className="read-state";rs.textContent=readState(m);meta.append(rs);b.append(meta);
 const gr=groupedReactions(m.id);if(gr.size){const box=document.createElement("div");box.className="reactions";gr.forEach((users,emoji)=>{const bt=document.createElement("button");bt.className="reaction"+(users.includes(me.user_id)?" mine-reaction":"");bt.textContent=`${emoji} ${users.length}`;bt.onclick=e=>{e.stopPropagation();toggleReaction(m.id,emoji)};box.append(bt)});b.append(box)}
 b.addEventListener("contextmenu",e=>{e.preventDefault();openMenu(e.clientX,e.clientY,m)});
 let sx=0;b.addEventListener("touchstart",e=>sx=e.touches[0].clientX,{passive:true});b.addEventListener("touchend",e=>{if(e.changedTouches[0].clientX-sx>65)setReply(m)});
 row.append(b);return row
}
async function render(filter=""){ui.messages.querySelectorAll(".message-row").forEach(n=>n.remove());const list=messages.filter(m=>!filter||`${m.body||""} ${m.file_name||""}`.toLowerCase().includes(filter.toLowerCase()));ui.empty.classList.toggle("hidden",list.length>0);for(const m of list)ui.messages.append(await bubble(m));if(!filter)scrollBottom();showPinned()}
async function load(){
 const [{data:ms,error},{data:extra,error:ee}]=await Promise.all([
  db.from("chat_messages").select("*").eq("room_id",cfg.roomId).order("created_at").limit(500),
  db.rpc("get_chat_data",{p_room_id:cfg.roomId})
 ]);if(error)throw error;if(ee)throw ee;messages=ms||[];reactions=extra?.reactions||[];
 const members=extra?.members||[];otherMember=members.find(x=>x.user_id!==me.user_id)||null;await render();await markRead()
}
function showPinned(){const p=[...messages].reverse().find(m=>m.pinned_at&&!m.deleted_at);ui.pinnedPanel.classList.toggle("hidden",!p);if(p){ui.openPinned.dataset.id=p.id;ui.openPinned.textContent=p.body||p.file_name||"Закреплённое сообщение"}}
function focusMessage(id){const n=ui.messages.querySelector(`[data-id="${CSS.escape(id)}"]`);if(!n)return;n.scrollIntoView({behavior:"smooth",block:"center"});n.classList.add("highlight");setTimeout(()=>n.classList.remove("highlight"),1500)}
async function membership(){const{data,error}=await db.rpc("get_my_chat_membership",{p_room_id:cfg.roomId});if(error)throw error;return data?.[0]||null}
async function enter(){me=await membership();if(!me)return false;ui.setup.classList.add("hidden");ui.chat.classList.remove("hidden");await load();subscribe();subscribeCalls();ui.input.focus();return true}
async function session(){const{data}=await db.auth.getSession();if(data.session)return;const{error}=await db.auth.signInAnonymously();if(error)throw error}
async function upload(f){if(f.size>(cfg.maxFileSizeMb||50)*1048576)throw new Error(`Файл больше ${cfg.maxFileSizeMb||50} МБ`);const path=`${cfg.roomId}/${me.user_id}/${safeName(f.name)}`;const{error}=await db.storage.from("chat-files").upload(path,f,{contentType:f.type||"application/octet-stream",upsert:false});if(error)throw error;return path}
async function send(){
 const body=ui.input.value.trim();if(!body&&!selectedFile)return;setBusy(true);let path=null;
 try{if(selectedFile)path=await upload(selectedFile);const{error}=await db.from("chat_messages").insert({room_id:cfg.roomId,body:body||null,file_path:path,file_name:selectedFile?.name||null,file_type:selectedFile?.type||null,file_size:selectedFile?.size||null,reply_to:replyTo?.id||null});if(error)throw error;ui.input.value="";clearFile();clearReply()}
 catch(e){toast(e.message||"Ошибка отправки");if(path)await db.storage.from("chat-files").remove([path]).catch(()=>{})}finally{setBusy(false)}
}
function chooseFile(f){selectedFile=f||null;if(f){ui.uploadName.textContent=`${f.name} · ${bytes(f.size)}`;ui.uploadBar.classList.remove("hidden")}else clearFile()}
function clearFile(){selectedFile=null;ui.file.value="";ui.camera.value="";ui.uploadBar.classList.add("hidden")}
function setReply(m){if(m.deleted_at)return;replyTo=m;ui.replyName.textContent=m.sender_name;ui.replyText.textContent=m.body||m.file_name||"Вложение";ui.replyBar.classList.remove("hidden");ui.input.focus()}
function clearReply(){replyTo=null;ui.replyBar.classList.add("hidden")}
async function toggleReaction(id,emoji){const exists=reactions.find(r=>r.message_id===id&&r.user_id===me.user_id&&r.emoji===emoji);if(exists)await db.from("chat_reactions").delete().eq("message_id",id).eq("user_id",me.user_id).eq("emoji",emoji);else await db.from("chat_reactions").insert({message_id:id,emoji})}
function openMenu(x,y,m){selectedMessage=m;ui.menu.style.left=`${Math.min(x,innerWidth-185)}px`;ui.menu.style.top=`${Math.min(y,innerHeight-235)}px`;ui.menu.classList.remove("hidden");ui.menu.querySelector('[data-action="edit"]').classList.toggle("hidden",m.sender_id!==me.user_id||m.deleted_at);ui.menu.querySelector('[data-action="delete"]').classList.toggle("hidden",m.sender_id!==me.user_id||m.deleted_at)}
function closeMenus(){ui.menu.classList.add("hidden");ui.reactionPicker.classList.add("hidden")}
async function menuAction(a){const m=selectedMessage;closeMenus();if(!m)return;if(a==="reply")setReply(m);if(a==="react")openReactions(m);if(a==="pin")await db.from("chat_messages").update({pinned_at:m.pinned_at?null:new Date().toISOString(),pinned_by:m.pinned_at?null:me.user_id}).eq("id",m.id);if(a==="edit"){const v=prompt("Измени сообщение:",m.body||"");if(v!==null&&v.trim())await db.from("chat_messages").update({body:v.trim(),edited_at:new Date().toISOString()}).eq("id",m.id)}if(a==="delete"&&confirm("Удалить сообщение?"))await db.from("chat_messages").update({body:null,file_path:null,file_name:null,file_type:null,file_size:null,deleted_at:new Date().toISOString()}).eq("id",m.id)}
function openReactions(m){selectedMessage=m;ui.reactionPicker.innerHTML="";quickReactions.forEach(e=>{const b=document.createElement("button");b.textContent=e;b.onclick=()=>{toggleReaction(m.id,e);closeMenus()};ui.reactionPicker.append(b)});ui.reactionPicker.style.left="50%";ui.reactionPicker.style.bottom="90px";ui.reactionPicker.style.transform="translateX(-50%)";ui.reactionPicker.classList.remove("hidden")}
async function markRead(){await db.rpc("mark_chat_read",{p_room_id:cfg.roomId}).catch(()=>{})}
function subscribe(){
 channel=db.channel(`room-${cfg.roomId}`,{config:{presence:{key:me.user_id}}})
 .on("presence",{event:"sync"},()=>{const s=channel.presenceState();ui.presence.textContent=Object.keys(s).some(k=>k!==me.user_id)?"собеседник в сети":"собеседник не в сети"})
 .on("broadcast",{event:"typing"},({payload})=>{if(payload.user_id!==me.user_id){ui.typing.classList.remove("hidden");clearTimeout(ui.typing._t);ui.typing._t=setTimeout(()=>ui.typing.classList.add("hidden"),1800)}})
 .on("postgres_changes",{event:"*",schema:"public",table:"chat_messages",filter:`room_id=eq.${cfg.roomId}`},async p=>{if(p.eventType==="INSERT"){messages.push(p.new);await render();if(p.new.sender_id!==me.user_id){notifySound();markRead()}}else{const i=messages.findIndex(m=>m.id===p.new.id);if(i>=0)messages[i]=p.new;await render(ui.searchInput.value)}})
 .on("postgres_changes",{event:"*",schema:"public",table:"chat_reactions"},async()=>{const{data}=await db.rpc("get_chat_data",{p_room_id:cfg.roomId});reactions=data?.reactions||[];otherMember=(data?.members||[]).find(x=>x.user_id!==me.user_id)||otherMember;await render(ui.searchInput.value)})
 .on("postgres_changes",{event:"UPDATE",schema:"public",table:"chat_members",filter:`room_id=eq.${cfg.roomId}`},async p=>{if(p.new.user_id!==me.user_id){otherMember=p.new;await render(ui.searchInput.value)}})
 .subscribe(async status=>{ui.conn.textContent=status==="SUBSCRIBED"?"В сети":"Подключение…";if(status==="SUBSCRIBED")await channel.track({name:me.display_name,online_at:new Date().toISOString()})})
}
function sendTyping(){if(typingSent)return;typingSent=true;channel?.send({type:"broadcast",event:"typing",payload:{user_id:me.user_id}});clearTimeout(typingTimer);typingTimer=setTimeout(()=>typingSent=false,900)}
async function startVoice(){if(mediaRecorder?.state==="recording"){mediaRecorder.stop();return}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});audioChunks=[];mediaRecorder=new MediaRecorder(stream);mediaRecorder.ondataavailable=e=>audioChunks.push(e.data);mediaRecorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(audioChunks,{type:mediaRecorder.mimeType||"audio/webm"});chooseFile(new File([blob],`voice-${Date.now()}.webm`,{type:blob.type}));ui.voice.classList.remove("voice-recording");ui.voice.textContent="🎙️"};mediaRecorder.start();ui.voice.classList.add("voice-recording");ui.voice.textContent="⏹"}catch{toast("Нет доступа к микрофону")}}
function setupEmoji(){emojis.forEach(e=>{const b=document.createElement("button");b.type="button";b.textContent=e;b.onclick=()=>{ui.input.setRangeText(e,ui.input.selectionStart,ui.input.selectionEnd,"end");ui.input.focus()};ui.emojiPanel.append(b)})}
function setupDrop(){let c=0;document.addEventListener("dragenter",e=>{if(e.dataTransfer?.types?.includes("Files")){c++;ui.drop.classList.remove("hidden")}});document.addEventListener("dragleave",()=>{if(--c<=0){c=0;ui.drop.classList.add("hidden")}});document.addEventListener("dragover",e=>e.preventDefault());document.addEventListener("drop",e=>{if(e.dataTransfer?.files?.length){e.preventDefault();c=0;ui.drop.classList.add("hidden");chooseFile(e.dataTransfer.files[0])}})}
// Calls
function rtc(){return new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]})}
async function sendSignal(type,payload,target=currentCallTarget){await db.from("chat_signals").insert({room_id:cfg.roomId,target_id:target,signal_type:type,payload})}
async function preparePC(target){currentCallTarget=target;pc=rtc();localStream=await navigator.mediaDevices.getUserMedia({audio:true});localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));pc.ontrack=e=>ui.remoteAudio.srcObject=e.streams[0];pc.onicecandidate=e=>{if(e.candidate)sendSignal("ice",e.candidate.toJSON(),target)};pc.onconnectionstatechange=()=>{ui.callState.textContent=pc.connectionState;if(["failed","closed","disconnected"].includes(pc.connectionState))finishCall(false)}}
async function startCall(){if(!otherMember)return toast("Собеседник ещё не входил");try{ui.callModal.classList.remove("hidden");ui.callTitle.textContent="Исходящий звонок";ui.callState.textContent="Ожидание ответа…";await preparePC(otherMember.user_id);const offer=await pc.createOffer();await pc.setLocalDescription(offer);await sendSignal("ring",{},otherMember.user_id);await sendSignal("offer",offer,otherMember.user_id)}catch(e){toast("Не удалось начать звонок");finishCall(false)}}
async function accept(){ui.acceptCall.classList.add("hidden");ui.callState.textContent="Подключение…";await preparePC(pendingOffer.sender_id);await pc.setRemoteDescription(pendingOffer.payload);const ans=await pc.createAnswer();await pc.setLocalDescription(ans);await sendSignal("answer",ans,pendingOffer.sender_id);pendingOffer=null}
async function handleSignal(s){if(s.sender_id===me.user_id)return;if(s.signal_type==="ring"){ui.callModal.classList.remove("hidden");ui.callTitle.textContent="Входящий звонок";ui.callState.textContent="Собеседник звонит";ui.acceptCall.classList.remove("hidden");currentCallTarget=s.sender_id}
 if(s.signal_type==="offer"){pendingOffer=s;if(!ui.acceptCall.classList.contains("hidden"))return;await accept()}
 if(s.signal_type==="answer"&&pc)await pc.setRemoteDescription(s.payload)
 if(s.signal_type==="ice"&&pc)try{await pc.addIceCandidate(s.payload)}catch{}
 if(s.signal_type==="hangup")finishCall(false)}
function subscribeCalls(){callChannel=db.channel(`signals-${cfg.roomId}`).on("postgres_changes",{event:"INSERT",schema:"public",table:"chat_signals",filter:`room_id=eq.${cfg.roomId}`},p=>handleSignal(p.new)).subscribe()}
async function finishCall(send=true){if(send&&currentCallTarget)await sendSignal("hangup",{},currentCallTarget).catch(()=>{});pc?.close();localStream?.getTracks().forEach(t=>t.stop());pc=null;localStream=null;pendingOffer=null;currentCallTarget=null;ui.callModal.classList.add("hidden");ui.acceptCall.classList.add("hidden")}
ui.joinForm.onsubmit=async e=>{e.preventDefault();ui.joinError.textContent="";try{await session();const{data,error}=await db.rpc("join_private_chat",{p_room_id:cfg.roomId,p_invite_code:ui.code.value.trim()});if(error)throw error;if(!data)throw new Error("Неверный или использованный код");await enter()}catch(x){ui.joinError.textContent=x.message||"Ошибка входа"}}
ui.form.onsubmit=e=>{e.preventDefault();send()};ui.input.oninput=()=>{ui.input.style.height="auto";ui.input.style.height=`${Math.min(ui.input.scrollHeight,130)}px`;sendTyping()};ui.input.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}}
ui.attach.onclick=()=>ui.file.click();ui.cameraBtn.onclick=()=>ui.camera.click();ui.file.onchange=()=>chooseFile(ui.file.files[0]);ui.camera.onchange=()=>chooseFile(ui.camera.files[0]);ui.cancelFile.onclick=clearFile;ui.voice.onclick=startVoice;ui.emojiBtn.onclick=()=>ui.emojiPanel.classList.toggle("hidden");ui.cancelReply.onclick=clearReply;
ui.searchBtn.onclick=()=>{ui.searchPanel.classList.toggle("hidden");ui.searchInput.focus()};ui.closeSearch.onclick=()=>{ui.searchPanel.classList.add("hidden");ui.searchInput.value="";render()};ui.searchInput.oninput=()=>render(ui.searchInput.value);
ui.openPinned.onclick=()=>focusMessage(ui.openPinned.dataset.id);ui.closePinned.onclick=()=>ui.pinnedPanel.classList.add("hidden");
ui.sound.onclick=()=>{soundEnabled=!soundEnabled;localStorage.setItem("chatSound",soundEnabled?"on":"off");updateSound()};
ui.logout.onclick=async()=>{if(confirm("Выйти? Одноразовый код повторно не сработает.")){await db.auth.signOut();location.reload()}};
ui.menu.onclick=e=>{const a=e.target.dataset.action;if(a)menuAction(a)};document.addEventListener("click",e=>{if(!ui.menu.contains(e.target)&&!ui.reactionPicker.contains(e.target))closeMenus()});
ui.callBtn.onclick=startCall;ui.acceptCall.onclick=accept;ui.endCall.onclick=()=>finishCall(true);ui.muteCall.onclick=()=>{muted=!muted;localStream?.getAudioTracks().forEach(t=>t.enabled=!muted);ui.muteCall.textContent=muted?"🔇":"🎤"};
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;ui.install.classList.remove("hidden")});ui.install.onclick=async()=>{await deferredInstall?.prompt();deferredInstall=null;ui.install.classList.add("hidden")};
async function start(){setupEmoji();setupDrop();updateSound();if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});if(!okConfig()){ui.joinError.textContent="Проверь config.js";return}db=supabase.createClient(cfg.supabaseUrl,cfg.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});const{data}=await db.auth.getSession();if(data.session&&await enter())return}
start();
})();