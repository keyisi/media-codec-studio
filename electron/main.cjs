const { app, BrowserWindow, Menu, dialog, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");

const isDev = !app.isPackaged;
const activeJobs = new Map();
const ffmpegPath = resolveToolPath("ffmpeg");
const iconPath = resolveIconPath();

function createWindow() {
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    icon: iconPath,
    autoHideMenuBar: true,
    backgroundColor: "#f4f6f8",
    title: "Media Codec Studio",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setMenu(null);

  if (isDev) {
    win.loadURL("http://127.0.0.1:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle("media:pick", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择音视频文件",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Media",
        extensions: ["mp4", "mkv", "mov", "avi", "webm", "mp3", "aac", "wav", "flac", "ogg", "opus", "m4a"]
      },
      { name: "All Files", extensions: ["*"] }
    ]
  });

  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("output:pick", async (_event, defaults = {}) => {
  const result = await dialog.showSaveDialog({
    title: "选择输出文件",
    defaultPath: defaults.defaultPath,
    filters: [
      { name: "MP4", extensions: ["mp4"] },
      { name: "MKV", extensions: ["mkv"] },
      { name: "AVI", extensions: ["avi"] },
      { name: "QuickTime", extensions: ["mov"] },
      { name: "WebM", extensions: ["webm"] },
      { name: "M4A", extensions: ["m4a"] },
      { name: "MP3", extensions: ["mp3"] },
      { name: "AAC", extensions: ["aac"] },
      { name: "WAV", extensions: ["wav"] },
      { name: "FLAC", extensions: ["flac"] }
    ]
  });

  return result.canceled ? null : result.filePath;
});

ipcMain.handle("output:pickFolder", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择导出路径",
    properties: ["openDirectory", "createDirectory"]
  });

  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("media:probe", async (_event, filePath) => {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-i", filePath]);
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", () => {
      reject(new Error("无法运行内置 ffmpeg。请重新安装应用或检查安装目录权限。"));
    });

    child.on("close", () => {
      try {
        resolve(parseFfmpegProbe(stderr, filePath));
      } catch (error) {
        reject(new Error(error.message || "ffmpeg 读取媒体信息失败。"));
      }
    });
  });
});

ipcMain.handle("encode:start", async (event, job) => {
  const jobId = crypto.randomUUID();
  const duration = Number(job.duration || 0);
  const commands = buildFfmpegCommands(job);
  const record = { child: null, cancelled: false };
  activeJobs.set(jobId, record);

  runCommandQueue(event, jobId, commands, duration).catch((error) => {
    activeJobs.delete(jobId);
    event.sender.send("encode:progress", {
      jobId,
      state: "failed",
      progress: 0,
      error: error.message
    });
  });

  return {
    jobId,
    commands: commands.map((command) => ({ label: command.label, args: command.args }))
  };
});

ipcMain.handle("encode:cancel", async (_event, jobId) => {
  const record = activeJobs.get(jobId);
  if (!record) return false;
  record.cancelled = true;
  if (record.child) record.child.kill("SIGTERM");
  return true;
});

async function runCommandQueue(event, jobId, commands, duration) {
  for (let index = 0; index < commands.length; index += 1) {
    const record = activeJobs.get(jobId);
    if (!record || record.cancelled) return;
    await runSingleCommand(event, jobId, commands[index], duration, index, commands.length);
  }

  activeJobs.delete(jobId);
  event.sender.send("encode:progress", {
    jobId,
    state: "done",
    progress: 100
  });
}

function runSingleCommand(event, jobId, command, duration, index, total) {
  return new Promise((resolve, reject) => {
    const record = activeJobs.get(jobId);
    if (!record) {
      resolve();
      return;
    }

    const child = spawn(ffmpegPath, command.args);
    record.child = child;

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      const stepProgress = parseProgress(text, duration);
      const progress =
        stepProgress === undefined ? undefined : Math.round(((index + stepProgress / 100) / total) * 100);
      event.sender.send("encode:progress", {
        jobId,
        state: "running",
        progress,
        log: text
      });
    });

    child.on("error", () => {
      reject(new Error("无法运行内置 ffmpeg。请重新安装应用或检查安装目录权限。"));
    });

    child.on("close", (code) => {
      const latest = activeJobs.get(jobId);
      if (latest?.cancelled) {
        activeJobs.delete(jobId);
        event.sender.send("encode:progress", {
          jobId,
          state: "cancelled"
        });
        resolve();
        return;
      }

      if (code !== 0) {
        reject(new Error(`${command.label} 失败，ffmpeg 退出码：${code}`));
        return;
      }

      resolve();
    });
  });
}

