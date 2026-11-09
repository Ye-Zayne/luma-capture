# Luma · 录屏转 GIF

适用于 macOS / Windows 的本地桌面应用。支持整个屏幕、指定窗口和在屏幕上拖选区域。停止录制后自动转换为无限循环 GIF，不需要上传或登录。

默认流程是：**选择并确认屏幕区域 → 录制 → 停止后自动转 GIF → 选择本地位置保存**。启动后自动进入区域选择；松开鼠标只保留选区，点击「确认区域」或按 Enter 后才返回录制工具条。确认区域不会自动开始录制。

桌面底部的 680 × 88 悬浮工具条提供关闭、全屏/窗口/区域录制、选项和录制按钮。macOS 使用原生背景模糊，Windows 使用半透明外观。仍可通过模式图标切换全屏或窗口录制，通过「选项」调整 GIF 画质和体积。开始录制后工具条隐藏；停止后进入独立结果窗口，显示转换进度、GIF 预览和保存状态，正常流程无需切换 Tab。结果窗口只保留当前会话最近一次录制，不是永久文件库。

## 下载

当前提供 [0.1.4 测试版](https://github.com/Ye-Zayne/luma-capture/releases/tag/v0.1.4)：

- [macOS Apple Silicon](https://github.com/Ye-Zayne/luma-capture/releases/download/v0.1.4/Luma-0.1.4-mac-arm64.zip)：解压后打开 `Luma.app`。
- [Windows x64 免安装版](https://github.com/Ye-Zayne/luma-capture/releases/download/v0.1.4/Luma-0.1.4-win-x64-portable.zip)：完整解压后打开 `Luma.exe`。

Windows 尚未真机验证；应用尚未完成正式签名与公证。完整验证范围和已知限制见下方「发布状态」。

## 开发与打包

需要 Node.js 22 或以上。

```sh
npm ci
npm start
npm test
npm run test:ui
npm run test:native
npm run test:region
npm run test:lifecycle
npm run dist:mac
# 在 Windows 上运行：
npm run dist:win
```

FFmpeg 可执行文件由 ffmpeg-static 安装并打包，最终用户无需单独安装。必须在目标操作系统/架构安装依赖后打包，避免混入另一个系统的 FFmpeg。GitHub Actions 构建模板覆盖 macOS ARM64、Intel 和 Windows x64，保存在 [`docs/github-actions-build.yml`](docs/github-actions-build.yml)。本次上传授权不含 `workflow` 写入权限，因此未启用自动构建；如需启用，使用具备相应权限的凭据将模板放到 `.github/workflows/build.yml`，再手动运行工作流。

本次本地交付包含 macOS Apple Silicon 压缩包与 Windows x64 免安装压缩包。Windows 免安装包由 `scripts/pack-windows-portable.cjs` 将通用应用代码、经过 SHA256 验证的官方 Windows Electron 运行时及 Windows FFmpeg 组合生成，尚未在 Windows 上运行验证。完整解压后启动 `Luma.exe`，不要单独移动 exe。Mac 压缩包解压后打开 `Luma.app`。

## 使用

1. macOS 首次使用时，在系统设置的「隐私与安全性 → 屏幕与系统音频录制」中授权 Luma，然后退出重新启动。开发模式需要授权 Electron。
2. 启动后自动进入区域选择，多屏时先选择屏幕。在截图遮罩上拖动鼠标框选，松开后可检查尺寸、重新框选；点击「确认区域」或按 Enter 确认。点击「取消」或按 Esc 返回工具条，此时不能录制，点击「选择区域」可重试。工具条也可切换全屏或窗口模式，窗口和多屏来源使用原生菜单选择。
3. 在工具条「选项」中选择画质。默认清晰均衡，最多 1440 像素宽、15 fps，不放大原画面。
4. 点击「录制」，倒数三秒后工具条隐藏。通过菜单栏/系统托盘图标或 Command / Ctrl + Shift + X 停止，也可点击 Dock / 任务栏图标显示工具条并停止。120 秒自动停止。
5. 停止后自动转换 GIF，并打开结果窗口。转换完成后会自动弹出系统保存对话框；选择本地位置并确认保存，无需再切换页面或点击转换按钮。
6. 取消保存或保存失败时，已生成的 GIF 留在结果窗口，可点击「保存到本地」重试，无需重新录制或转换。保存成功后可「另存一份」；取消或失败不会清除之前的已保存状态。还可保存原始 WebM 录屏。
7. 点击「再录一次」重新进入区域选择；下一次录制需要重新框选并确认。

“尽量小于 8 MB”最多尝试两次降低尺寸，无法满足时明确提示，不保证在任意时长和内容下达到目标。GIF 的色彩限制可能使渐变出现色带。高清细节使用 1920 px / 20 fps，均衡使用 1440 px / 15 fps，轻巧分享使用 960 px / 10 fps。

区域录制在导出 GIF 时裁剪；临时原始录屏包含所选屏幕的完整画面。原始录屏及 GIF 保留在系统临时目录的 `luma-*` 文件夹，直到系统清理，重要文件请另存。录屏不包含声音。录制期间点击工具条关闭按钮会停止并生成 GIF；转换期间关闭窗口会隐藏，以免丢失结果。

## 发布状态

当前 0.1.4 是可构建的早期版本。此版本修复退出时选区回调访问已销毁主窗口而弹出 `Object has been destroyed` 的问题：退出时取消选区，主窗口销毁后清理窗口引用，异步加载完成后检查窗口是否仍可用。

编码测试使用实际 FFmpeg；Electron 全流程测试使用 Canvas 模拟录屏，覆盖 MediaRecorder → IPC 分块写入 → FFmpeg → GIF 预览与保存重试，并核对保存文件与生成 GIF 的字节一致。`test:native` 在模拟屏幕来源下，以 Electron 注入鼠标事件验证真实窗口流程；`test:region` 使用 DOM 合成指针和键盘事件，并模拟指针捕获。`test:lifecycle` 在独立 Electron 进程中检查选区打开或加载期间关闭主窗口、正常退出和强制退出的行为。保存流程测试模拟保存对话框结果。这些测试不等同于真实桌面录制和系统对话框操作验证。

尚未完成真实屏幕录制权限流程、Windows 真机录制、多屏/DPI 完整兼容性验证。本地 macOS ARM64 产物使用临时签名，没有开发者身份签名和公证；正式对外发布前需要 Apple Developer 签名、公证以及 Windows 签名。还需确定正式产品名、应用图标和发布者信息，并审核所分发 FFmpeg 构建的许可证和相应分发要求。

## 技术

Electron 桌面捕捉、MediaRecorder 分块写入磁盘、FFmpeg 两遍调色板生成和 GIF 编码。界面与 Node 隔离，不加载远程页面。转换测试覆盖实际编码、裁剪尺寸、循环元数据及失败清理。

参考：[Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer) · [FFmpeg palettegen / paletteuse](https://ffmpeg.org/ffmpeg-filters.html)
