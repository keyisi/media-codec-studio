const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("codec", {
  pickMedia: () => ipcRenderer.invoke("media:pick"),
  pickOutput: (defaults) => ipcRenderer.invoke("output:pick", defaults),
  pickOutputFolder: () => ipcRenderer.invoke("output:pickFolder"),
  probe: (filePath) => ipcRenderer.invoke("media:probe", filePath),
  startEncode: (job) => ipcRenderer.invoke("encode:start", job),
  cancelEncode: (jobId) => ipcRenderer.invoke("encode:cancel", jobId),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("encode:progress", listener);
    return () => ipcRenderer.removeListener("encode:progress", listener);
  }
});