function buildFfmpegCommands(job) {
  const baseArgs = ["-y", "-i", job.inputPath];
  const outputArgs = buildOutputArgs(job);

  if (job.mode === "remux") {
    return [{ label: "重封装", args: [...baseArgs, "-map", "0", "-c", "copy", job.outputPath] }];
  }

  if (job.rateControl === "vbr2pass" && job.outputType !== "audio") {
    const passLog = `${job.outputPath}.passlog`;
    const firstPassOutput = process.platform === "win32" ? "NUL" : "/dev/null";
    const firstPass = [
      ...baseArgs,
      ...buildVideoArgs(job),
      "-an",
      "-pass",
      "1",
      "-passlogfile",
      passLog,
      "-f",
      "null",
      firstPassOutput
    ];
    const secondPass = [
      ...baseArgs,
      ...buildVideoArgs(job),
      ...buildAudioArgs(job),
      "-pass",
      "2",
      "-passlogfile",
      passLog,
      job.outputPath
    ];
    return [
      { label: "VBR 2pass 第一遍", args: firstPass },
      { label: "VBR 2pass 第二遍", args: secondPass }
    ];
  }

  return [{ label: "转码", args: [...baseArgs, ...outputArgs, job.outputPath] }];
}

function buildOutputArgs(job) {
  if (job.outputType === "audio") return ["-vn", ...buildAudioArgs(job)];
  return [...buildVideoArgs(job), ...buildAudioArgs(job)];
}

function buildVideoArgs(job) {
  const args = ["-c:v", resolveVideoCodec(job)];

  if (job.resolutionMode === "custom" && job.width && job.height) {
    args.push("-vf", buildVideoFilter(job));
  } else if (job.resolutionPreset && job.resolutionPreset !== "source") {
    args.push("-vf", buildVideoFilter(job));
  } else if (needsColorFilter(job)) {
    args.push("-vf", buildVideoFilter(job));
  }

  if (job.frameRate && job.frameRate !== "source") args.push("-r", String(job.frameRate));
  if (job.fieldOrder && job.fieldOrder !== "progressive") args.push("-field_order", job.fieldOrder);
  if (job.pixelFormat && job.pixelFormat !== "auto") args.push("-pix_fmt", job.pixelFormat);
  if (job.hdrMode === "pq") args.push("-color_trc", "smpte2084");
  if (job.hdrMode === "hlg") args.push("-color_trc", "arib-std-b67");
  if (job.colorSpace && job.colorSpace !== "source") args.push("-colorspace", job.colorSpace);

  if (job.rateControl === "cbr") {
    args.push(
      "-b:v",
      `${job.targetBitrate}k`,
      "-minrate",
      `${job.targetBitrate}k`,
      "-maxrate",
      `${job.targetBitrate}k`,
      "-bufsize",
      `${job.targetBitrate * 2}k`
    );
  }

  if (job.rateControl === "vbr2pass") {
    args.push("-b:v", `${job.targetBitrate}k`);
    if (job.maxBitrate) args.push("-maxrate", `${job.maxBitrate}k`, "-bufsize", `${job.maxBitrate * 2}k`);
  }

  if (job.rateControl === "quality") {
    if (usesHardwareQuality(job)) args.push("-cq", String(job.quality));
    else args.push("-crf", String(job.quality));
  }

  return args;
}

function buildAudioArgs(job) {
  if (!job.audioEnabled) return ["-an"];

  const args = ["-c:a", job.audioCodec || "aac"];
  if (job.audioBitrate) args.push("-b:a", `${job.audioBitrate}k`);
  if (job.sampleRate && job.sampleRate !== "source") args.push("-ar", String(job.sampleRate));
  if (job.channels && job.channels !== "source") args.push("-ac", String(job.channels));
  return args;
}

function resolveVideoCodec(job) {
  const profile = job.videoProfile;
  const hw = job.hardware;
  const table = {
    h264: { cpu: "libx264", nvenc: "h264_nvenc", qsv: "h264_qsv", amf: "h264_amf" },
    hevc: { cpu: "libx265", nvenc: "hevc_nvenc", qsv: "hevc_qsv", amf: "hevc_amf" },
    av1: { cpu: "libsvtav1", nvenc: "av1_nvenc", qsv: "av1_qsv", amf: "av1_amf" },
    avi: { cpu: "mpeg4", nvenc: "h264_nvenc", qsv: "h264_qsv", amf: "h264_amf" },
    quicktime: { cpu: "libx264", nvenc: "h264_nvenc", qsv: "h264_qsv", amf: "h264_amf" }
  };
  return table[profile]?.[hw] || table.h264.cpu;
}

