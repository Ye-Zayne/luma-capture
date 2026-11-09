(() => {
  'use strict';

  const toolbar = document.getElementById('capture-toolbar');
  if (!toolbar) return;

  const modeButtons = [...toolbar.querySelectorAll('[data-toolbar-mode]')];
  const closeButton = document.getElementById('toolbar-close');
  const optionsButton = document.getElementById('toolbar-options');
  const recordButton = document.getElementById('toolbar-record');
  const recordLabel = document.getElementById('toolbar-record-label');
  const captionButton = document.getElementById('toolbar-caption');
  const captionTitle = document.getElementById('toolbar-caption-title');
  const captionDetail = document.getElementById('toolbar-caption-detail');

  const modeNames = {
    screen: '录制整个屏幕',
    window: '录制指定窗口',
    region: '录制自选区域'
  };
  const presetNames = {
    clear: '高清细节',
    balanced: '清晰均衡',
    small: '轻巧分享'
  };
  const recordLabels = {
    idle: '录制',
    starting: '准备中…',
    recording: '停止录制',
    stopping: '正在停止…',
    converting: '转换中…',
    saving: '保存中…'
  };

  let current = {
    mode: 'region',
    preset: 'balanced',
    targetMB: 0,
    state: 'idle',
    canRecord: false,
    label: '',
    selection: '先框选并确认录制区域',
    error: ''
  };

  function dispatch(type, detail = {}) {
    window.dispatchEvent(new CustomEvent('luma-action', {
      detail: { type, ...detail }
    }));
  }

  function render() {
    const state = Object.hasOwn(recordLabels, current.state) ? current.state : 'idle';
    const mode = Object.hasOwn(modeNames, current.mode) ? current.mode : 'screen';
    const idle = state === 'idle';
    const recording = state === 'recording';
    const preset = presetNames[current.preset] || presetNames.balanced;
    const quality = current.targetMB ? `${preset} · 尽量 ${current.targetMB} MB` : preset;
    const selection = String(current.selection || quality);
    const error = String(current.error || '');

    toolbar.dataset.state = state;
    toolbar.dataset.error = String(Boolean(error));
    toolbar.setAttribute('aria-busy', String(!idle && !recording));

    modeButtons.forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.toolbarMode === mode));
      button.disabled = !idle;
    });
    optionsButton.disabled = !idle;
    recordButton.disabled = recording ? false : (!idle || !(current.canRecord || current.needsSelection && current.canSelect));
    recordLabel.textContent = current.label || recordLabels[state];
    recordButton.setAttribute('aria-label', recording ? '停止录制并生成 GIF' : recordLabel.textContent);
    recordButton.title = recording ? '停止录制并自动生成 GIF' : `${modeNames[mode]} · ${quality}`;

    captionTitle.textContent = current.phaseLabel || (recording ? '正在录制' : state === 'converting' ? '正在生成 GIF' : modeNames[mode]);
    captionDetail.textContent = error || selection;
    captionButton.title = `${error || selection}\n${quality}\n点击打开详情`;
    captionButton.setAttribute('aria-label', `${captionTitle.textContent}，${error || selection}。打开详情`);
  }

  closeButton.addEventListener('click', () => dispatch('close'));
  optionsButton.addEventListener('click', () => dispatch('options'));
  recordButton.addEventListener('click', () => dispatch(current.needsSelection&&current.state==='idle'?'select-region':'record'));
  captionButton.addEventListener('click', () => dispatch('details'));

  modeButtons.forEach((button, index) => {
    button.addEventListener('click', () => dispatch('mode', { mode: button.dataset.toolbarMode }));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = modeButtons.length - 1;
      else nextIndex = (index + (event.key === 'ArrowRight' ? 1 : -1) + modeButtons.length) % modeButtons.length;
      const next = modeButtons[nextIndex];
      if (!next.disabled) next.focus();
    });
  });

  window.addEventListener('luma-state', event => {
    if (!event.detail || typeof event.detail !== 'object') return;
    current = { ...current, ...event.detail };
    render();
  });

  render();
})();
