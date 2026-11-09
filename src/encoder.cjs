const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const presets = {
  clear: { width: 1920, fps: 20, colors: 256, dither: 'sierra2_4a' },
  balanced: { width: 1440, fps: 15, colors: 256, dither: 'bayer:bayer_scale=3' },
  small: { width: 960, fps: 10, colors: 192, dither: 'bayer:bayer_scale=4' }
};

function filters(options, scale = 1) {
  const preset = presets[options.preset] || presets.balanced;
  const width = Math.max(320, Math.round(preset.width * scale));
  const parts = [];
  if (options.crop) {
    const { x, y, width: w, height: h } = options.crop;
    if (![x,y,w,h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x+w > 1.00001 || y+h > 1.00001) throw new Error('录制区域无效');
    parts.push(`crop=w='max(2,floor(iw*${w}/2)*2)':h='max(2,floor(ih*${h}/2)*2)':x='floor(iw*${x}/2)*2':y='floor(ih*${y}/2)*2'`);
  }
  parts.push(`fps=${preset.fps}`, `scale=w='min(iw,${width})':h=-1:flags=lanczos`);
  return { filter: parts.join(','), preset, width };
}

function run(binary, args, onProcess = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true });
    onProcess(child);
    let errors = '';
    child.stderr.on('data', b => { errors = (errors + b.toString()).slice(-5000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(errors || `转换已停止 (${code})`)));
  });
}

async function encode({ binary, input, output, options = {}, onProgress = () => {}, onProcess }) {
  const palette = path.join(path.dirname(output), 'palette.png');
  const target = options.targetMB === 8 ? 8 * 1024 * 1024 : 0;
  let result;
  try {
    for (let attempt = 0; attempt < (target ? 3 : 1); attempt++) {
      const scale = [1, 0.8, 0.6][attempt];
      const { filter, preset, width } = filters(options, scale);
      onProgress({ stage: `正在分析颜色${attempt ? ` · 优化体积 ${attempt}/2` : ''}`, percent: 10 + attempt * 28 });
      await run(binary, ['-i', input, '-vf', `${filter},palettegen=max_colors=${preset.colors}:stats_mode=diff`, '-frames:v', '1', '-threads', '1', palette], onProcess);
      onProgress({ stage: '正在生成 GIF · 保留细节', percent: 24 + attempt * 28 });
      await run(binary, ['-i', input, '-i', palette, '-filter_complex', `[0:v]${filter}[v];[v][1:v]paletteuse=dither=${preset.dither}:diff_mode=rectangle`, '-an', '-loop', '0', output], onProcess);
      const { size } = await fs.stat(output);
      result = { size, width, fps: preset.fps, targetMet: !target || size <= target, optimized: attempt > 0 };
      if (!target || size <= target) break;
    }
    onProgress({ stage: '转换完成', percent: 100 });
    return result;
  } finally { await fs.rm(palette, { force: true }).catch(() => {}); }
}
module.exports = { presets, filters, encode, run };
