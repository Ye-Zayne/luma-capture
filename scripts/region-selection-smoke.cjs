const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// Exercise pointer/keyboard handlers and the production preload without capture.
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => {
  console.error('Region selection smoke timed out');
  app.exit(1);
}, 20000);

app.whenReady().then(async () => {
  try {
    const results = [];
    const errors = [];
    ipcMain.handle('complete-region', (_event, crop) => results.push(crop));
    const win = new BrowserWindow({
      width: 1000, height: 700, frame: false, show: false,
      webPreferences: {
        preload: path.resolve(__dirname, '../src/preload.cjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false
      }
    });
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 3) errors.push(message);
    });
    const js = code => win.webContents.executeJavaScript(code);
    const mouse = async (type, x, y) => {
      const pointerType = { mouseDown: 'pointerdown', mouseMove: 'pointermove', mouseUp: 'pointerup' }[type];
      await js(`(() => { const target=document.elementFromPoint(${x},${y})||document.body;target.dispatchEvent(new PointerEvent(${JSON.stringify(pointerType)},{bubbles:true,clientX:${x},clientY:${y},button:0,pointerId:1,isPrimary:true,pointerType:'mouse'})); })()`);
    };
    const click = async id => {
      const { x, y } = await js(`(() => { const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
      await mouse('mouseDown', x, y);
      await mouse('mouseUp', x, y);
      await js(`document.getElementById(${JSON.stringify(id)}).click()`);
      await pause(35);
    };
    const drag = async (x1, y1, x2, y2) => {
      await mouse('mouseDown', x1, y1);
      await mouse('mouseMove', x2, y2);
      await mouse('mouseUp', x2, y2);
    };
    const key = async keyCode => {
      await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(keyCode)},bubbles:true,cancelable:true}))`);
      await pause(35);
    };
    const boxRect = () => js(`(() => { const r=document.getElementById('box').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
    const load = async () => {
      await win.loadFile(path.resolve(__dirname, '../src/region.html'));
      const background = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700"><rect width="1000" height="700" fill="#dde6eb"/><rect x="70" y="70" width="860" height="490" rx="16" fill="#f7f8f9"/><rect x="110" y="110" width="230" height="18" rx="9" fill="#8f9cab"/><rect x="110" y="155" width="470" height="10" rx="5" fill="#cbd4dc"/><rect x="110" y="180" width="360" height="10" rx="5" fill="#cbd4dc"/></svg>';
      win.webContents.send('region-image', `data:image/svg+xml;base64,${Buffer.from(background).toString('base64')}`);
      // Synthetic pointers have no OS capture; model only the capture lifecycle.
      await js("let captured=null;document.body.setPointerCapture=id=>{captured=id};document.body.hasPointerCapture=id=>captured===id;document.body.releasePointerCapture=id=>{captured=null;document.body.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:id}))};window.addEventListener('pointerdown',event=>{window.__testPointerId=event.pointerId},{capture:true});document.body.focus()");
      await pause(120);
    };

    await load();
    assert.equal(await js("document.getElementById('confirm').disabled"), true);
    await drag(100, 100, 500, 350);
    assert.equal(results.length, 0, 'Pointer release must not confirm the region');
    assert.equal(await js("document.getElementById('box').hidden"), false);
    assert.equal(await js("document.getElementById('confirm').disabled"), false);
    assert.equal(await js("document.getElementById('dimensions').textContent"), '400 × 250');
    assert.deepEqual(await boxRect(), { x: 100, y: 100, width: 400, height: 250 });

    await click('selection-status');
    assert.deepEqual(await boxRect(), { x: 100, y: 100, width: 400, height: 250 }, 'Clicking the floating bar must not draw a new selection');
    await click('reset');
    assert.equal(await js("document.getElementById('box').hidden"), true);
    assert.equal(await js("document.getElementById('confirm').disabled"), true);
    assert.equal(results.length, 0);
    await drag(100, 100, 115, 116);
    assert.equal(await js("document.getElementById('confirm').disabled"), true, 'Small selections must not be confirmed');
    await key('Enter');
    assert.equal(results.length, 0);

    await drag(600, 400, 200, 100);
    assert.deepEqual(await boxRect(), { x: 200, y: 100, width: 400, height: 300 }, 'Reverse drag must normalize the rectangle');
    await mouse('mouseDown', 250, 150);
    await mouse('mouseMove', 700, 450);
    await js("window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.__testPointerId}))");
    await mouse('mouseUp', 700, 450);
    assert.deepEqual(await boxRect(), { x: 200, y: 100, width: 400, height: 300 }, 'Canceled drag must restore the previous selection');
    assert.equal(await js("document.getElementById('confirm').disabled"), false);
    await pause(150);
    await fs.mkdir(path.resolve(__dirname, '../test-output'), { recursive: true });
    await fs.writeFile(path.resolve(__dirname, '../test-output/region-confirm.png'), (await win.webContents.capturePage()).toPNG());
    await click('confirm');
    const viewport = await js('({width:innerWidth,height:innerHeight})');
    assert.deepEqual(results[0], { x: 200 / viewport.width, y: 100 / viewport.height, width: 400 / viewport.width, height: 300 / viewport.height });
    await key('Enter');
    assert.equal(results.length, 1, 'Confirmation may emit only once');

    await load();
    await drag(50, 60, 250, 260);
    assert.equal(await js("document.getElementById('confirm').disabled"), false);
    await key('Enter');
    assert.deepEqual(results[1], { x: 50 / viewport.width, y: 60 / viewport.height, width: 200 / viewport.width, height: 200 / viewport.height }, 'Enter must confirm the selected rectangle');

    await load();
    await drag(50, 60, 250, 260);
    await click('cancel');
    assert.equal(results[2], null, 'Cancel button must emit null');
    await load();
    await key('Escape');
    assert.equal(results[3], null, 'Escape must emit null');
    assert.equal(results.length, 4);
    assert.deepEqual(errors, []);
    clearTimeout(timeout);
    console.log('Region selection passed: release preserves selection, confirmation button/Enter sends normalized crop, cancel/Esc sends null, controls do not redraw, pointercancel restores selection. Screen capture was mocked.');
    app.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    console.error(error);
    app.exit(1);
  }
});
