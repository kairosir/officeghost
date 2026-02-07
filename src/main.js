const { app, BrowserWindow, globalShortcut, ipcMain, shell, screen, dialog, Tray, Menu, nativeImage } = require("electron");
const { fork } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");

let mainWindow = null;
let indexStatus = { state: "idle", scanned: 0, fileCount: 0, roots: [] };
let indexData = { files: {} };
let indexPath = "";
let settingsPath = "";
let settings = { roots: [], paused: false };
let indexWorker = null;
let tray = null;

function getDefaultRoots() {
  const roots = [];
  const safePush = (p) => {
    if (p && fs.existsSync(p) && !roots.includes(p)) roots.push(p);
  };

  try {
    safePush(app.getPath("downloads"));
    safePush(app.getPath("desktop"));
  } catch {
    const home = os.homedir();
    safePush(path.join(home, "Downloads"));
    safePush(path.join(home, "Загрузки"));
    safePush(path.join(home, "Desktop"));
    safePush(path.join(home, "Рабочий стол"));
  }

  safePush("/downloads");
  safePush("/Downloads");

  if (process.platform === "win32") {
    const dDrive = "D:\\";
    safePush(dDrive);
  }

  return roots;
}

function getCoreRoots() {
  const roots = [];
  const safePush = (p) => {
    if (p && fs.existsSync(p) && !roots.includes(p)) roots.push(p);
  };

  try {
    safePush(app.getPath("downloads"));
    safePush(app.getPath("desktop"));
  } catch {
    const home = os.homedir();
    safePush(path.join(home, "Downloads"));
    safePush(path.join(home, "Загрузки"));
    safePush(path.join(home, "Desktop"));
    safePush(path.join(home, "Рабочий стол"));
  }

  if (process.platform === "win32") {
    const dDrive = "D:\\";
    safePush(dDrive);
  }

  return roots;
}

function normalizeRoots(roots) {
  if (!Array.isArray(roots)) return [];
  const unique = [];
  for (const root of roots) {
    if (typeof root !== "string") continue;
    if (!fs.existsSync(root)) continue;
    if (!unique.includes(root)) unique.push(root);
  }
  return unique;
}

function mergeRoots(base, extra) {
  const merged = normalizeRoots(base);
  for (const root of normalizeRoots(extra)) {
    if (!merged.includes(root)) merged.push(root);
  }
  return merged;
}

function loadSettings() {
  try {
    if (!fs.existsSync(settingsPath)) {
      settings = { roots: getDefaultRoots(), paused: false };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
      return;
    }
    const raw = fs.readFileSync(settingsPath, "utf8");
    settings = JSON.parse(raw);
    settings.roots = normalizeRoots(settings.roots);
    settings.roots = mergeRoots(settings.roots, getCoreRoots());
    if (!settings.roots.length) settings.roots = getDefaultRoots();
  } catch {
    settings = { roots: getDefaultRoots(), paused: false };
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  } catch {
    // ignore
  }
}

function loadIndex() {
  try {
    if (!fs.existsSync(indexPath)) return;
    const raw = fs.readFileSync(indexPath, "utf8");
    indexData = JSON.parse(raw);
    if (indexData?.files && Object.keys(indexData.files).length) {
      indexStatus = {
        ...indexStatus,
        state: "ready",
        fileCount: Object.keys(indexData.files).length
      };
    }
  } catch {
    indexData = { files: {} };
  }
}

function startIndexing() {
  let roots = settings.roots?.length ? settings.roots : getDefaultRoots();
  roots = normalizeRoots(roots);
  roots = mergeRoots(roots, getCoreRoots());
  if (!roots.length) roots = getDefaultRoots();
  if (!roots.length) return;

  if (indexWorker) {
    indexWorker.kill();
    indexWorker = null;
  }

  const indexerPath = path.join(__dirname, "indexer", "indexer.js");
  const worker = fork(indexerPath, { stdio: ["inherit", "inherit", "inherit", "ipc"] });
  indexWorker = worker;

  indexStatus = { state: "indexing", scanned: 0, fileCount: 0, roots };

  worker.on("message", (message) => {
    if (!message) return;
    if (message.type === "progress") {
      indexStatus = { ...indexStatus, scanned: message.scanned };
      mainWindow?.webContents.send("index-status", indexStatus);
    }
    if (message.type === "status") {
      indexStatus = { ...indexStatus, state: message.state };
      mainWindow?.webContents.send("index-status", indexStatus);
    }
    if (message.type === "done") {
      loadIndex();
      indexStatus = {
        ...indexStatus,
        state: "ready",
        fileCount: Object.keys(indexData.files || {}).length
      };
      mainWindow?.webContents.send("index-status", indexStatus);
    }
  });

  worker.send({ type: "start", roots, indexPath });
}

