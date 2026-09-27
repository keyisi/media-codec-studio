import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  CheckCircle2,
  CircleStop,
  FileAudio,
  FileVideo,
  FolderOpen,
  Gauge,
  Info,
  Play,
  Settings2,
  Video,
  Wand2
} from "lucide-react";

const defaultPreset = {
  mode: "transcode",
  outputType: "video",
  videoProfile: "h264",
  container: "mp4",
  hardware: "cpu",
  rateControl: "quality",
  targetBitrate: 5000,
  maxBitrate: 8000,
  quality: 23,
  resolutionMode: "source",
  resolutionPreset: "source",
  width: 1920,
  height: 1080,
  aspectRatio: "source",
  frameRate: "source",
  fieldOrder: "progressive",
  pixelFormat: "yuv420p",
  hdrMode: "off",
  colorSpace: "source",
  colorConversion: "none",
  audioEnabled: true,
  audioCodec: "aac",
  sampleRate: "source",
  channels: "source",
  audioBitrate: 160
};

const codecApi = window.codec ?? {
  pickMedia: async () => [],
  pickOutput: async () => null,
  pickOutputFolder: async () => null,
  probe: async () => {
    throw new Error("请在 Electron 桌面窗口中使用文件读取和转码功能。");
  },
  startEncode: async () => {
    throw new Error("请在 Electron 桌面窗口中启动转码任务。");
  },
  cancelEncode: async () => false,
  pathForFile: (file) => file?.path || "",
  onProgress: () => () => {}
};

const outputProfiles = [
  { value: "h264", label: "H.264" },
  { value: "hevc", label: "HEVC" },
  { value: "av1", label: "AV1" },
  { value: "avi", label: "AVI" },
  { value: "quicktime", label: "QuickTime" },
  { value: "audio", label: "纯音频" }
];

const hardwareOptions = [
  { value: "cpu", label: "CPU 软件编码" },
  { value: "qsv", label: "Intel QSV" },
  { value: "nvenc", label: "NVIDIA NVENC" },
  { value: "amf", label: "AMD AMF" }
];

const audioCodecs = [
  { value: "aac", label: "AAC" },
  { value: "libmp3lame", label: "MP3" },
  { value: "libopus", label: "Opus" },
  { value: "flac", label: "FLAC" },
  { value: "pcm_s16le", label: "WAV PCM" }
];

const containerByProfile = {
  h264: "mp4",
  hevc: "mp4",
  av1: "mp4",
  avi: "avi",
  quicktime: "mov",
  audio: "m4a"
};

const audioContainers = ["m4a", "aac", "mp3", "wav", "flac", "opus"];

