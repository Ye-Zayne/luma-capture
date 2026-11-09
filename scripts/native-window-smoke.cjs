const electron=require('electron');
const {app,BrowserWindow,nativeImage,screen}=electron;
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(condition,label){const deadline=Date.now()+10000;while(!await condition()){if(Date.now()>deadline)throw new Error(label);await delay(50);}}
// Use the real main-process window lifecycle, but never read screen pixels.
electron.desktopCapturer.getSources=async()=>[{id:'screen:0:0',name:'测试屏幕',display_id:String(screen.getPrimaryDisplay().id),thumbnail:nativeImage.createEmpty()}];
require('../src/main.cjs');
app.whenReady().then(async()=>{
  try {
    const win=BrowserWindow.getAllWindows()[0];
    await until(()=>BrowserWindow.getAllWindows().length===2,'Startup did not open region selection');
    let overlay=BrowserWindow.getAllWindows().find(window=>window!==win);
    await until(()=>!overlay.webContents.isLoading(),'Selection page did not load');await delay(150);
    assert.equal(win.isVisible(),false);
    assert.equal(await win.webContents.executeJavaScript('document.getElementById("record").disabled'),true);
    assert.equal(await overlay.webContents.executeJavaScript('document.getElementById("confirm").disabled'),true);
    await overlay.webContents.executeJavaScript('document.getElementById("cancel").click()');
    await until(()=>BrowserWindow.getAllWindows().length===1&&win.isVisible(),'Cancel did not return to toolbar');await delay(100);
    assert.deepEqual(win.getSize(),[680,88]);
    assert.equal(await win.webContents.executeJavaScript('document.getElementById("record").disabled'),true);
    assert.equal(await win.webContents.executeJavaScript('document.getElementById("toolbar-record-label").textContent'),'选择区域');
    const rejection=await win.webContents.executeJavaScript('(async()=>{await window.clip.select("screen:0:0");try{await window.clip.begin({mode:"region",crop:null});return "not rejected";}catch(e){return e.message;}})()');
    assert.match(rejection,/确认录制区域/);
    await win.webContents.executeJavaScript('document.getElementById("toolbar-record").click()');
    await until(()=>BrowserWindow.getAllWindows().length===2,'Selection retry did not open');
    overlay=BrowserWindow.getAllWindows().find(window=>window!==win);
    await until(()=>!overlay.webContents.isLoading(),'Selection retry did not load');
    overlay.focus();await delay(250);
    overlay.webContents.sendInputEvent({type:'mouseMove',x:100,y:100});
    overlay.webContents.sendInputEvent({type:'mouseDown',x:100,y:100,button:'left',clickCount:1});
    overlay.webContents.sendInputEvent({type:'mouseMove',x:460,y:340,modifiers:['leftButtonDown']});
    overlay.webContents.sendInputEvent({type:'mouseUp',x:460,y:340,button:'left',clickCount:1});
    await until(()=>overlay.webContents.executeJavaScript('!document.getElementById("confirm").disabled'),'Injected pointer drag did not select region');
    assert.equal(BrowserWindow.getAllWindows().length,2,'Mouse release must not confirm');
    assert.equal(await win.webContents.executeJavaScript('document.getElementById("record").disabled'),true);
    await overlay.webContents.executeJavaScript('document.getElementById("confirm").click()');
    await until(()=>BrowserWindow.getAllWindows().length===1,'Confirm did not close selector');
    await until(()=>win.webContents.executeJavaScript('!document.getElementById("record").disabled'),'Confirmed region did not enable recording');
    await fs.mkdir(path.resolve(__dirname,'../test-output'),{recursive:true});
    await fs.writeFile(path.resolve(__dirname,'../test-output/native-toolbar.png'),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript('window.clip.surface("result")');await delay(100);
    assert.deepEqual(win.getSize(),[900,680]);
    assert.equal(win.isAlwaysOnTop(),false);
    await win.webContents.executeJavaScript('window.clip.surface("toolbar")');await delay(100);
    assert.deepEqual(win.getSize(),[680,88]);
    console.log('Native window flow passed: auto selector → cancel blocks recording → injected mouse drag remains unconfirmed → confirm enables recording; backend rejects missing selection. Screen pixels were mocked; mouse events were injected through Electron.');
    app.quit();
  } catch(error) {console.error(error);app.exit(1);}
});
