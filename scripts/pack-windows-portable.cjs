// Cross-assemble a portable Windows package from the platform-independent app.asar.
// Official Electron and ffmpeg-static release archives must be downloaded first.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { gunzipSync } = require('node:zlib');
const { execFileSync } = require('node:child_process');

async function main() {
  const [electronZip,ffmpegGz,license,readme]=process.argv.slice(2);
  if(!readme)throw new Error('Usage: node scripts/pack-windows-portable.cjs electron.zip ffmpeg.gz ffmpeg.LICENSE ffmpeg.README');
  const version=require('electron/package.json').version;
  const appVersion=require('../package.json').version;
  const expected=require('electron/checksums.json')[`electron-v${version}-win32-x64.zip`];
  const actual=crypto.createHash('sha256').update(await fs.readFile(electronZip)).digest('hex');
  if(!expected || expected!==actual)throw new Error('Electron checksum mismatch');
  const ffmpeg=gunzipSync(await fs.readFile(ffmpegGz));
  if(ffmpeg.subarray(0,2).toString()!=='MZ')throw new Error('FFmpeg is not a Windows executable');
  const root=path.resolve(__dirname,'..');
  const dest=path.join(root,'dist','Luma-Windows-x64');
  await fs.mkdir(dest,{recursive:true});
  execFileSync('unzip',['-qo',path.resolve(electronZip),'-d',dest]);
  await fs.rename(path.join(dest,'electron.exe'),path.join(dest,'Luma.exe'));
  const resources=path.join(dest,'resources');
  await fs.rm(path.join(resources,'default_app.asar'),{force:true});
  const macResources=path.join(root,'dist/mac-arm64/Luma.app/Contents/Resources');
  await fs.copyFile(path.join(macResources,'app.asar'),path.join(resources,'app.asar'));
  await fs.cp(path.join(macResources,'app.asar.unpacked'),path.join(resources,'app.asar.unpacked'),{recursive:true});
  const binaryDir=path.join(resources,'app.asar.unpacked/node_modules/ffmpeg-static');
  for(const file of ['ffmpeg','ffmpeg.LICENSE','ffmpeg.README'])await fs.rm(path.join(binaryDir,file),{force:true});
  await fs.writeFile(path.join(binaryDir,'ffmpeg.exe'),ffmpeg);
  await fs.copyFile(license,path.join(binaryDir,'ffmpeg.exe.LICENSE'));
  await fs.copyFile(readme,path.join(binaryDir,'ffmpeg.exe.README'));
  await fs.writeFile(path.join(dest,'使用说明.txt'),`Luma ${appVersion} · Windows x64 测试版\r\n\r\n请完整解压整个文件夹，再双击 Luma.exe。不要单独移动 exe。\r\n录屏停止快捷键：Ctrl + Shift + X，也可点击系统托盘红色图标。\r\n停止后自动生成 GIF。首次使用请先录制几秒测试。\r\n该包未经 Windows 真机验证和发布者代码签名。\r\n区域模式原始录屏包含整块屏幕，GIF 才裁剪为选择区域。\r\n`);
  const archive=path.join(root,'dist',`Luma-${appVersion}-win-x64-portable.zip`);
  execFileSync('zip',['-q','-r',archive,'Luma-Windows-x64'],{cwd:path.join(root,'dist')});
  console.log(`Windows x64 portable created: ${archive}`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
