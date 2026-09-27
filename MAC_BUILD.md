# Mac 打包指南

本文档说明如何在 macOS 上把 Media Codec Studio 打成 dmg 安装包。

## 前置要求

- macOS 机器（Intel 或 Apple Silicon 均可）
- Node.js 18+（推荐用 [nvm](https://github.com/nvm-sh/nvm) 安装）
- Xcode Command Line Tools（终端运行 `xcode-select --install` 安装）

## 第一步：拉代码

```bash
git clone https://github.com/keyisi/media-codec-studio.git
cd media-codec-studio
```

## 第二步：安装依赖

```bash
npm install
```

这一步会同时装好 Windows 和 Mac 两个平台的 ffmpeg 二进制（打包用，不影响运行）。

## 第三步：生成 Mac 图标

Mac 要求 `.icns` 格式图标，仓库里只提供了 `build/icon.png`，需要在 Mac 上转换一次：

```bash
bash scripts/make-mac-icon.sh
```

成功后会生成 `build/icon.icns`。这一步只需做一次，除非你换了图标。

> 脚本用的是 macOS 自带的 `sips` 和 `iconutil`，不需要额外装工具。

## 第四步：打包

```bash
npm run dist
```

这会自动完成：

1. `vite build` 把前端打成静态文件
2. `electron-builder` 分别打出 x64（Intel）和 arm64（Apple Silicon）两个 dmg

产物在 `release/` 目录下：

```
release/
  Media Codec Studio-0.1.0-x64.dmg      # Intel Mac
  Media Codec Studio-0.1.0-arm64.dmg    # M 系列 Mac
```

把对应的 dmg 发给用户，双击拖进 Applications 即可。

## 只打某一个架构（可选）

默认同时打两个架构，想省时间只打当前机器的：

```bash
# Apple Silicon Mac
npm run build && npx electron-builder --mac dmg --arm64

# Intel Mac
npm run build && npx electron-builder --mac dmg --x64
```

## 开发模式跑起来（不打包）

```bash
npm run dev
```

会自动启动 Vite 开发服务器 + Electron 窗口，改代码热重载。

## 代码里做了哪些跨平台适配

- `electron/main.cjs` 里的 `resolveToolPath()` 根据 `process.platform` 和 `process.arch` 自动选 ffmpeg：
  - Windows: `node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe`
  - Mac Intel: `node_modules/@ffmpeg-installer/darwin-x64/ffmpeg`
  - Mac Apple Silicon: `node_modules/@ffmpeg-installer/darwin-arm64/ffmpeg`
- 图标路径也按平台选（`.ico` / `.icns` / `.png`）
- 2pass 第一次的输出空设备已经按平台区分：Windows 用 `NUL`，Mac/Linux 用 `/dev/null`

## 已知限制

- UI 里的硬件加速选项 **Intel QSV / NVIDIA NVENC / AMD AMF** 是 Windows 专有，在 Mac 上选了会报错。Mac 上保持默认的 CPU 编码（libx264 / libx265）即可。
- Mac 上首次打开未签名的 dmg 会提示"无法打开，因为来自身份不明的开发者"。解决：
  - 临时方案：右键 dmg → 打开 → 确认打开
  - 永久方案：系统设置 → 隐私与安全性 → 仍要打开
  - 正式分发需要 Apple Developer 账号做代码签名 + 公证，本指南不涉及。
