const $ = id => document.getElementById(id);
let mode='region', preset='balanced', crop=null, state='idle', sources=[], recorder, stream, timer, started, writeQueue=Promise.resolve(), writeError=null, requestVersion=0;
let surface=new URLSearchParams(location.search).get('surface')==='toolbar'?'toolbar':'studio', choosing=false;
let flowResult=false, saveInProgress=false, savedDestination=null;
const message = text => { $('message').textContent=text; $('message').hidden=!text; };
function applySurface(next) {
  surface=next;
  document.body.classList.toggle('surface-toolbar',next==='toolbar');
  document.body.classList.toggle('surface-studio',next!=='toolbar');
  document.body.classList.toggle('result-view',next==='result'||next==='studio'&&flowResult);
  document.documentElement.classList.toggle('toolbar-root',next==='toolbar');
  syncToolbar();
}
async function changeSurface(next) {
  applySurface(next);
  await window.clip.surface(next);
}
function syncToolbar() {
  const needsSelection=mode==='region'&&!crop;
  const labels={idle:needsSelection?'选择区域':'录制',starting:$('record-label').textContent,recording:'停止',stopping:'停止中',converting:'转换中',saving:'保存中'};
  const source=sources.find(item=>item.id===$('sources').value);
  window.dispatchEvent(new CustomEvent('luma-state',{detail:{mode,preset,targetMB:$('target').checked?8:0,state:choosing?'starting':state,needsSelection,canSelect:!choosing&&state==='idle'&&sources.length>0,canRecord:!choosing&&!$('record').disabled,label:choosing?'选择中':labels[state],phaseLabel:state==='idle'?(needsSelection?'1 · 先选择录制区域':'2 · 已确认，点击录制'):'',selection:state==='recording'?$('status').textContent:needsSelection?'拖动框选后确认，再开始录制':`${source?.name||'请选择录制来源'}${mode==='region'&&crop?' · 区域已选':''}`,error:$('message').hidden?'':$('message').textContent}}));
}
function readyToRecord() {
  return !!sources.find(source=>source.id===$('sources').value) && (mode!=='region'||!!crop);
}
function updateReadiness() {
  if(state!=='idle')return;
  $('record').disabled=choosing||!readyToRecord();
  $('record-label').textContent='开始录制';
  $('status').textContent=readyToRecord()?'区域或来源已确认，可以开始录制':'先框选并确认屏幕区域';
  syncToolbar();
}
function setFlowStage(stage) {
  document.body.dataset.flowStage=stage;
  $('flow-caption').textContent={convert:'3 / 停止录制，自动生成 GIF',save:'4 / GIF 已生成，选择本地保存位置',done:'已保存到本地'}[stage]||'';
}
applySurface(surface);
window.clip.on('surface-state',applySurface);
const toolbarObserver=new MutationObserver(syncToolbar);
['record','status','selection-note','message','preset-summary'].forEach(id=>toolbarObserver.observe($(id),{attributes:true,childList:true,subtree:true,characterData:true}));
async function chooseSource() {
  if(!sources.length)return;
  let id;
  try {id=await window.clip.pickSource({mode,selected:$('sources').value});}
  catch(error) {$('sources').selectedIndex=-1;updateSource();throw error;}
  if(!id){$('sources').selectedIndex=-1;updateSource();message('已取消选择。点击录制模式图标重新选择来源。');return false;}
  if(!sources.some(s=>s.id===id))await loadSources();
  $('sources').value=id;updateSource();return true;
}
async function toolbarAction(action) {
  if(choosing)return;
  if(action.type==='record'){if(!$('record').disabled)$('record').click();return;}
  if(action.type==='close'){await window.clip.close();return;}
  if(state!=='idle')return;
  try {
    if(action.type==='details') {if(surface==='toolbar'&&$('result').hidden){await toolbarAction({type:mode==='region'?'select-region':'pick-source'});return;}showTab('files');await changeSurface('result');return;}
    if(action.type==='options'){await window.clip.options({mode,preset,targetMB:$('target').checked?8:0});return;}
    if(action.type==='preset'){document.querySelector(`[data-preset="${action.preset}"]`)?.click();return;}
    if(action.type==='target'){$('target').checked=!!action.checked;updateSummary();return;}
    choosing=true;syncToolbar();
    if(action.type==='select-region') {
      const previousMode=mode;
      mode='region';document.querySelectorAll('[data-mode]').forEach(button=>button.classList.toggle('selected',button.dataset.mode===mode));
      if(previousMode==='window'||!sources.length||!$('sources').value)await loadSources();
      if(sources.length>1 && !await chooseSource())return;
      if(sources.length)await region();
    } else if(action.type==='mode' && ['screen','window','region'].includes(action.mode)) {
      mode=action.mode;
      document.querySelectorAll('[data-mode]').forEach(button=>button.classList.toggle('selected',button.dataset.mode===mode));
      await loadSources();
      if(!sources.length)return;
      if((mode==='window'||sources.length>1) && !await chooseSource())return;
      if(mode==='region')await region();
    } else if(action.type==='pick-source') {await loadSources();if(await chooseSource() && mode==='region')await region();}
    else if(action.type==='region') {if(sources.length)await region();}
  } catch(error) {message(error.message);}
  finally {choosing=false;updateReadiness();syncToolbar();}
}
window.addEventListener('luma-action',event=>toolbarAction(event.detail));
window.clip.on('toolbar-command',toolbarAction);
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&surface==='toolbar'&&state==='idle'&&!choosing)window.clip.close();});
$('compact-button').onclick=()=>changeSurface('toolbar').catch(error=>message(error.message));
$('window-minimize').onclick=()=>window.clip.minimize();
$('window-close').onclick=()=>window.clip.close();
function showTab(name, focus=false) {
  const button=document.querySelector(`[data-tab="${name}"]`);
  if(!button)return;
  document.querySelectorAll('[data-tab]').forEach(tab=>{
    const active=tab===button;
    tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
    $(tab.getAttribute('aria-controls')).hidden=!active;
  });
  if(name==='files')$('file-dot').hidden=true;
  document.querySelector('main').scrollTop=0;
  if(focus)button.focus();
}
document.querySelectorAll('[data-tab]').forEach(button=>{
  button.onclick=()=>showTab(button.dataset.tab);
  button.onkeydown=event=>{
    const names=['capture','files','settings'];let index=names.indexOf(button.dataset.tab);
    if(event.key==='ArrowRight')index=(index+1)%names.length;
    else if(event.key==='ArrowLeft')index=(index+names.length-1)%names.length;
    else if(event.key==='Home')index=0;
    else if(event.key==='End')index=names.length-1;
    else return;
    event.preventDefault();showTab(names[index],true);
  };
});
document.querySelectorAll('[data-open-tab]').forEach(button=>button.onclick=()=>showTab(button.dataset.openTab,true));
function updateSummary() {
  const info={clear:['高清细节',20,1920],balanced:['清晰均衡',15,1440],small:['轻巧分享',10,960]}[preset];
  $('preset-summary').textContent=`${info[0]} · ${info[1]} fps`;
  $('size-summary').textContent=`最多 ${info[2]} px · ${$('target').checked?'尽量小于 8 MB':'无限循环'}`;
}
$('target').onchange=updateSummary;
function busy(value) {
  document.querySelectorAll('[data-mode],[data-preset],#refresh,#sources,#target,#choose-region,#compact-button').forEach(b=>b.disabled=value);
}
function reset() {
  clearInterval(timer);stream?.getTracks().forEach(t=>t.stop());stream=null;
  state='idle';busy(false);$('record').classList.remove('stop');$('status-dot').classList.remove('recording');$('flow-new').disabled=false;updateReadiness();
}
async function loadSources() {
  const version=++requestVersion;
  $('record').disabled=true;message('');crop=null;$('crop-mark').hidden=true;
  try {
    const result=await window.clip.sources(mode==='window'?'window':'screen');
    if(version!==requestVersion)return;
    sources=result;
    $('sources').replaceChildren(...sources.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;return o;}));
    $('source-count').textContent=`${sources.length} 个可用`;
    updateSource();
    if(!sources.length)message('未发现录制来源。macOS 请在「系统设置 → 隐私与安全性 → 屏幕与系统音频录制」中允许 Luma，然后退出并重新打开软件。');
  } catch(e) { if(version!==requestVersion)return; sources=[];updateSource();message(`无法读取屏幕：${e.message}。请检查系统录屏权限，然后重新启动软件。`); }
}
function updateSource() {
  crop=null;$('crop-mark').hidden=true;
  const s=sources.find(s=>s.id===$('sources').value);
  if(s)$('thumbnail').src=s.thumbnail;else $('thumbnail').removeAttribute('src');
  $('preview-empty').hidden=!!s;$('choose-region').hidden=mode!=='region';
  $('selection-note').textContent=mode==='region'?'开始前，请在屏幕上拖选区域':mode==='window'?'仅捕捉所选窗口':'完整捕捉所选屏幕';
  updateReadiness();
}
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{if(state!=='idle')return;mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('selected',x===b));loadSources();});
document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{if(state!=='idle')return;preset=b.dataset.preset;document.querySelectorAll('[data-preset]').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b));});updateSummary();});
$('refresh').onclick=loadSources;$('sources').onchange=updateSource;
async function region() {
  crop=null;$('selection-note').textContent='请重新框选并确认录制区域';
  busy(true);$('record').disabled=true;
  try {
    crop=await window.clip.region($('sources').value);
    if(crop) $('selection-note').textContent=`已选区域 · 屏幕的 ${Math.round(crop.width*100)}% × ${Math.round(crop.height*100)}%`;
    return crop;
  } finally {busy(false);updateReadiness();}
}
$('choose-region').onclick=()=>region().catch(e=>message(e.message));
function stopRecording() { if(state==='recording' && recorder?.state==='recording'){state='stopping';$('record').disabled=true;clearInterval(timer);recorder.stop();} }
window.clip.on('stop-recording',stopRecording);
window.clip.on('progress',p=>{$('progress-label').textContent=p.stage;$('progress').value=p.percent;});
$('record').onclick=async()=>{
  if(state==='recording')return stopRecording();
  if(state!=='idle')return;
  message('');
  showTab('capture');
  try {
    if(!readyToRecord()){message('请先框选并确认录制区域，再点击录制。');return;}
    state='starting';busy(true);$('record').disabled=true;
    await window.clip.select($('sources').value);
    stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:30,width:{ideal:3840},height:{ideal:2160}},audio:false});
    const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
    if(!mime)throw new Error('此系统不支持 WebM 录制');
    recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:24000000});
    writeQueue=Promise.resolve();writeError=null;
    recorder.ondataavailable=e=>{if(e.data.size)writeQueue=writeQueue.then(async()=>{if(!writeError)await window.clip.chunk(new Uint8Array(await e.data.arrayBuffer()));}).catch(error=>{writeError=error;stopRecording();});};
    recorder.onstop=async()=>{
      clearInterval(timer);stream?.getTracks().forEach(t=>t.stop());stream=null;state='converting';flowResult=true;setFlowStage('convert');showTab('files');$('files-empty').hidden=true;$('flow-new').disabled=true;$('status').textContent='正在把这一刻变成 GIF';$('record-label').textContent='转换中…';$('progress-panel').hidden=false;$('progress').value=0;
      try {
        await changeSurface('result');
        await writeQueue;if(writeError)throw writeError;
        const result=await window.clip.finish();
        $('gif').src=result.url;$('result').hidden=false;$('files-empty').hidden=true;
        $('result-heading').textContent='这一刻，已变成动图。';
        $('result-meta').textContent=`${(result.size/1024/1024).toFixed(2)} MB · ${result.fps} fps · 无限循环${result.optimized?' · 已优化尺寸':''}`;
        if(!result.targetMet)message('已优化两轮，文件仍超过 8 MB。为避免继续损失清晰度，保留当前结果；可缩短录制时长或缩小录制区域。');
        showTab('files');
        $('progress-panel').hidden=true;setFlowStage('save');
        await saveGif();
      } catch(e) {await window.clip.abort();message(`转换未完成：${e.message}。可点击下方按钮保存原始录屏。`);$('result').hidden=false;$('files-empty').hidden=true;$('gif').removeAttribute('src');$('save').disabled=true;$('result-heading').textContent='原始录屏，已经留下。';$('result-meta').textContent='转换失败，原始录屏可另存。';showTab('files');}
      finally {$('progress-panel').hidden=true;reset();}
    };
    recorder.onerror=e=>{writeError=new Error(e.error?.message||'录制失败');stopRecording();};
    stream.getVideoTracks()[0].onended=stopRecording;
    for(let n=3;n>0;n--){$('record-label').textContent=`${n} 秒后开始`;$('status').textContent='准备录制，工具条即将隐藏';await new Promise(r=>setTimeout(r,1000));}
    if(stream.getVideoTracks()[0].readyState!=='live')throw new Error('录制来源已关闭，请重新选择');
    await window.clip.begin({mode,preset,crop:mode==='region'?crop:null,targetMB:$('target').checked?8:0});
    savedDestination=null;$('result').hidden=true;$('files-empty').hidden=false;$('file-dot').hidden=true;$('save').disabled=false;$('reveal').hidden=true;$('save-status').textContent='';
    recorder.start(1000);state='recording';started=Date.now();$('record').disabled=false;$('record').classList.add('stop');$('status-dot').classList.add('recording');$('record-label').textContent='停止并生成 GIF';
    timer=setInterval(()=>{const elapsed=Math.floor((Date.now()-started)/1000);$('status').textContent=`正在录制 · ${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;if(elapsed>=120)stopRecording();},250);
  } catch(e){await window.clip.abort();reset();message(`无法开始录制：${e.message}。请确认已授予屏幕录制权限。`);}
};
async function saveGif() {
  if(saveInProgress)return;
  saveInProgress=true;$('save').disabled=true;$('flow-new').disabled=true;
  if($('message').textContent.startsWith('保存失败：'))message('');
  const previousState=state;state='saving';syncToolbar();
  try {
    const destination=await window.clip.save('gif');
    if(destination){savedDestination=destination;$('save-status').textContent=`已保存：${destination}`;$('reveal').hidden=false;$('save').textContent='另存一份';setFlowStage('done');}
    else if(savedDestination){$('save-status').textContent=`已保存：${savedDestination}（本次另存已取消）`;setFlowStage('done');}
    else {$('save-status').textContent='GIF 已生成，尚未保存。点击「保存到本地」继续。';$('save').textContent='保存到本地';setFlowStage('save');}
  } catch(error) {$('save-status').textContent=savedDestination?`已保存：${savedDestination}（本次另存失败）`:'GIF 已生成，保存未完成，可以重试。';message(`保存失败：${error.message}`);setFlowStage(savedDestination?'done':'save');}
  finally {saveInProgress=false;state=previousState;$('save').disabled=false;$('flow-new').disabled=false;syncToolbar();}
}
$('save').onclick=saveGif;
$('flow-new').onclick=async()=>{
  if(state!=='idle'||saveInProgress)return;
  mode='region';crop=null;flowResult=false;message('');$('save').textContent='保存到本地';
  await changeSurface('toolbar');await loadSources();await toolbarAction({type:'select-region'});
};
$('save-source').onclick=async()=>{try{const dest=await window.clip.save('source');if(dest){message(`原始录屏已保存：${dest}`);$('reveal').hidden=false;}}catch(e){message(e.message);}};
$('reveal').onclick=()=>window.clip.reveal();
window.clip.permissions().then(p=>{if(!p.shortcut)$('shortcut').textContent='快捷键被占用，请点击菜单栏录制图标停止';});
loadSources().then(()=>{if(surface==='toolbar'&&sources.length)return toolbarAction({type:'select-region'});});