function stopIndexing() {
  if (indexWorker) {
    indexWorker.kill();
    indexWorker = null;
  }
  indexStatus = { ...indexStatus, state: "paused" };
  mainWindow?.webContents.send("index-status", indexStatus);
}

function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(900, Math.floor(width * 0.8)),
    height: 440,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.on("blur", () => {
    if (!mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.hide();
    }
  });
}

function getTrayIcon() {
  const iconPath = path.join(__dirname, "assets", "trayTemplate.png");
  if (fs.existsSync(iconPath)) return nativeImage.createFromPath(iconPath);
  return nativeImage.createEmpty();
}

function createTray() {
  if (tray) return;
  tray = new Tray(getTrayIcon());
  const menu = Menu.buildFromTemplate([
    { label: "Показать", click: () => toggleWindow() },
    { type: "separator" },
    { label: "Выход", click: () => app.quit() }
  ]);
  tray.setToolTip("AI Assistant");
  tray.setContextMenu(menu);
  tray.on("click", () => toggleWindow());
}

function toggleWindow() {
  if (!mainWindow) return;

  if (mainWindow.isVisible()) {
    mainWindow.hide();
    return;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const winBounds = mainWindow.getBounds();
  const x = Math.floor((width - winBounds.width) / 2);
  const y = Math.floor(height * 0.15);

  mainWindow.setPosition(x, y, false);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("focus-input");
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  globalShortcut.register("CommandOrControl+1", () => {
    toggleWindow();
  });

  indexPath = path.join(app.getPath("userData"), "index.json");
  settingsPath = path.join(app.getPath("userData"), "settings.json");
  loadSettings();
  loadIndex();
  if (!settings.paused) startIndexing();

  app.setLoginItemSettings({ openAtLogin: true });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

ipcMain.handle("open-path", async (_event, filePath) => {
  if (typeof filePath !== "string") return;
  await shell.openPath(filePath);
});

ipcMain.handle("hide-window", async () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle("search", async (_event, query) => {
  if (typeof query !== "string") return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results = [];
  const items = Object.values(indexData.files || {});

  const makeSnippet = (text) => {
    if (!text) return "";
    const lower = text.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx === -1) return text.slice(0, 160).replace(/\s+/g, " ");
    const start = Math.max(0, idx - 60);
    const end = Math.min(text.length, idx + q.length + 80);
    return text.slice(start, end).replace(/\s+/g, " ");
  };

  for (const item of items) {
    const nameMatch = item.name?.toLowerCase().includes(q);
    const pathMatch = item.path?.toLowerCase().includes(q);
    const textMatch = item.text?.toLowerCase().includes(q);

    if (nameMatch || pathMatch || textMatch) {
      const score = (nameMatch ? 3 : 0) + (pathMatch ? 1 : 0) + (textMatch ? 1 : 0);
      results.push({
        title: item.name,
        path: item.path,
        snippet: makeSnippet(item.text || ""),
        score
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 20);
});

ipcMain.handle("get-index-status", async () => indexStatus);

ipcMain.handle("get-settings", async () => settings);


ipcMain.handle("choose-folders", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "multiSelections"]
  });
  if (result.canceled) return settings;
  settings.roots = result.filePaths || [];
  saveSettings();
  return settings;
});

ipcMain.handle("set-roots", async (_event, roots) => {
  if (!Array.isArray(roots)) return settings;
  settings.roots = roots;
  saveSettings();
  return settings;
});

ipcMain.handle("start-indexing", async () => {
  settings.paused = false;
  saveSettings();
  startIndexing();
  return indexStatus;
});

ipcMain.handle("pause-indexing", async () => {
  settings.paused = true;
  saveSettings();
  stopIndexing();
  return indexStatus;
});

ipcMain.handle("refresh-index", async () => {
  try {
    if (fs.existsSync(indexPath)) fs.unlinkSync(indexPath);
  } catch {
    // ignore
  }
  indexData = { files: {} };
  indexStatus = { state: "indexing", scanned: 0, fileCount: 0, roots: settings.roots || [] };
  settings.paused = false;
  saveSettings();
  startIndexing();
  return indexStatus;
});
