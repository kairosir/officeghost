const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("assistantApi", {
  openPath: (filePath) => ipcRenderer.invoke("open-path", filePath),
  openInFolder: (filePath) => ipcRenderer.invoke("open-in-folder", filePath),
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  search: (query) => ipcRenderer.invoke("search", query),
  getIndexStatus: () => ipcRenderer.invoke("get-index-status"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  chooseFolders: () => ipcRenderer.invoke("choose-folders"),
  setRoots: (roots) => ipcRenderer.invoke("set-roots", roots),
  startIndexing: () => ipcRenderer.invoke("start-indexing"),
  pauseIndexing: () => ipcRenderer.invoke("pause-indexing"),
  refreshIndex: () => ipcRenderer.invoke("refresh-index"),
  openSettings: () => ipcRenderer.invoke("open-settings"),
  closeSettings: () => ipcRenderer.invoke("close-settings"),
  setWindowHeight: (h) => ipcRenderer.invoke("set-window-height", h),
  getReportPath: () => ipcRenderer.invoke("get-report-path"),
  openReport: () => ipcRenderer.invoke("open-report"),
  updateSettings: (partial) => ipcRenderer.invoke("update-settings", partial),
  getAiStatus: () => ipcRenderer.invoke("get-ai-status"),
  installAi: () => ipcRenderer.invoke("install-ai"),
  removeAi: () => ipcRenderer.invoke("remove-ai"),
  askAi: (query, filePaths) => ipcRenderer.invoke("ask-ai", query, filePaths),
  createFileFromAi: (payload) => ipcRenderer.invoke("create-file-from-ai", payload),
  getSystemProfile: () => ipcRenderer.invoke("get-system-profile"),
  getRecommendedModel: () => ipcRenderer.invoke("get-recommended-model")
});

ipcRenderer.on("focus-input", () => {
  window.dispatchEvent(new Event("focus-input"));
});

ipcRenderer.on("index-status", (_event, payload) => {
  const evt = new CustomEvent("index-status", { detail: payload });
  window.dispatchEvent(evt);
});

ipcRenderer.on("settings-updated", (_event, payload) => {
  const evt = new CustomEvent("settings-updated", { detail: payload });
  window.dispatchEvent(evt);
});

ipcRenderer.on("index-throttle", (_event, payload) => {
  const evt = new CustomEvent("index-throttle", { detail: payload });
  window.dispatchEvent(evt);
});

ipcRenderer.on("ai-status", (_event, payload) => {
  const evt = new CustomEvent("ai-status", { detail: payload });
  window.dispatchEvent(evt);
});

ipcRenderer.on("ai-progress", (_event, payload) => {
  const evt = new CustomEvent("ai-progress", { detail: payload });
  window.dispatchEvent(evt);
});