function buildVideoFilter(job) {
  const filters = [];

  if (job.resolutionMode === "custom" && job.width && job.height) {
    filters.push(`scale=${job.width}:${job.height}`);
  } else if (job.resolutionPreset && job.resolutionPreset !== "source") {
    filters.push(`scale=${job.resolutionPreset}`);
  }

  if (job.aspectRatio && job.aspectRatio !== "source") {
    filters.push(`setsar=1,setdar=${job.aspectRatio}`);
  }

  if (needsColorFilter(job)) {
    filters.push(`colorspace=${job.colorConversion}`);
  }

  return filters.join(",");
}

function needsColorFilter(job) {
  return job.colorConversion && job.colorConversion !== "none";
}

function usesHardwareQuality(job) {
  return ["nvenc", "qsv", "amf"].includes(job.hardware);
}

function parseProgress(text, duration) {
  if (!duration) return undefined;
  const match = text.match(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return undefined;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const current = hours * 3600 + minutes * 60 + seconds;
  return Math.max(0, Math.min(100, Math.round((current / duration) * 100)));
}

function parseFfmpegProbe(stderr, filePath) {
  if (!stderr.includes("Input #")) {
    throw new Error("ffmpeg 未能读取媒体信息。");
  }

  const stats = fs.statSync(filePath);
  const formatMatch = stderr.match(/Input #0,\s*([^,]+(?:,[^,]+)*),\s*from/);
  const durationMatch = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  const duration = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : 0;

  const streams = [];
  for (const line of stderr.split(/\r?\n/)) {
    if (!line.includes("Stream #")) continue;
    if (line.includes(" Video: ")) streams.push(parseVideoStream(line));
    if (line.includes(" Audio: ")) streams.push(parseAudioStream(line));
  }

  return {
    format: {
      format_name: formatMatch ? formatMatch[1].trim() : "unknown",
      duration: String(duration),
      size: String(stats.size)
    },
    streams
  };
}

function parseVideoStream(line) {
  const codecMatch = line.match(/Video:\s*([^,\s]+)/);
  const resolutionMatch = line.match(/(\d{2,5})x(\d{2,5})/);
  const fpsMatch = line.match(/([\d.]+)\s*fps/);
  const pixelMatch = line.match(/,\s*([a-z0-9]+(?:p|le|be)?(?:\([^)]*\))?)[,\s]/i);
  const colorMatch = line.match(/\b(bt709|bt2020nc|bt2020|smpte170m|smpte240m)\b/i);
  const transferMatch = line.match(/\b(smpte2084|arib-std-b67|bt709)\b/i);

  return {
    codec_type: "video",
    codec_name: codecMatch ? codecMatch[1] : "unknown",
    width: resolutionMatch ? Number(resolutionMatch[1]) : undefined,
    height: resolutionMatch ? Number(resolutionMatch[2]) : undefined,
    avg_frame_rate: fpsMatch ? fpsMatch[1] : "-",
    pix_fmt: pixelMatch ? pixelMatch[1].replace(/\(.+\)/, "") : "unknown",
    color_space: colorMatch ? colorMatch[1] : "unknown",
    color_transfer: transferMatch ? transferMatch[1] : "unknown"
  };
}

function parseAudioStream(line) {
  const codecMatch = line.match(/Audio:\s*([^,\s]+)/);
  const sampleRateMatch = line.match(/(\d+)\s*Hz/);
  const channelMatch = line.match(/\b(mono|stereo|5\.1|7\.1)\b/i);

  return {
    codec_type: "audio",
    codec_name: codecMatch ? codecMatch[1] : "unknown",
    sample_rate: sampleRateMatch ? sampleRateMatch[1] : undefined,
    channels: channelCount(channelMatch?.[1])
  };
}

function channelCount(label) {
  if (!label) return undefined;
  const normalized = label.toLowerCase();
  if (normalized === "mono") return 1;
  if (normalized === "stereo") return 2;
  if (normalized === "5.1") return 6;
  if (normalized === "7.1") return 8;
  return undefined;
}

function resolveToolPath(toolName) {
  const extension = process.platform === "win32" ? ".exe" : "";
  const binaryName = `${toolName}${extension}`;
  const packagedPath = path.join(process.resourcesPath || "", "bin", binaryName);
  if (process.resourcesPath && fs.existsSync(packagedPath)) return packagedPath;

  const platformDir = resolveFfmpegPlatformDir();
  const devPath = path.join(__dirname, "..", "node_modules", "@ffmpeg-installer", platformDir, binaryName);
  if (fs.existsSync(devPath)) return devPath;

  return binaryName;
}

function resolveFfmpegPlatformDir() {
  if (process.platform === "win32") return "win32-x64";
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  }
  return `linux-${process.arch === "arm64" ? "arm64" : "x64"}`;
}

function resolveIconPath() {
  if (process.platform === "darwin") return path.join(__dirname, "../build/icon.icns");
  if (process.platform === "win32") return path.join(__dirname, "../build/icon.ico");
  return path.join(__dirname, "../build/icon.png");
}
