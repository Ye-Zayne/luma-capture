const { app, BrowserWindow, desktopCapturer, session, ipcMain, dialog, shell, globalShortcut, screen, systemPreferences, Tray, Menu, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { encode, filters } = require('./encoder.cjs');
let win, overlay, tray, selected, current, selectionResolve, studioBounds, selectionSourceId, confirmedRegion;
let selectingRegion=false, quitting=false;
let surface='toolbar';
const hasMainWindow = () => !quitting && !!win && !win.isDestroyed();
const send = (event, data) => { if (hasMainWindow() && !win.webContents.isDestroyed()) win.webContents.send(event, data); };
const show = () => { if(hasMainWindow() && !selectingRegion){win.show();win.focus();} };
const ffmpeg = () => require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
const ui = name => path.join(__dirname, name);

function cancelRegionSelection() {
  const selectionWindow=overlay;
  overlay=null;
  selectingRegion=false;
  selectionResolve?.(null);
  selectionResolve=null;
  if(selectionWindow && !selectionWindow.isDestroyed())selectionWindow.destroy();
}

function setSurface(next) {
  if(!hasMainWindow() || !['toolbar','studio','result'].includes(next))return;
  const previous=win.getBounds();
  if(surface==='studio')studioBounds=previous;
  const area=screen.getDisplayMatching(previous).workArea;
  surface=next;
  win.setMinimumSize(next==='toolbar'?680:next==='result'?800:960,next==='toolbar'?88:next==='result'?600:740);
  win.setResizable(next!=='toolbar');
  win.setAlwaysOnTop(next==='toolbar','floating');
  if(process.platform==='darwin')win.setVibrancy(next==='toolbar'?'under-window':null);
  win.setVisibleOnAllWorkspaces(next==='toolbar',{visibleOnFullScreen:next==='toolbar'});
  const width=Math.min(next==='result'?900:1120,area.width),height=Math.min(next==='result'?680:820,area.height);
  win.setBounds(next==='toolbar'?{x:Math.round(area.x+(area.width-680)/2),y:Math.round(area.y+area.height-112),width:680,height:88}:next==='studio'&&studioBounds?studioBounds:{x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+(area.height-height)/2),width,height});
  send('surface-state',next);
}
function stop() { if(current?.recording)send('stop-recording'); }
function recordingTray(active) {
  if (tray) { tray.destroy(); tray = null; }
  if (!active) return;
  // PNG is generated from a tiny RGBA bitmap for consistent tray support on both platforms.
  const bitmap = Buffer.alloc(22*22*4);
  for(let y=0;y<22;y++) for(let x=0;x<22;x++) if((x-11)**2+(y-11)**2<81) { const i=(y*22+x)*4; bitmap[i]=70;bitmap[i+1]=65;bitmap[i+2]=240;bitmap[i+3]=255; }
  tray = new Tray(nativeImage.createFromBitmap(bitmap, {width:22,height:22}));
  tray.setToolTip('Luma 正在录屏 · 点击停止');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'停止录制并转换 GIF',click:stop},{label:'显示 Luma',click:show}]));
  tray.on('click',stop);
}

