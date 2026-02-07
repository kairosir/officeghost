const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("assistantApi", {
  openPath: (filePath) => ipcRenderer.invoke("open-path", filePath),
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  search: (query) => ipcRenderer.invoke("search", query),
  getIndexStatus: () => ipcRenderer.invoke("get-index-status"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  chooseFolders: () => ipcRenderer.invoke("choose-folders"),
  setRoots: (roots) => ipcRenderer.invoke("set-roots", roots),
  startIndexing: () => ipcRenderer.invoke("start-indexing"),
  pauseIndexing: () => ipcRenderer.invoke("pause-indexing"),
  refreshIndex: () => ipcRenderer.invoke("refresh-index")
});

ipcRenderer.on("focus-input", () => {
  window.dispatchEvent(new Event("focus-input"));
});

ipcRenderer.on("index-status", (_event, payload) => {
  const evt = new CustomEvent("index-status", { detail: payload });
  window.dispatchEvent(evt);
});
