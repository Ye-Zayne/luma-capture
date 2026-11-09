// Run with Node. Each case owns an Electron subprocess so app.quit/app.exit
// exercise the real shutdown path without dismissing or killing other apps.
const assert = require('node:assert/strict');
const scenarios = ['destroy-open', 'destroy-pending', 'quit-open', 'exit-open'];

if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const electron = require('electron');
  (async () => {
    for (const scenario of scenarios) {
      await new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(electron, [__filename, scenario], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 20000);
        child.stdout.on('data', data => { output += data; });
        child.stderr.on('data', data => { output += data; });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', (code, signal) => {
          clearTimeout(timer);
          try {
            assert.equal(timedOut, false, `${scenario}: child timed out`);
            assert.equal(signal, null, `${scenario}: unexpected signal ${signal}`);
            assert.equal(code, scenario === 'exit-open' ? 1 : 0, `${scenario}: unexpected exit code ${code}`);
            assert.doesNotMatch(output, /LIFECYCLE_FAILURE|Object has been destroyed/);
            assert.match(output, new RegExp(`${scenario === 'exit-open' ? 'LIFECYCLE_EXIT_REQUESTED' : 'LIFECYCLE_PASS'} ${scenario}`));
            assert.match(output, /LIFECYCLE_WINDOWS 0/);
            console.log(`Passed ${scenario}`);
            resolve();
          } catch (error) {
            reject(new Error(`${error.message}\n${output}`));
          }
        });
      });
    }
    console.log('Lifecycle passed: closing the owner cancels open/pending selection; app.quit and app.exit close all windows without destroyed-object exceptions. Screen pixels were mocked.');
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const electron = require('electron');
  const { app, BrowserWindow, dialog, desktopCapturer, nativeImage, screen } = electron;
  const scenario = process.argv[2];
  assert.ok(scenarios.includes(scenario), `Unknown lifecycle scenario: ${scenario}`);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const windows = new Set();
  let created = 0;
  let failing = false;
  let allowQuit = !scenario.startsWith('destroy-');
  let releaseScreenshot;
  let screenshotPending = false;

  function fail(error) {
    if (failing) return;
    failing = true;
    console.error(`LIFECYCLE_FAILURE ${error?.stack || error}`);
    // Stop this child without invoking Electron's error dialog or another
    // window-cleanup path that could obscure the original failure.
    process.exit(90);
  }
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
  dialog.showErrorBox = (title, content) => fail(new Error(`${title}: ${content}`));

  // Keep all real BrowserWindow methods intact: a stale show()/focus() must
  // still fail the test. Invisible, unfocusable windows minimize disruption.
  app.on('browser-window-created', (_, window) => {
    created++;
    windows.add(window);
    window.setOpacity(0);
    window.setFocusable(false);
    window.on('show', () => { if (!window.isDestroyed()) window.hide(); });
    window.on('closed', () => {
      windows.delete(window);
      console.log(`LIFECYCLE_WINDOWS ${windows.size}`);
    });
  });
  app.on('before-quit', event => { if (!allowQuit) event.preventDefault(); });
  app.on('will-quit', () => {
    try {
      assert.equal(windows.size, 0, 'app.quit left native windows alive');
      console.log(`LIFECYCLE_PASS ${scenario}`);
    } catch (error) { fail(error); }
  });

  desktopCapturer.getSources = async options => {
    if (scenario === 'destroy-pending' && options.thumbnailSize?.width === 2560) {
      screenshotPending = true;
      await new Promise(resolve => { releaseScreenshot = resolve; });
    }
    return [{ id: 'screen:0:0', name: '测试屏幕', display_id: String(screen.getPrimaryDisplay().id), thumbnail: nativeImage.createEmpty() }];
  };
  async function until(condition, message) {
    const deadline = Date.now() + 10000;
    while (!await condition()) {
      if (Date.now() > deadline) throw new Error(message);
      await delay(25);
    }
  }

  if (process.env.LUMA_LIFECYCLE_BASELINE) {
    // Load a saved pre-fix main under its real filename so relative preload,
    // renderer and encoder paths still work; never replace workspace code.
    const Module = require('node:module');
    const fs = require('node:fs');
    const path = require('node:path');
    const filename = path.resolve(__dirname, '../src/main.cjs');
    const baseline = new Module(filename, module);
    baseline.filename = filename;
    baseline.paths = Module._nodeModulePaths(path.dirname(filename));
    baseline._compile(fs.readFileSync(process.env.LUMA_LIFECYCLE_BASELINE, 'utf8'), filename);
  } else {
    require('../src/main.cjs');
  }
  app.whenReady().then(async () => {
    const owner = BrowserWindow.getAllWindows()[0];
    assert.ok(owner, 'Main window was not created');
    if (scenario === 'destroy-pending') {
      await until(() => screenshotPending, 'Region screenshot preparation did not start');
      assert.equal(created, 1, 'Selection opened before its screenshot was ready');
      owner.destroy();
      releaseScreenshot();
      await delay(500);
      assert.equal(created, 1, 'A stale screenshot created an orphan selection window');
      assert.equal(BrowserWindow.getAllWindows().length, 0, 'Owner destruction left windows alive');
      allowQuit = true;
      app.quit();
      return;
    }
    await until(() => BrowserWindow.getAllWindows().length === 2, 'Startup did not open selection');
    const selector = BrowserWindow.getAllWindows().find(window => window !== owner);
    await until(() => !selector.webContents.isLoading(), 'Selection page did not finish loading');
    if (scenario === 'destroy-open') {
      owner.destroy();
      await until(() => BrowserWindow.getAllWindows().length === 0, 'Owner destruction left the selection window alive');
      await delay(150);
      allowQuit = true;
      app.quit();
    } else if (scenario === 'quit-open') {
      app.quit();
    } else {
      // Match the previous native smoke test's failure cleanup, including its
      // intentional nonzero status. The parent verifies no error was emitted
      // during synchronous destruction and that every window closed.
      console.log(`LIFECYCLE_EXIT_REQUESTED ${scenario}`);
      app.exit(1);
    }
  }).catch(fail);
}
