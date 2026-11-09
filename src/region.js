const box = document.getElementById('box');
const shade = document.getElementById('shade');
const dimensions = document.getElementById('dimensions');
const status = document.getElementById('selection-status');
const reset = document.getElementById('reset');
const cancel = document.getElementById('cancel');
const confirm = document.getElementById('confirm');
let start = null;
let rect = null;
let previousRect = null;
let pointerId = null;
let completed = false;

window.clip.on('region-image', data => {
  document.getElementById('screen').src = data;
});

function validSelection() {
  return rect && rect.width >= 24 && rect.height >= 24;
}

function drawSelection() {
  const visible = rect && rect.width > 0 && rect.height > 0;
  box.hidden = !visible;
  shade.hidden = !!visible;
  if (visible) {
    Object.assign(box.style, {
      left: rect.x + 'px', top: rect.y + 'px',
      width: rect.width + 'px', height: rect.height + 'px'
    });
    dimensions.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  }
  confirm.disabled = !validSelection() || !!start || completed;
  reset.disabled = !rect || !!start || completed;
  status.textContent = start ? '拖动选择录制区域' : validSelection()
    ? `${Math.round(rect.width)} × ${Math.round(rect.height)} · 已选好`
    : rect ? '区域太小，请重新框选' : '请先框选区域';
}

function position(event) {
  return {
    x: Math.max(0, Math.min(innerWidth, event.clientX)),
    y: Math.max(0, Math.min(innerHeight, event.clientY))
  };
}

function updateSelection(event) {
  const end = position(event);
  rect = {
    x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y)
  };
  drawSelection();
}

function endDrag(restorePrevious = false) {
  const capturedPointer = pointerId;
  start = null;
  pointerId = null;
  if (restorePrevious) rect = previousRect;
  previousRect = null;
  if (capturedPointer !== null && document.body.hasPointerCapture(capturedPointer)) {
    document.body.releasePointerCapture(capturedPointer);
  }
  drawSelection();
}

function complete(crop) {
  if (completed) return;
  completed = true;
  endDrag();
  window.clip.completeRegion(crop);
}

function confirmSelection() {
  if (start || !validSelection() || completed) return;
  complete({
    x: rect.x / innerWidth, y: rect.y / innerHeight,
    width: rect.width / innerWidth, height: rect.height / innerHeight
  });
}

window.addEventListener('pointerdown', event => {
  if (completed || start || event.button !== 0 || !event.isPrimary || event.target.closest('#controls')) return;
  event.preventDefault();
  document.body.focus({ preventScroll: true });
  previousRect = rect;
  start = position(event);
  pointerId = event.pointerId;
  document.body.setPointerCapture(pointerId);
  updateSelection(event);
});

window.addEventListener('pointermove', event => {
  if (start && event.pointerId === pointerId) updateSelection(event);
});

window.addEventListener('pointerup', event => {
  if (!start || event.pointerId !== pointerId) return;
  updateSelection(event);
  endDrag();
});

window.addEventListener('pointercancel', event => {
  if (start && event.pointerId === pointerId) endDrag(true);
});

document.body.addEventListener('lostpointercapture', event => {
  if (start && event.pointerId === pointerId) endDrag(true);
});

reset.addEventListener('click', () => {
  if (completed) return;
  rect = null;
  endDrag();
  document.body.focus({ preventScroll: true });
});
cancel.addEventListener('click', () => complete(null));
confirm.addEventListener('click', confirmSelection);

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    complete(null);
  } else if (event.key === 'Enter' && !event.target.closest('button')) {
    event.preventDefault();
    confirmSelection();
  }
});