export default function App() {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [preset, setPreset] = useState(defaultPreset);
  const [status, setStatus] = useState("准备就绪");
  const [dragActive, setDragActive] = useState(false);
  const [exportDir, setExportDir] = useState("");
  const [exportName, setExportName] = useState("");
  const dragDepth = useRef(0);
  const selected = items.find((item) => item.id === selectedId) || items[0];

  useEffect(() => {
    const off = codecApi.onProgress((payload) => {
      setItems((current) =>
        current.map((item) =>
          item.jobId === payload.jobId
            ? {
                ...item,
                progress: payload.progress ?? item.progress,
                state: payload.state,
                error: payload.error,
                log: payload.log ? [...item.log.slice(-6), payload.log] : item.log
              }
            : item
        )
      );
    });
    return off;
  }, []);

  const mediaStats = useMemo(() => summarizeMedia(selected?.probe), [selected]);

  async function addMedia() {
    setStatus("正在选择文件");
    const paths = await codecApi.pickMedia();
    await addPaths(paths);
  }

  async function addPaths(paths) {
    const cleanPaths = [...new Set(paths.filter(Boolean))];
    if (!cleanPaths.length) {
      setStatus("准备就绪");
      return;
    }

    const nextItems = cleanPaths.map((filePath) => ({
      id: crypto.randomUUID(),
      filePath,
      name: basename(filePath),
      state: "probing",
      progress: 0,
      log: []
    }));

    setItems((current) => [...current, ...nextItems]);
    setSelectedId(nextItems[0].id);
    setStatus("正在读取媒体信息");

    for (const item of nextItems) {
      try {
        const probe = await codecApi.probe(item.filePath);
        setItems((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  probe,
                  state: "ready",
                  duration: Number(probe.format?.duration || 0)
                }
              : entry
          )
        );
      } catch (error) {
        setItems((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, state: "failed", error: error.message } : entry
          )
        );
      }
    }

    setStatus("准备就绪");
  }

  function preventFileNavigation(event) {
    event.preventDefault();
  }

  function handleDragEnter(event) {
    event.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  }

  function handleDragOver(event) {
    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(event) {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }

  async function handleDrop(event) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const paths = Array.from(event.dataTransfer.files).map((file) => codecApi.pathForFile(file));
    await addPaths(paths);
  }

  function handleDragEnd() {
    dragDepth.current = 0;
    setDragActive(false);
  }

  function removeItem(event, itemId) {
    event.stopPropagation();
    setItems((current) => {
      const next = current.filter((item) => item.id !== itemId);
      if (selectedId === itemId) setSelectedId(next[0]?.id || null);
      return next;
    });
  }

  async function startSelected() {
    if (!selected) return;
    const extension = preset.container;
    const suggested = resolveOutputFileName({
      customName: exportName,
      sourceName: selected.name,
      extension,
      mode: preset.mode,
      itemIndex: items.findIndex((item) => item.id === selected.id),
      itemCount: items.length
    });
    const outputPath = exportDir
      ? joinPath(exportDir, suggested)
      : await codecApi.pickOutput({ defaultPath: suggested });
    if (!outputPath) return;

    const job = {
      ...preset,
      inputPath: selected.filePath,
      outputPath,
      duration: selected.duration
    };

    const result = await codecApi.startEncode(job);
    const args = result.commands?.map((command) => `ffmpeg ${command.args.join(" ")}`) || [];
    setItems((current) =>
      current.map((item) =>
        item.id === selected.id
          ? { ...item, jobId: result.jobId, outputPath, state: "running", progress: 0, args }
          : item
      )
    );
    setStatus(preset.mode === "remux" ? "重封装任务已启动" : "转码任务已启动");
  }

  async function chooseExportDir() {
    const folder = await codecApi.pickOutputFolder();
    if (!folder) return;
    setExportDir(folder);
    setStatus("导出路径已设置");
  }

  async function cancelSelected() {
    if (!selected?.jobId) return;
    await codecApi.cancelEncode(selected.jobId);
    setItems((current) =>
      current.map((item) => (item.id === selected.id ? { ...item, state: "cancelled" } : item))
    );
  }

  function updatePreset(key, value) {
    setPreset((current) => {
      const next = { ...current, [key]: value };

      if (key === "videoProfile") {
        next.outputType = value === "audio" ? "audio" : "video";
        next.container = containerByProfile[value] || "mp4";
        if (value === "audio") next.audioEnabled = true;
      }

      if (key === "mode" && value === "remux") {
        next.audioEnabled = true;
      }

      return next;
    });
  }

  const isRemux = preset.mode === "remux";
  const isAudioOnly = preset.outputType === "audio";

  return (
    <main
      className="shell"
      onDragOver={preventFileNavigation}
      onDrop={preventFileNavigation}
    >
      <aside
        className={`sidebar ${dragActive ? "dragging" : ""}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
      >
        {dragActive && <div className="dropOverlay">释放文件以加入转码队列</div>}
        <div className="sidebarStatus">{status}</div>
        <button className="primaryButton" type="button" onClick={addMedia}>
          <FolderOpen size={18} />
          导入或拖拽文件
        </button>

        <section className="queue" aria-label="转码队列">
          {items.length === 0 ? (
            <div className="empty">
              <FileVideo size={30} />
              <p>拖拽文件到窗口，或点击导入开始。</p>
            </div>
          ) : (
            items.map((item) => (
              <div
                className={`queueItem ${selected?.id === item.id ? "active" : ""}`}
                key={item.id}
              >
                <button className="queueSelect" type="button" onClick={() => setSelectedId(item.id)}>
                  <span className="queueIcon">
                    {preset.outputType === "audio" ? <FileAudio size={17} /> : <FileVideo size={17} />}
                  </span>
                  <span className="queueText">
                    <strong>{item.name}</strong>
                    <small>{stateLabel(item.state)} {item.progress ? `· ${item.progress}%` : ""}</small>
                  </span>
                </button>
                <button
                  className="queueDelete"
                  type="button"
                  title="删除文件"
                  aria-label={`删除 ${item.name}`}
                  onClick={(event) => removeItem(event, item.id)}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </section>
      </aside>

      <section className="workspace">
        <section className="panel progressPanel">
          <div className="panelTitle">
            <Gauge size={18} />
            任务进度
          </div>
          <div className="progressHeader">
            <span>{selected ? stateLabel(selected.state) : "无任务"}</span>
            <strong>{selected?.progress || 0}%</strong>
          </div>
          <div className="progressTrack">
            <div className="progressFill" style={{ width: `${selected?.progress || 0}%` }} />
          </div>
          {selected?.state === "done" && (
            <p className="success"><CheckCircle2 size={17} /> 已输出到 {selected.outputPath}</p>
          )}
          {selected?.error && <p className="errorText">{selected.error}</p>}
          {selected?.args?.length > 0 && (
            <code className="commandLine">{selected.args.join("\n\n")}</code>
          )}
          {isRemux && (
            <p className="hint"><Wand2 size={16} /> 重封装不会重新编码，只更换容器，通常速度接近即时完成。</p>
          )}
        </section>

        <header className="topbar">
          <div>
            <span className="eyebrow">专业转码工作台</span>
            <h2>{selected ? selected.name : "等待导入文件"}</h2>
          </div>
          <div className="actions">
            <button type="button" className="ghostButton" onClick={cancelSelected} disabled={!selected?.jobId || selected?.state !== "running"}>
              <CircleStop size={18} />
              停止
            </button>
            <button type="button" className="primaryButton compact" onClick={startSelected} disabled={!selected || selected.state === "running"}>
              <Play size={18} />
              {isRemux ? "开始重封装" : "开始转码"}
            </button>
          </div>
        </header>

        <div className="grid wide">
          <section className="panel summaryPanel">
            <div className="panelTitle">
              <Info size={18} />
              摘要
            </div>
            {mediaStats ? (
              <div className="stats">
                <Metric label="容器 / 时长 / 大小" value={`${mediaStats.container} · ${mediaStats.duration} · ${mediaStats.size}`} />
                <Metric label="视频基础信息" value={mediaStats.video} />
                <Metric label="音频基础信息" value={mediaStats.audio} />
                <Metric label="色彩 / HDR" value={mediaStats.color} />
                <Metric label="输出计划" value={buildPlanText(preset)} />
              </div>
            ) : (
              <div className="placeholder">导入文件后自动读取视频、音频、色彩和时长信息。</div>
            )}
          </section>

          <section className="panel settingsPanel">
            <div className="panelTitle">
              <Settings2 size={18} />
              编码设置
            </div>

            <div className="sectionBlock">
              <h3>导出设置</h3>
              <div className="exportSettings">
                <label className="field outputNameField">
                  <span>导出文件名（不含扩展名）</span>
                  <input
                    type="text"
                    value={exportName}
                    placeholder={selected ? buildOutputBaseName(selected.name, preset.mode) : "自动生成"}
                    onChange={(event) => setExportName(event.target.value)}
                  />
                </label>
                <div className="field">
                  <span>扩展名</span>
                  <div className="extensionBadge">.{preset.container}</div>
                </div>
                <div className="exportPath">
                  <span title={exportDir || "未设置导出路径"}>{exportDir || "未设置导出路径"}</span>
                  <button type="button" className="ghostButton iconText" onClick={chooseExportDir}>
                    <FolderOpen size={17} />
                    选择路径
                  </button>
                  {exportDir && (
                    <button type="button" className="ghostButton smallButton" onClick={() => setExportDir("")}>
                      清除
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="sectionBlock">
              <h3>格式与硬件</h3>
              <div className="formGrid">
                <Segmented
                  label="模式"
                  value={preset.mode}
                  options={[
                    { value: "transcode", label: "转码" },
                    { value: "remux", label: "重封装" }
                  ]}
                  onChange={(value) => updatePreset("mode", value)}
                />
                <Select label="输出格式" value={preset.videoProfile} options={outputProfiles} onChange={(value) => updatePreset("videoProfile", value)} />
                <Select label="封装容器" value={preset.container} options={isAudioOnly ? audioContainers : ["mp4", "mkv", "mov", "avi", "webm"]} onChange={(value) => updatePreset("container", value)} />
                <Select label="GPU 加速" value={preset.hardware} options={hardwareOptions} onChange={(value) => updatePreset("hardware", value)} disabled={isRemux || isAudioOnly} />
              </div>
            </div>

            {!isRemux && !isAudioOnly && (
              <>
                <div className="sectionBlock">
                  <h3>比特率控制</h3>
                  <div className="formGrid">
                    <Select
                      label="码率模式"
                      value={preset.rateControl}
                      options={[
                        { value: "cbr", label: "固定码率 CBR" },
                        { value: "vbr2pass", label: "可变码率 VBR / 2pass" },
                        { value: "quality", label: "恒定质量 CRF / CQ" }
                      ]}
                      onChange={(value) => updatePreset("rateControl", value)}
                    />
                    {preset.rateControl === "quality" ? (
                      <NumberInput label="质量值 CRF/CQ" value={preset.quality} min={0} max={51} step={1} onChange={(value) => updatePreset("quality", value)} />
                    ) : (
                      <NumberInput label="目标比特率 kbps" value={preset.targetBitrate} min={128} step={128} onChange={(value) => updatePreset("targetBitrate", value)} />
                    )}
                    {preset.rateControl === "vbr2pass" && (
                      <NumberInput label="最大比特率 kbps" value={preset.maxBitrate} min={128} step={128} onChange={(value) => updatePreset("maxBitrate", value)} />
                    )}
                  </div>
                </div>

                <div className="sectionBlock">
                  <h3>画面</h3>
                  <div className="formGrid">
                    <Select
                      label="分辨率"
                      value={preset.resolutionMode}
                      options={[
                        { value: "source", label: "保持原始" },
                        { value: "preset", label: "常用尺寸" },
                        { value: "custom", label: "手动设置" }
                      ]}
                      onChange={(value) => updatePreset("resolutionMode", value)}
                    />
                    {preset.resolutionMode === "preset" && (
                      <Select label="常用尺寸" value={preset.resolutionPreset} options={["source", "3840:-2", "2560:-2", "1920:-2", "1280:-2", "854:-2"]} onChange={(value) => updatePreset("resolutionPreset", value)} />
                    )}
                    {preset.resolutionMode === "custom" && (
                      <>
                        <NumberInput label="宽度" value={preset.width} min={16} step={2} onChange={(value) => updatePreset("width", value)} />
                        <NumberInput label="高度" value={preset.height} min={16} step={2} onChange={(value) => updatePreset("height", value)} />
                      </>
                    )}
                    <Select label="视频比例" value={preset.aspectRatio} options={["source", "16/9", "4/3", "1/1", "21/9"]} onChange={(value) => updatePreset("aspectRatio", value)} />
                    <Select label="帧率" value={preset.frameRate} options={[
                      { value: "source", label: "保持原始" },
                      { value: "24000/1001", label: "23.976 NTSC Film" },
                      { value: "24", label: "24 Cinema" },
                      { value: "25", label: "25 PAL" },
                      { value: "30000/1001", label: "29.97 NTSC" },
                      { value: "30", label: "30" },
                      { value: "50", label: "50 PAL" },
                      { value: "60000/1001", label: "59.94 NTSC" },
                      { value: "60", label: "60" }
                    ]} onChange={(value) => updatePreset("frameRate", value)} />
                    <Select label="场序" value={preset.fieldOrder} options={[
                      { value: "progressive", label: "逐行 Progressive" },
                      { value: "tt", label: "上场优先 Top Field First" },
                      { value: "bb", label: "下场优先 Bottom Field First" }
                    ]} onChange={(value) => updatePreset("fieldOrder", value)} />
                  </div>
                </div>

                <div className="sectionBlock">
                  <h3>色彩与 HDR</h3>
                  <div className="formGrid">
                    <Select label="色深" value={preset.pixelFormat} options={[
                      { value: "yuv420p", label: "8bit 4:2:0" },
                      { value: "yuv420p10le", label: "10bit 4:2:0" },
                      { value: "auto", label: "自动" }
                    ]} onChange={(value) => updatePreset("pixelFormat", value)} />
                    <Select label="HDR 曲线" value={preset.hdrMode} options={[
                      { value: "off", label: "关闭 / SDR" },
                      { value: "pq", label: "HDR PQ" },
                      { value: "hlg", label: "HDR HLG" }
                    ]} onChange={(value) => updatePreset("hdrMode", value)} />
                    <Select label="输出色彩空间" value={preset.colorSpace} options={[
                      { value: "source", label: "保持原始" },
                      { value: "bt709", label: "Rec.709" },
                      { value: "bt2020nc", label: "BT.2020" }
                    ]} onChange={(value) => updatePreset("colorSpace", value)} />
                    <Select label="色彩空间转换" value={preset.colorConversion} options={[
                      { value: "none", label: "不转换" },
                      { value: "all=bt709", label: "转换到 Rec.709" },
                      { value: "all=bt2020", label: "Rec.709 转 BT.2020" }
                    ]} onChange={(value) => updatePreset("colorConversion", value)} />
                  </div>
                </div>
              </>
            )}

            {!isRemux && (
              <div className="sectionBlock">
                <h3>音频设置</h3>
                <div className="formGrid">
                  <Toggle label="启用音频" checked={preset.audioEnabled} onChange={(value) => updatePreset("audioEnabled", value)} disabled={isAudioOnly} />
                  <Select label="音频编码" value={preset.audioCodec} options={audioCodecs} onChange={(value) => updatePreset("audioCodec", value)} disabled={!preset.audioEnabled} />
                  <Select label="采样率" value={preset.sampleRate} options={[
                    { value: "source", label: "保持原始" },
                    { value: "44100", label: "44.1 kHz" },
                    { value: "48000", label: "48 kHz" },
                    { value: "96000", label: "96 kHz" }
                  ]} onChange={(value) => updatePreset("sampleRate", value)} disabled={!preset.audioEnabled} />
                  <Select label="通道" value={preset.channels} options={[
                    { value: "source", label: "保持原始" },
                    { value: "1", label: "单声道" },
                    { value: "2", label: "立体声" },
                    { value: "6", label: "5.1 声道" }
                  ]} onChange={(value) => updatePreset("channels", value)} disabled={!preset.audioEnabled} />
                  <NumberInput label="音频比特率 kbps" value={preset.audioBitrate} min={32} step={32} onChange={(value) => updatePreset("audioBitrate", value)} disabled={!preset.audioEnabled} />
                </div>
              </div>
            )}
          </section>
        </div>

      </section>
    </main>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Select({ label, value, options, onChange, disabled = false }) {
  const normalized = options.map((option) =>
    typeof option === "string" ? { value: option, label: option === "source" ? "保持原始" : option } : option
  );
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        {normalized.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function NumberInput({ label, value, onChange, min = 32, max, step = 32, disabled = false }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Toggle({ label, checked, onChange, disabled = false }) {
  return (
    <label className="toggleField">
      <span>{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="segmented">
        {options.map((option) => (
          <button
            key={option.value}
            className={option.value === value ? "selected" : ""}
            type="button"
            onClick={() => onChange(option.value)}
          >
            {option.value === "remux" ? <Wand2 size={16} /> : <Video size={16} />}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function summarizeMedia(probe) {
  if (!probe) return null;
  const videoStream = probe.streams.find((stream) => stream.codec_type === "video");
  const audioStream = probe.streams.find((stream) => stream.codec_type === "audio");
  const color = videoStream
    ? `${videoStream.pix_fmt || "unknown"} · ${videoStream.color_space || "unknown"} · ${videoStream.color_transfer || "SDR/unknown"}`
    : "无视频色彩信息";

  return {
    container: probe.format?.format_name || "unknown",
    duration: formatDuration(Number(probe.format?.duration || 0)),
    size: formatBytes(Number(probe.format?.size || 0)),
    video: videoStream
      ? `${videoStream.codec_name || "unknown"} · ${videoStream.width || "-"}x${videoStream.height || "-"} · ${videoStream.avg_frame_rate || "-"} fps`
      : "无视频流",
    audio: audioStream
      ? `${audioStream.codec_name || "unknown"} · ${audioStream.channels || "-"}ch · ${audioStream.sample_rate || "-"}Hz`
      : "无音频流",
    color
  };
}

function buildPlanText(preset) {
  if (preset.mode === "remux") return `${preset.container.toUpperCase()} · 重封装 · -c copy`;
  if (preset.outputType === "audio") return `${preset.container.toUpperCase()} · 纯音频 · ${labelFor(audioCodecs, preset.audioCodec)}`;

  const rc = preset.rateControl === "quality"
    ? `CRF/CQ ${preset.quality}`
    : preset.rateControl === "cbr"
      ? `CBR ${preset.targetBitrate} kbps`
      : `VBR 2pass ${preset.targetBitrate}/${preset.maxBitrate} kbps`;
  return `${labelFor(outputProfiles, preset.videoProfile)} · ${labelFor(hardwareOptions, preset.hardware)} · ${rc}`;
}

function labelFor(options, value) {
  return options.find((option) => option.value === value)?.label || value;
}

function basename(filePath) {
  return filePath.split(/[\\/]/).pop();
}

function stripExtension(fileName) {
  return fileName.replace(/\.[^.\\/]+$/, "");
}

function buildOutputFileName(fileName, extension, mode) {
  return `${buildOutputBaseName(fileName, mode)}.${extension}`;
}

function buildOutputBaseName(fileName, mode) {
  const suffix = mode === "remux" ? "remux" : "encoded";
  return `${stripExtension(fileName)}_${suffix}`;
}

function resolveOutputFileName({ customName, sourceName, extension, mode, itemIndex, itemCount }) {
  const trimmed = sanitizeFileName(customName.trim());
  if (!trimmed) return buildOutputFileName(sourceName, extension, mode);

  const base = stripExtension(trimmed);
  const numberedBase = itemCount > 1 ? `${base}_${String(itemIndex + 1).padStart(2, "0")}` : base;
  return `${numberedBase}.${extension}`;
}

function sanitizeFileName(fileName) {
  return fileName.replace(/[<>:"/\\|?*]/g, "_");
}

function joinPath(folder, fileName) {
  const separator = folder.includes("\\") ? "\\" : "/";
  return folder.endsWith("\\") || folder.endsWith("/") ? `${folder}${fileName}` : `${folder}${separator}${fileName}`;
}

function stateLabel(state) {
  const labels = {
    probing: "读取中",
    ready: "待处理",
    running: "处理中",
    done: "已完成",
    failed: "失败",
    cancelled: "已停止"
  };
  return labels[state] || "待处理";
}

function formatDuration(seconds) {
  if (!seconds) return "-";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function formatBytes(bytes) {
  if (!bytes) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