app.whenReady().then(() => {
  const area=screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({width:680,height:88,x:Math.round(area.x+(area.width-680)/2),y:Math.round(area.y+area.height-112),minWidth:680,minHeight:88,show:false,frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,alwaysOnTop:true,hasShadow:true,fullscreenable:false,title:'Luma · 录屏转 GIF',...(process.platform==='darwin'?{vibrancy:'under-window',visualEffectState:'active'}:{}),webPreferences:{preload:ui('preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
  win.loadFile(ui('index.html'),{query:{surface:'toolbar'}});
  win.once('ready-to-show',show);
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('close', e => { if(!quitting && current?.busy) { e.preventDefault(); win.hide(); } });
  win.once('closed',()=>{
    win=null;
    confirmedRegion=null;
    cancelRegionSelection();
  });
  ipcMain.handle('surface',(_,next)=>setSurface(next));
  ipcMain.handle('close',()=>{if(!hasMainWindow())return;if(current?.recording)stop();else if(current?.busy)win.hide();else win.close();});
  ipcMain.handle('pick-source',async(_,data)=>{
    if(!hasMainWindow() || current?.busy)return null;
    const entries=await desktopCapturer.getSources({types:[data?.mode==='window'?'window':'screen'],thumbnailSize:{width:0,height:0}});
    if(!hasMainWindow())return null;
    const sources=entries.filter(s=>!s.name.startsWith('Luma'));
    if(sources.length===1)return sources[0].id;
    if(!sources.length)return null;
    return new Promise(resolve=>{
      const menu=Menu.buildFromTemplate(sources.map(source=>({label:source.name,type:'radio',checked:source.id===data?.selected,click:()=>resolve(source.id)})));
      menu.popup({window:win,callback:()=>resolve(null)});
    });
  });
  ipcMain.handle('options',(_,data)=>{
    if(!hasMainWindow() || current?.busy)return;
    const command=payload=>send('toolbar-command',payload);
    Menu.buildFromTemplate([
      {label:'GIF 画质',enabled:false},
      ...[['clear','高清细节 · 1920 px / 20 fps'],['balanced','清晰均衡 · 1440 px / 15 fps'],['small','轻巧分享 · 960 px / 10 fps']].map(([preset,label])=>({label,type:'radio',checked:data?.preset===preset,click:()=>command({type:'preset',preset})})),
      {type:'separator'},
      {label:'尽量小于 8 MB',type:'checkbox',checked:data?.targetMB===8,click:item=>command({type:'target',checked:item.checked})},
      {type:'separator'},
      {label:'选择录制来源…',click:()=>command({type:'pick-source'})},
      {label:'重新选择区域…',enabled:data?.mode==='region',click:()=>command({type:'region'})},
      {type:'separator'},
      {label:'查看最近的 GIF',enabled:!!current?.success,click:()=>command({type:'details'})},
      {label:'停止录制：⌘ / Ctrl + Shift + X',enabled:false}
    ]).popup({window:win});
  });
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(hasMainWindow() && wc===win.webContents && ['media','display-capture'].includes(permission)));
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if(!hasMainWindow() || request.frame !== win.webContents.mainFrame || !selected) return callback({});
      const sources = await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:0,height:0}});
      if(!hasMainWindow())return callback({});
      const source = sources.find(s=>s.id===selected);
      if (!source) return callback({});
      callback({video:source});
    } catch { callback({}); }
  });
  const shortcut = globalShortcut.register('CommandOrControl+Shift+X',stop);
  ipcMain.handle('permissions', () => ({platform:process.platform,screen:process.platform==='darwin'?systemPreferences.getMediaAccessStatus('screen'):'granted',shortcut}));
  ipcMain.handle('sources', async (_,type) => {
    const sources = await desktopCapturer.getSources({types:[type==='window'?'window':'screen'],thumbnailSize:{width:640,height:400},fetchWindowIcons:true});
    return sources.filter(s=>!s.name.startsWith('Luma')).map(s=>({id:s.id,name:s.name,displayId:s.display_id,thumbnail:s.thumbnail.toDataURL()}));
  });
  ipcMain.handle('select', (_,id) => { if(current?.busy) throw new Error('录制或转换尚未完成'); selected=id; });
  ipcMain.handle('region', async (_,id) => {
    if(!hasMainWindow())return null;
    if(current?.busy || selectingRegion) throw new Error('请先完成当前操作');
    selectingRegion=true;confirmedRegion=null;selectionSourceId=id;
    win.hide();
    try {
      await new Promise(resolve=>setTimeout(resolve,180));
      if(!hasMainWindow())return null;
      const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:2560,height:1600}});
      if(!hasMainWindow())return null;
      const source=sources.find(s=>s.id===id);
      if(!source) throw new Error('屏幕已断开，请刷新');
      const display=screen.getAllDisplays().find(d=>String(d.id)===source.display_id);
      if(!display) throw new Error('无法定位屏幕');
      return await new Promise((resolve,reject)=>{
        selectionResolve=resolve;
        const selectionWindow=new BrowserWindow({...display.bounds,frame:false,alwaysOnTop:true,resizable:false,movable:false,skipTaskbar:true,backgroundColor:'#111111',enableLargerThanScreen:true,webPreferences:{preload:ui('preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
        overlay=selectionWindow;
        selectionWindow.setBounds(display.bounds);
        selectionWindow.webContents.once('did-finish-load',()=>{
          if(hasMainWindow() && overlay===selectionWindow && !selectionWindow.isDestroyed())selectionWindow.webContents.send('region-image',source.thumbnail.toDataURL());
        });
        selectionWindow.once('closed',()=>{
          if(overlay!==selectionWindow)return;
          overlay=null;selectionResolve?.(null);selectionResolve=null;selectingRegion=false;show();
        });
        selectionWindow.loadFile(ui('region.html')).catch(error=>{
          if(!hasMainWindow() || selectionWindow.isDestroyed())return;
          reject(error);
          cancelRegionSelection();
        });
      });
    } catch(e) { selectingRegion=false;show();throw e; }
  });
  ipcMain.handle('complete-region', (event,crop)=>{
    if(!hasMainWindow() || !overlay || overlay.isDestroyed() || event.sender!==overlay.webContents) return;
    if(crop) {filters({crop});confirmedRegion={sourceId:selectionSourceId,crop};}
    selectionResolve?.(crop);selectionResolve=null;overlay.close();
  });
  ipcMain.handle('begin', async (_,options)=>{
    if(!hasMainWindow())throw new Error('窗口已关闭');
    if(current?.busy) throw new Error('录制或转换尚未完成');
    if(!selected)throw new Error('请先选择录制来源');
    if(options?.mode==='region' && (!options.crop || confirmedRegion?.sourceId!==selected || JSON.stringify(confirmedRegion.crop)!==JSON.stringify(options.crop)))throw new Error('请先框选并确认录制区域');
    const directory=await fs.mkdtemp(path.join(app.getPath('temp'),'luma-'));
    if(!hasMainWindow()){await fs.rm(directory,{recursive:true,force:true});throw new Error('窗口已关闭');}
    current={directory,input:path.join(directory,'original.webm'),output:path.join(directory,'recording.gif'),options,busy:true,recording:true,bytes:0,process:null};
    await fs.writeFile(current.input,Buffer.alloc(0));
    if(!hasMainWindow()){current.busy=false;current.recording=false;throw new Error('窗口已关闭');}
    recordingTray(true);
    win.hide();
    await new Promise(resolve=>setTimeout(resolve,180));
  });
  ipcMain.handle('chunk', async (_,data)=>{
    if(!current?.recording || !(data instanceof Uint8Array)) throw new Error('录制已结束');
    current.bytes+=data.byteLength;
    if(current.bytes>1024*1024*1024) throw new Error('录制达到 1 GB 上限，请缩短时长');
    await fs.appendFile(current.input,data);
  });
  ipcMain.handle('finish', async ()=>{
    if(!current?.recording) throw new Error('没有正在进行的录制');
    const job=current;job.recording=false;recordingTray(false);show();
    try {
      const result=await encode({binary:ffmpeg(),input:job.input,output:job.output,options:job.options,onProgress:p=>send('progress',p),onProcess:p=>{job.process=p;}});
      job.success=true;
      return {...result,url:pathToFileURL(job.output).href,source:job.input};
    } finally { job.busy=false;job.process=null; }
  });
  ipcMain.handle('abort',async()=>{
    if(current) {current.process?.kill();current.recording=false;current.busy=false;}
    recordingTray(false);show();
  });
  ipcMain.handle('save',async(_,kind)=>{
    if(!hasMainWindow())return null;
    if(!current || current.busy || (kind!=='source' && !current.success)) throw new Error('文件尚未准备好');
    const source=kind==='source';
    const result=await dialog.showSaveDialog(win,{defaultPath:path.join(app.getPath('downloads'),`Luma-${new Date().toISOString().replace(/[:.]/g,'-')}.${source?'webm':'gif'}`),filters:[{name:source?'原始录屏':'GIF 动图',extensions:[source?'webm':'gif']}]});
    if(result.canceled) return null;
    await fs.copyFile(source?current.input:current.output,result.filePath);
    current.saved=result.filePath;
    return result.filePath;
  });
  ipcMain.handle('reveal',()=>{if(current?.saved)shell.showItemInFolder(current.saved);});
  ipcMain.handle('minimize',()=>{if(hasMainWindow())win.minimize();});
  app.on('activate',show);
});
app.on('before-quit',()=>{quitting=true;cancelRegionSelection();});
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>{globalShortcut.unregisterAll();current?.process?.kill();tray?.destroy();});
