# Media Codec Studio

一个基于 Electron + React + FFmpeg 的音视频转码软件 MVP。

## 当前功能

- 导入多个音频或视频文件
- 支持直接拖拽文件到窗口
- 支持设置导出路径，自动生成 `原文件名_encoded.ext` 或 `原文件名_remux.ext`
- 支持自定义导出文件名，输入基础名称即可，扩展名自动跟随当前封装格式
- 使用 `ffprobe` 读取封装、时长、大小、视频流和音频流信息
- 摘要区显示容器、时长、大小、视频、音频、色彩和 HDR 基础信息
- 输出格式：H.264、HEVC、AV1、AVI、QuickTime、纯音频
- 硬件加速选项：Intel QSV、NVIDIA NVENC、AMD AMF
- 比特率控制：CBR、VBR / 2pass、CRF / CQ
- 手动设置分辨率、视频比例、帧率、场序、8bit / 10bit 色深
- HDR 曲线：PQ、HLG
- 色彩空间转换：Rec.709、BT.2020
- 音频设置：AAC 等编码、采样率、通道、比特率、关闭音频
- 重封装 Remux：不重新编码，使用 `-c copy` 快速更换容器
- 调用 `ffmpeg` 执行转码
- 显示任务状态、进度和实际执行命令
- 支持停止正在运行的转码任务

## 环境要求

1. Node.js 18+
2. 开发依赖由 npm 安装；应用已经内置 FFmpeg，用户安装后不需要手动安装 FFmpeg

## 启动开发版

```powershell
npm install
npm run dev
```

如果 Electron 运行时下载很慢或安装后提示 `Electron failed to install correctly`，可以使用镜像源重建：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm rebuild electron
```

## 打包安装包

```powershell
npm run dist
```

生成的 Windows 安装包位于：

```text
release/Media Codec Studio-Setup-0.1.0.exe
```

也可以生成未安装版目录用于快速测试：

```powershell
npm run pack
```

未安装版入口：

```text
release/win-unpacked/Media Codec Studio.exe
```

## 项目结构

```text
electron/
  main.cjs       Electron 主进程，负责文件选择、ffprobe、ffmpeg 子进程和进度回传
  preload.cjs    安全暴露给 React 的 IPC API
src/
  App.jsx        React 转码工作台
  main.jsx       React 入口
  styles.css     界面样式
```

## 后续建议

- 内置 FFmpeg 二进制，避免用户手动安装
- 增加批量转码队列的并发控制
- 增加预设：社交平台、无损音频、移动端小体积
- 增加裁剪、截取片段、字幕烧录、音轨选择
- 使用 electron-builder 打包安装包
