const { app, BrowserWindow, globalShortcut, ipcMain, shell, screen, dialog, Tray, Menu, nativeImage } = require("electron");
const { fork, spawn } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");

let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch {
  autoUpdater = null;
}

let mainWindow = null;
let settingsWindow = null;
let sortWindow = null;
let indexStatus = { state: "idle", scanned: 0, total: 0, fileCount: 0, roots: [], byExt: {}, scannedByExt: {}, lastError: null };
let indexData = { files: {} };
let indexPath = "";
let settingsPath = "";
let settings = {
  roots: [],
  paused: false,
  hotkey: "Control+1",
  theme: "dark",
  rememberQuery: true,
  rememberPos: false,
  windowPos: null,
  opacity: 0.92,
  indexIntervalSec: 60,
  maxFileSizeMb: 20,
  unlimitedIndexing: false,
  aiModel: "qwen2.5:1.5b",
  licenseEmail: "",
  licenseKey: "",
  licenseStatus: "FREE"
};
let indexWorker = null;
let indexRunId = 0;
let tray = null;
let indexIntervalTimer = null;
let mainWindowPrevBounds = null;

const AI_MODEL = "qwen2.5:3b";
let aiStatePath = "";
let aiStatus = { installed: false, installing: false, model: AI_MODEL, progress: "", error: "" };
let sortStatus = { running: false, phase: "idle", processed: 0, total: 0, groups: 0, copies: 0, error: "" };
let sortSessionId = 0;
let lastDuplicateResult = { groups: [], total: 0, copies: 0 };

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
let updateCheckTimer = null;
let manualUpdateCheck = false;
let updateDownloadedInfo = null;

function getRustIndexerPath() {
  if (process.env.RUST_INDEXER && fs.existsSync(process.env.RUST_INDEXER)) {
    return process.env.RUST_INDEXER;
  }
  const binName = process.platform === "win32" ? "rust-indexer.exe" : "rust-indexer";
  const rootDir = path.join(__dirname, "..");
  const releasePath = path.join(rootDir, "rust-indexer", "target", "release", binName);
  const debugPath = path.join(rootDir, "rust-indexer", "target", "debug", binName);
  if (fs.existsSync(releasePath)) return releasePath;
  if (fs.existsSync(debugPath)) return debugPath;
  return null;
}

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
      settings = {
        roots: getDefaultRoots(),
        paused: false,
        hotkey: "Control+1",
        theme: "dark",
        rememberQuery: true,
        rememberPos: false,
        windowPos: null,
        opacity: 0.92,
        indexIntervalSec: 60,
        maxFileSizeMb: 20,
        unlimitedIndexing: false,
        aiModel: "qwen2.5:1.5b",
        licenseEmail: "",
        licenseKey: "",
        licenseStatus: "FREE"
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
      return;
    }
    const raw = fs.readFileSync(settingsPath, "utf8");
    settings = JSON.parse(raw);
    settings.roots = normalizeRoots(settings.roots);
    settings.roots = mergeRoots(settings.roots, getCoreRoots());
    if (!settings.roots.length) settings.roots = getDefaultRoots();
    if (!settings.hotkey) settings.hotkey = "Control+1";
    if (!settings.theme) settings.theme = "dark";
    if (typeof settings.rememberQuery !== "boolean") settings.rememberQuery = true;
    if (typeof settings.rememberPos !== "boolean") settings.rememberPos = true;
    if (typeof settings.unlimitedIndexing !== "boolean") settings.unlimitedIndexing = false;
  } catch {
    settings = {
      roots: getDefaultRoots(),
      paused: false,
      hotkey: "Control+1",
      theme: "dark",
      rememberQuery: true,
      rememberPos: false,
      windowPos: null,
      opacity: 0.92,
      indexIntervalSec: 60,
      maxFileSizeMb: 20,
      unlimitedIndexing: false
    };
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  } catch {
    // ignore
  }
}

function migrateLegacyUserData() {
  try {
    const currentDir = app.getPath("userData");
    const appData = app.getPath("appData");

    const legacyNames = [
      "ai-desktop-assistant",
      "AIAssistant",
      "AI Assistant"
    ];

    const targets = [
      { name: "index.json", overrideIfMissingOnly: true },
      { name: "index-report.json", overrideIfMissingOnly: true },
      { name: "ai-state.json", overrideIfMissingOnly: false },
      { name: "ai-installed.json", overrideIfMissingOnly: false },
      { name: "settings.json", overrideIfMissingOnly: true }
    ];

    for (const legacyName of legacyNames) {
      const legacyDir = path.join(appData, legacyName);
      if (legacyDir === currentDir) continue;
      if (!fs.existsSync(legacyDir)) continue;

      for (const target of targets) {
        const src = path.join(legacyDir, target.name);
        const dst = path.join(currentDir, target.name);
        if (!fs.existsSync(src)) continue;

        if (target.overrideIfMissingOnly && fs.existsSync(dst)) continue;

        try {
          if (fs.existsSync(dst)) {
            const backup = dst + ".bak";
            if (!fs.existsSync(backup)) fs.copyFileSync(dst, backup);
          }
          fs.copyFileSync(src, dst);
          console.log("Migrated", target.name, "from", legacyDir);
        } catch (error) {
          console.error("Migration failed for", target.name, error?.message || error);
        }
      }
    }
  } catch (error) {
    console.error("Legacy migration error", error?.message || error);
  }
}




function getSystemProfile() {
  const totalMemGb = Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10;
  const cpuCount = os.cpus()?.length || 1;
  const arch = os.arch();
  const platform = os.platform();
  return { totalMemGb, cpuCount, arch, platform };
}

function getRecommendedModel(profile = getSystemProfile()) {
  const weak = profile.totalMemGb < 8 || profile.cpuCount <= 4;
  return weak ? "qwen2.5:1.5b" : "qwen2.5:3b";
}

function getSelectedModel() {
  return settings.aiModel || getRecommendedModel();
}

function syncAiModelFromSettings() {
  const selectedModel = getSelectedModel();
  if (aiStatus.model !== selectedModel) {
    aiStatus = { ...aiStatus, model: selectedModel, progress: "", error: "" };
    saveAiStatus();
  }
}

function saveAiStatus() {
  if (!aiStatePath) return;
  try {
    fs.writeFileSync(aiStatePath, JSON.stringify(aiStatus, null, 2), "utf8");
  } catch {
    // ignore
  }
}

function loadAiStatus() {
  if (!aiStatePath || !fs.existsSync(aiStatePath)) return;
  try {
    const raw = fs.readFileSync(aiStatePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      aiStatus = { ...aiStatus, ...parsed, model: getSelectedModel(), installing: false, error: "" };
    }
  } catch {
    // ignore
  }
}

function emitAiStatus() {
  mainWindow?.webContents.send("ai-status", aiStatus);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({ code: null, stdout, stderr, error });
    });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function hasOllama() {
  const out = await runCommand("ollama", ["--version"]);
  return out.code === 0;
}

async function ensureOllama() {
  if (await hasOllama()) return;

  if (process.platform === "win32") {
    const installed = await runCommand(
      "winget",
      [
        "install",
        "-e",
        "--id",
        "Ollama.Ollama",
        "--accept-package-agreements",
        "--accept-source-agreements"
      ],
      { windowsHide: true }
    );

    if (installed.code === 0 && await hasOllama()) return;

    const reason = installed.stderr || installed.stdout || "winget install failed";
    throw new Error("Не удалось установить Ollama автоматически: " + reason.trim());
  }

  throw new Error("Ollama не найдена. Установи Ollama и повтори установку ИИ.");
}

async function isModelAvailable(model) {
  if (!model) return false;
  const out = await runCommand("ollama", ["show", model]);
  return out.code === 0;
}

async function resolveModelForQuery() {
  const preferred = getSelectedModel();
  if (await isModelAvailable(preferred)) return preferred;
  if (aiStatus.installed && aiStatus.model && await isModelAvailable(aiStatus.model)) return aiStatus.model;
  return null;
}

function cleanProgressLine(text) {
  const raw = String(text || "");
  const noAnsi = raw.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
  return noAnsi.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, " ").replace(/\s+/g, " ").trim();
}

function formatPullProgress(line) {
  const clean = cleanProgressLine(line);
  if (!clean) return "";

  const match = clean.match(/pulling\s+[^:]+:\s*(\d+)%\s+.*?\s+(\d+(?:\.\d+)?\s*[GMK]B)\/(\d+(?:\.\d+)?\s*[GMK]B)\s+(\d+(?:\.\d+)?\s*[GMK]B\/s)\s+([0-9a-zA-Z]+)/i);
  if (match) {
    return "Загрузка модели: " + match[1] + "% (" + match[2] + "/" + match[3] + ", " + match[4] + ", " + match[5] + ")";
  }

  if (/success|downloaded|verifying|writing manifest/i.test(clean)) {
    return "ИИ: " + clean;
  }

  return clean;
}

async function pullAiModel() {
  await ensureOllama();

  await new Promise((resolve, reject) => {
    const child = spawn("ollama", ["pull", getSelectedModel()]);
    let lastMessage = "";

    const onLine = (raw) => {
      const clean = cleanProgressLine(raw);
      if (!clean) return;
      const pretty = formatPullProgress(clean);
      if (!pretty) return;
      lastMessage = pretty;
      aiStatus = { ...aiStatus, progress: pretty, error: "" };
      mainWindow?.webContents.send("ai-progress", { message: pretty });
      emitAiStatus();
    };

    child.stdout.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) onLine(line);
    });

    child.stderr.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) onLine(line);
    });

    child.on("error", (error) => reject(error));

    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(lastMessage || "ollama pull exit code " + code));
    });
  });
}

const RU_STOPWORDS = new Set([
  "и", "или", "в", "во", "на", "по", "из", "за", "для", "к", "ко", "о", "об", "от", "до", "у", "а", "но", "не", "да", "же", "ли",
  "это", "этот", "эта", "эти", "тот", "та", "те", "так", "также", "вот", "тут", "там", "где", "когда", "как", "какой", "какая", "есть",
  "найди", "найти", "поищи", "поиск", "информация", "инфо", "данные", "покажи", "скажи", "расскажи", "собери", "сделай", "дай", "мне", "нужно", "пожалуйста", "про", "что", "где", "кто", "какой",
  "about", "the", "a", "an", "to", "for", "in", "on", "of", "with", "find", "search", "info", "information", "please"
]);

function normalizeToken(token) {
  let t = String(token || "").toLowerCase();
  if (t.length < 4) return t;
  const suffixes = ["иями", "ями", "ами", "иях", "ях", "иях", "ов", "ев", "ей", "ом", "ем", "ам", "ям", "ах", "ях", "ия", "ья", "ый", "ий", "ая", "ое", "ые", "ой", "ую", "а", "я", "ы", "и", "е", "у", "ю"];
  for (const s of suffixes) {
    if (t.length > s.length + 2 && t.endsWith(s)) {
      t = t.slice(0, -s.length);
      break;
    }
  }
  return t;
}

function tokenVariants(token) {
  const base = String(token || "").toLowerCase();
  const variants = new Set([base, normalizeToken(base)]);
  if (base.length >= 5) variants.add(base.slice(0, -1));
  if (base.length >= 6) variants.add(base.slice(0, -2));
  return Array.from(variants).filter(Boolean);
}

function expandDomainTokens(tokens) {
  const out = new Set(tokens || []);
  const joined = Array.from(out).join(" ");

  const hasSchool = /(школь|учен|класс|учеб|урок|аттестац|предмет)/i.test(joined);
  if (hasSchool) {
    ["школ", "учен", "класс", "учеб", "урок", "аттестац", "предмет"].forEach((t) => out.add(t));
  }

  const hasPerson = /(человек|фио|ученик|персона|сотрудник|фамил|имя|отчеств)/i.test(joined);
  if (hasPerson) {
    ["фио", "фамил", "им", "отчеств", "ученик", "сотрудник"].forEach((t) => out.add(t));
  }

  return Array.from(out);
}

function quickCategoryMatches(query, maxItems = 3) {
  const q = String(query || "").toLowerCase();
  const rawTokens = tokenizeQuery(q);
  const tokens = expandDomainTokens(rawTokens).filter((t) => t.length >= 3);
  if (!tokens.length) return [];

  const hits = [];
  for (const item of Object.values(indexData.files || {})) {
    const name = String(item.name || "").toLowerCase();
    const pathText = String(item.path || "").toLowerCase();
    const text = String(item.text || "").toLowerCase();
    const ok = tokens.some((token) => name.includes(token) || pathText.includes(token) || text.includes(token));
    if (!ok) continue;
    hits.push(item.path || item.name || "");
    if (hits.length >= maxItems) break;
  }
  return hits.filter(Boolean);
}

function tokenizeQuery(raw) {
  const words = String(raw || "").toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || [];
  const uniq = Array.from(new Set(words));
  const important = uniq.filter((w) => !RU_STOPWORDS.has(w));
  return expandDomainTokens((important.length ? important : uniq).slice(0, 8));
}

function isFileTaskQuery(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return false;
  return /(найд|поиск|собер|собери|сумм|вытащ|подготов|создай|сделай|сформируй|покажи|доклад|отчет|отч[eё]т|резюме|информац|данн|из файлов|по файлам|в файлах|из документа|по документам|сохран|экспорт|файл|документ|фио|ученик|человек)/i.test(q);
}

function collectContextFromIndex(query, maxItems = 10) {
  const raw = String(query || "").trim().toLowerCase();
  if (!raw) return [];

  const tokens = tokenizeQuery(raw).filter((token) => token.length >= 2);
  if (!tokens.length) return [];

  const tokenVarMap = new Map(tokens.map((tok) => [tok, tokenVariants(tok)]));
  const scored = [];

  for (const item of Object.values(indexData.files || {})) {
    const name = String(item.name || "").toLowerCase();
    const pathText = String(item.path || "").toLowerCase();
    const text = String(item.text || "");
    const textLower = text.toLowerCase();

    let score = 0;
    let hitCount = 0;

    if (raw.length >= 3 && (name.includes(raw) || pathText.includes(raw) || textLower.includes(raw))) {
      score += 24;
      hitCount += 1;
    }

    for (const token of tokens) {
      const variants = tokenVarMap.get(token) || [token];
      let inName = false;
      let inPath = false;
      let inText = false;

      for (const v of variants) {
        if (!inName && name.includes(v)) inName = true;
        if (!inPath && pathText.includes(v)) inPath = true;
        if (!inText && textLower.includes(v)) inText = true;
      }

      if (inName || inPath || inText) hitCount += 1;
      if (inName) score += 14;
      if (inPath) score += 8;
      if (inText) score += 5;
    }

    if (score < 6 || hitCount === 0) continue;

    // snippet around the first matched token variant
    let snippet = text.slice(0, 760);
    let bestPos = -1;
    let bestToken = "";
    for (const token of tokens) {
      const variants = tokenVarMap.get(token) || [token];
      for (const v of variants) {
        const idx = textLower.indexOf(v);
        if (idx !== -1 && (bestPos === -1 || idx < bestPos)) {
          bestPos = idx;
          bestToken = v;
        }
      }
    }

    if (bestPos !== -1) {
      const start = Math.max(0, bestPos - 280);
      const end = Math.min(text.length, bestPos + bestToken.length + 520);
      snippet = text.slice(start, end);
    }

    scored.push({
      score,
      path: item.path || "",
      name: item.name || "",
      snippet: snippet.replace(/\s+/g, " ").trim()
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxItems);
}

function readUserFileContext(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const fromIndex = Object.values(indexData.files || {}).find((item) => item.path === filePath);
    if (fromIndex?.text) {
      return { path: filePath, content: String(fromIndex.text).slice(0, 1200) };
    }

    if (ext === ".txt" || ext === ".md") {
      const content = fs.readFileSync(filePath, "utf8");
      return { path: filePath, content: content.slice(0, 1200) };
    }

    return { path: filePath, content: "[Контент не извлечен для этого типа файла, доступен путь файла]" };
  } catch {
    return { path: filePath, content: "[Ошибка чтения файла]" };
  }
}

async function generateWithOllamaApi(model, prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok) throw new Error(text || "Ollama API error");
    const data = JSON.parse(text);
    return String(data.response || "").trim();
  } finally {
    clearTimeout(timeout);
  }
}

function isSmallTalkQuery(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return false;

  const shortSmallTalk = [
    "привет",
    "здравствуй",
    "как дела",
    "что умеешь",
    "кто ты",
    "спасибо",
    "hello",
    "hi",
    "how are you"
  ];
  if (shortSmallTalk.some((sample) => q === sample || q.startsWith(sample + " "))) return true;

  const fileAction = /(найд|поиск|собер|собери|сумм|вытащ|подготов|создай|сделай|сформируй|покажи|доклад|отчет|отч[eё]т|резюме|информац|данн)/i;
  const fileHint = /(файл|документ|word|docx|pdf|xlsx|excel|таблиц|из локальных|из файлов|в файлах|на компьютере|по документам)/i;

  if (fileHint.test(q)) return false;
  if (fileAction.test(q)) return false;

  return q.length <= 80;
}

function buildFileTaskPrompt(query, contextBlock, attachedBlock) {
  return [
    "Ты дружелюбный локальный AI-помощник.",
    "Работай ТОЛЬКО на основе локального контекста ниже и вложенных файлов.",
    "Интернет не используй и не упоминай его.",
    "Отвечай естественно и по-человечески: без формата 'Найдено/Кратко/Источники'.",
    "Если контекст неполный, сначала дай то, что нашел, и задай 1 короткий уточняющий вопрос.",
    "Если пользователь просит про человека (например ФИО), собери все найденные факты в один понятный ответ.",
    "",
    "Запрос пользователя:",
    query,
    "",
    "Локальный контекст:",
    contextBlock || "[пусто]",
    "",
    "Вложенные файлы от пользователя:",
    attachedBlock || "[нет]"
  ].join("\n");
}

function buildGeneralLocalPrompt(query) {
  return [
    "Ты локальный AI-ассистент (без интернета).",
    "Отвечай естественно, как обычный помощник, но не утверждай факты из интернета.",
    "Если вопрос требует данных из файлов, предложи уточнить запрос или поискать по локальным файлам.",
    "Запрос пользователя:",
    query
  ].join("\n");
}

async function askLocalAi(query, filePaths = []) {
  const model = await resolveModelForQuery();
  if (!model) {
    throw new Error("Модель ИИ не найдена. Установи ИИ или выбери установленную модель в настройках.");
  }

  const q = String(query || "").trim();
  const contextItems = collectContextFromIndex(q, 8);
  const attached = Array.isArray(filePaths) ? filePaths.slice(0, 8).map(readUserFileContext) : [];
  const hasAttachedText = attached.some((item) => {
    const content = String(item?.content || "");
    return content && !content.startsWith("[");
  });

  const contextBlock = contextItems.map((item, idx) => "[#" + (idx + 1) + "] " + item.path + "\n" + item.snippet).join("\n\n");
  const attachedBlock = attached.map((item, idx) => "[Файл " + (idx + 1) + "] " + item.path + "\n" + item.content).join("\n\n");

  const smallTalk = isSmallTalkQuery(q);
  const hasLocalContext = contextItems.length > 0 || hasAttachedText;
  const explicitFileTask = isFileTaskQuery(q);
  const useFileMode = !smallTalk && (explicitFileTask || hasAttachedText || hasLocalContext);

  if (useFileMode && !hasLocalContext && !hasAttachedText) {
    return "По этому запросу не нашел данных в локальных файлах. Уточни ФИО/ключевые слова или перетащи нужный файл в окно ИИ.";
  }

  const prompt = useFileMode
    ? buildFileTaskPrompt(q, contextBlock, attachedBlock)
    : buildGeneralLocalPrompt(smallTalk ? q : q + " (без интернета)");

  try {
    const answerApi = await generateWithOllamaApi(model, prompt);
    if (answerApi) return answerApi;
  } catch {}

  const out = await runCommand("ollama", ["run", model, prompt]);
  if (out.code !== 0) {
    throw new Error((out.stderr || out.stdout || "Ошибка вызова ИИ").trim());
  }

  const answer = String(out.stdout || "").trim();
  if (!answer) return "Пустой ответ от модели. Повтори запрос.";
  return answer;
}


function isMoveIntentQuery(query) {
  const q = String(query || "").toLowerCase();
  return /(перемест|перенес|перенеси|перемести|move|mv|перекинь)/i.test(q);
}

function collectKnownDirectories() {
  const dirs = new Set();
  for (const item of Object.values(indexData.files || {})) {
    if (item?.path) dirs.add(path.dirname(item.path));
  }

  for (const root of normalizeRoots(mergeRoots(settings.roots || [], getCoreRoots()))) {
    dirs.add(root);
  }

  try {
    dirs.add(app.getPath("desktop"));
    dirs.add(app.getPath("downloads"));
    dirs.add(app.getPath("documents"));
  } catch {
    // ignore
  }

  return Array.from(dirs).filter((d) => typeof d === "string" && d);
}

function resolveDestinationFromQuery(query) {
  const q = String(query || "").trim();
  const qLower = q.toLowerCase();

  const specials = [
    { re: /(рабоч(ий|его)\s*стол|desktop)/i, get: () => app.getPath("desktop") },
    { re: /(загрузк|downloads?)/i, get: () => app.getPath("downloads") },
    { re: /(документ|documents?)/i, get: () => app.getPath("documents") }
  ];

  for (const s of specials) {
    if (s.re.test(qLower)) {
      try {
        const pth = s.get();
        if (pth && fs.existsSync(pth) && fs.lstatSync(pth).isDirectory()) {
          return { ok: true, dir: pth };
        }
      } catch {
        // ignore
      }
    }
  }

  const absoluteMatch = q.match(/([A-Za-z]:\\[^\n\r"']+|\/[^\n\r"']+)/);
  if (absoluteMatch) {
    const rawPath = absoluteMatch[1].trim();
    if (fs.existsSync(rawPath) && fs.lstatSync(rawPath).isDirectory()) {
      return { ok: true, dir: rawPath };
    }
  }

  const folderMatch = q.match(/(?:в|во|to)\s+папк[ауеы]?\s+["“]?([^"”\n\r,.]+)["”]?/i)
    || q.match(/(?:в|во|to)\s+["“]([^"”\n\r]+)["”]/i);

  if (!folderMatch) {
    return { ok: false, error: "Не понял, в какую папку перемещать. Укажи: например 'в папку Отчеты' или 'на рабочий стол'." };
  }

  const folderName = String(folderMatch[1] || "").trim().toLowerCase();
  if (!folderName) {
    return { ok: false, error: "Укажи название папки назначения." };
  }

  const dirs = collectKnownDirectories();
  const ranked = dirs
    .map((dir) => {
      const base = path.basename(dir).toLowerCase();
      let score = 0;
      if (base === folderName) score += 100;
      if (base.includes(folderName)) score += 40;
      if (dir.toLowerCase().includes(folderName)) score += 20;
      return { dir, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    return { ok: false, error: "Папка '" + folderMatch[1] + "' не найдена среди доступных путей." };
  }

  if (ranked.length > 1 && ranked[0].score === ranked[1].score) {
    return { ok: false, error: "Есть несколько папок '" + folderMatch[1] + "'. Укажи путь точнее." };
  }

  return { ok: true, dir: ranked[0].dir };
}

function resolveSourceFilesForMove(query, attachedPaths = []) {
  const uniq = new Set();

  for (const pth of Array.isArray(attachedPaths) ? attachedPaths : []) {
    if (typeof pth !== "string") continue;
    try {
      if (fs.existsSync(pth) && fs.lstatSync(pth).isFile()) uniq.add(pth);
    } catch {
      // ignore
    }
  }

  const quotedNames = Array.from(String(query || "").matchAll(/["“]([^"”]{2,})["”]/g)).map((m) => String(m[1] || "").trim().toLowerCase());
  if (quotedNames.length) {
    for (const item of Object.values(indexData.files || {})) {
      const pth = item?.path;
      const nm = String(item?.name || "").toLowerCase();
      if (!pth || !fs.existsSync(pth)) continue;
      try {
        if (!fs.lstatSync(pth).isFile()) continue;
      } catch {
        continue;
      }
      if (quotedNames.some((qname) => nm.includes(qname))) uniq.add(pth);
    }
  }

  const byContext = collectContextFromIndex(query, 24)
    .map((x) => x.path)
    .filter((pth) => typeof pth === "string" && fs.existsSync(pth));
  for (const pth of byContext) {
    try {
      if (fs.lstatSync(pth).isFile()) uniq.add(pth);
    } catch {
      // ignore
    }
  }

  return Array.from(uniq).slice(0, 24);
}

function uniqueTargetPath(destDir, originalName) {
  const parsed = path.parse(originalName);
  let candidate = path.join(destDir, originalName);
  if (!fs.existsSync(candidate)) return candidate;
  let i = 1;
  while (i < 1000) {
    const next = path.join(destDir, parsed.name + " (" + i + ")" + parsed.ext);
    if (!fs.existsSync(next)) return next;
    i += 1;
  }
  return path.join(destDir, parsed.name + "_" + Date.now() + parsed.ext);
}

function moveFileAtomic(sourcePath, destDir) {
  const targetPath = uniqueTargetPath(destDir, path.basename(sourcePath));
  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (error) {
    if (error && error.code === "EXDEV") {
      fs.copyFileSync(sourcePath, targetPath);
      fs.unlinkSync(sourcePath);
    } else {
      throw error;
    }
  }
  return targetPath;
}

function updateIndexAfterMove(movedPairs) {
  if (!Array.isArray(movedPairs) || !movedPairs.length) return;
  const movedMap = new Map(movedPairs.map((x) => [x.from, x.to]));

  for (const key of Object.keys(indexData.files || {})) {
    const item = indexData.files[key];
    if (!item?.path) continue;
    const nextPath = movedMap.get(item.path);
    if (!nextPath) continue;
    item.path = nextPath;
    item.name = path.basename(nextPath);
  }

  try {
    fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), "utf8");
    indexStatus = { ...indexStatus, fileCount: Object.keys(indexData.files || {}).length };
    mainWindow?.webContents.send("index-status", indexStatus);
  } catch {
    // ignore
  }
}

async function tryHandleMoveRequest(query, attachedPaths = []) {
  if (!isMoveIntentQuery(query)) return { handled: false };

  const dest = resolveDestinationFromQuery(query);
  if (!dest.ok) return { handled: true, ok: false, message: dest.error };

  const sources = resolveSourceFilesForMove(query, attachedPaths)
    .filter((src) => path.dirname(src) !== dest.dir);

  if (!sources.length) {
    return {
      handled: true,
      ok: false,
      message: "Не нашел файлы для перемещения. Укажи имя файла в кавычках или перетащи файлы в окно ИИ."
    };
  }

  if (sources.length > 20) {
    return {
      handled: true,
      ok: false,
      message: "Найдено слишком много файлов (" + sources.length + "). Уточни запрос, чтобы переместить не больше 20 файлов за раз."
    };
  }

  const moved = [];
  const failed = [];

  for (const src of sources) {
    try {
      const to = moveFileAtomic(src, dest.dir);
      moved.push({ from: src, to });
    } catch (error) {
      failed.push({ path: src, error: error?.message || String(error) });
    }
  }

  if (moved.length) {
    updateIndexAfterMove(moved);
  }

  const preview = moved.slice(0, 5).map((x) => "- " + x.to).join("\n");
  let message = moved.length
    ? "Готово. Переместил " + moved.length + " файл(ов) в: " + dest.dir
    : "Не удалось переместить файлы в: " + dest.dir;

  if (preview) message += "\n\nПримеры:\n" + preview;
  if (failed.length) message += "\n\nОшибок: " + failed.length + ".";

  return { handled: true, ok: moved.length > 0, message, moved, failed, destination: dest.dir };
}

function detectCreateFileIntent(query) {
  const q = String(query || "").toLowerCase();
  const wantsCreate = /(создай|создать|сформируй|подготовь|make|create|generate).*(файл|документ|file|document)|\bсохрани\b/.test(q);
  if (!wantsCreate) return null;

  if (/xlsx|excel|таблиц/.test(q)) return "xlsx";
  if (/md|markdown/.test(q)) return "md";
  if (/txt|текст/.test(q)) return "txt";
  if (/doc|word|docx|pdf/.test(q)) return "txt";
  return "txt";
}

function buildFileName(ext) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "_" + pad(d.getHours()) + "-" + pad(d.getMinutes());
  return "AI_Result_" + stamp + "." + ext;
}

function createFileOnDesktop(ext, content) {
  const desktop = app.getPath("desktop");
  const name = buildFileName(ext);
  const outPath = path.join(desktop, name);

  if (ext === "xlsx") {
    const rows = String(content || "").split(/\r?\n/).map((line) => [line]);
    const ws = XLSX.utils.aoa_to_sheet(rows.length ? rows : [["AI result"]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Result");
    XLSX.writeFile(wb, outPath);
    return outPath;
  }

  fs.writeFileSync(outPath, String(content || ""), "utf8");
  return outPath;
}

function loadReport() {
  try {
    const reportPath = indexPath.replace(/\.json$/i, "") + "-report.json";
    if (!fs.existsSync(reportPath)) return;
    const raw = fs.readFileSync(reportPath, "utf8");
    const report = JSON.parse(raw);
    indexStatus = {
      ...indexStatus,
      state: "ready",
      scanned: report.scanned || 0,
      total: report.total || 0,
      byExt: report.byExt || {},
      scannedByExt: report.scannedByExt || {},
      fileCount: report.scanned || indexStatus.fileCount
    };
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

function hasSavedIndexSnapshot() {
  try {
    if (!indexPath || !fs.existsSync(indexPath)) return false;
    const raw = fs.readFileSync(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    const count = Object.keys(parsed?.files || {}).length;
    if (count > 0) {
      indexData = parsed;
      indexStatus = { ...indexStatus, state: "ready", fileCount: count };
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function hasIndexFileOnDisk() {
  try {
    if (!indexPath || !fs.existsSync(indexPath)) return false;
    const stat = fs.statSync(indexPath);
    return stat.isFile() && stat.size > 16;
  } catch {
    return false;
  }
}

function startIndexing() {
  indexRunId += 1;
  let roots = settings.roots?.length ? settings.roots : getDefaultRoots();
  roots = normalizeRoots(roots);
  roots = mergeRoots(roots, getCoreRoots());
  if (!roots.length) roots = getDefaultRoots();
  if (!roots.length) return;

  if (indexWorker) {
    indexWorker.kill();
    indexWorker = null;
  }

  const rustPath = getRustIndexerPath();
  if (rustPath) {
    startRustIndexer(rustPath, roots);
    return;
  }

  startJsIndexer(roots);
}

function startRustIndexer(rustPath, roots) {
  const runId = indexRunId;
  indexStatus = { state: "indexing", scanned: 0, total: 0, fileCount: 0, roots , byExt: {}, scannedByExt: {}, lastError: null };
  mainWindow?.webContents.send("index-status", indexStatus);
  mainWindow?.webContents.send("index-status", indexStatus);

  const args = ["index", "--index", indexPath, ...roots.flatMap(r => ["--root", r])];
  const env = {
    ...process.env,
    INDEXER_MAX_FILE_SIZE_MB: String(settings.maxFileSizeMb || 20),
    INDEXER_UNLIMITED: settings.unlimitedIndexing ? "1" : "0"
  };
  const child = spawn(rustPath, args, { stdio: ["ignore", "pipe", "pipe"], env });
  indexWorker = child;

  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === "progress") {
          indexStatus = { ...indexStatus, scanned: msg.scanned, total: msg.total ?? indexStatus.total, byExt: msg.byExt || indexStatus.byExt, scannedByExt: msg.scannedByExt || indexStatus.scannedByExt, lastError: null };
          mainWindow?.webContents.send("index-status", indexStatus);
        }
        if (msg.type === "throttle") {
          mainWindow?.webContents.send("index-throttle", { waitMs: msg.waitMs || 0 });
        }
        if (msg.type === "status") {
          indexStatus = { ...indexStatus, state: msg.state };
          mainWindow?.webContents.send("index-status", indexStatus);
        }
      } catch {
        // ignore
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    indexStatus = { ...indexStatus, state: "error", lastError: chunk.toString() };
    console.error("Rust indexer stderr", chunk.toString());
    mainWindow?.webContents.send("index-status", indexStatus);
  });

  child.on("close", (code, signal) => {
    if (child !== indexWorker || runId !== indexRunId) return;
    if (code === 0) {
      loadIndex();
      indexStatus = { ...indexStatus, state: "ready", fileCount: Object.keys(indexData.files || {}).length };
      mainWindow?.webContents.send("index-status", indexStatus);
      return;
    }

    if (code === null && signal) {
      // killed or stopped intentionally
      indexStatus = { ...indexStatus, state: "idle" };
      mainWindow?.webContents.send("index-status", indexStatus);
      return;
    }

    indexStatus = { ...indexStatus, state: "error", lastError: indexStatus.lastError || ('Rust indexer exit code ' + code) };
    console.error("Rust indexer exit", code, signal);
    mainWindow?.webContents.send("index-status", indexStatus);
  });
}

function startJsIndexer(roots) {
  const runId = indexRunId;
  const indexerPath = path.join(__dirname, "indexer", "indexer.js");
  const worker = fork(indexerPath, { stdio: ["inherit", "inherit", "inherit", "ipc"] });
  indexWorker = worker;

  indexStatus = { state: "indexing", scanned: 0, total: 0, fileCount: 0, roots , byExt: {}, scannedByExt: {}, lastError: null };

  worker.on("message", (message) => {
    if (worker !== indexWorker || runId !== indexRunId) return;
    if (!message) return;
    if (message.type === "progress") {
      indexStatus = { ...indexStatus, scanned: message.scanned, total: message.total ?? indexStatus.total, byExt: message.byExt || indexStatus.byExt, scannedByExt: message.scannedByExt || indexStatus.scannedByExt, lastError: null };
      mainWindow?.webContents.send("index-status", indexStatus);
    }
    if (message.type === "throttle") {
      mainWindow?.webContents.send("index-throttle", { waitMs: message.waitMs || 0 });
    }
    if (message.type === "status") {
      indexStatus = { ...indexStatus, state: message.state, lastError: message.error || indexStatus.lastError };
    if (message.error) console.error("Indexer error", message.error);
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

  worker.on("exit", (code, signal) => {
    if (worker !== indexWorker || runId !== indexRunId) return;
    if (code && code !== 0) {
      indexStatus = { ...indexStatus, state: "error", lastError: indexStatus.lastError || `JS indexer exit code ${code}` };
      mainWindow?.webContents.send("index-status", indexStatus);
    }
  });

  worker.send({ type: "start", roots, indexPath, maxFileSizeMb: settings.maxFileSizeMb || 20, unlimitedIndexing: !!settings.unlimitedIndexing });
}

function stopIndexing() {
  if (indexWorker) {
    indexWorker.kill();
    indexWorker = null;
  }
  indexStatus = { ...indexStatus, state: "paused" };
  mainWindow?.webContents.send("index-status", indexStatus);
}

function centerWithSettings() {
  if (!mainWindow || !settingsWindow) return;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const mainBounds = mainWindow.getBounds();
  const settingsBounds = settingsWindow.getBounds();
  const gap = 12;
  const totalWidth = mainBounds.width + gap + settingsBounds.width;
  const x = Math.max(0, Math.floor((width - totalWidth) / 2));
  const y = Math.max(0, Math.floor(height * 0.15));
  mainWindow.setPosition(x, y, false);
  settingsWindow.setPosition(x + mainBounds.width + gap, y, false);
}

function createSortWindow() {
  if (sortWindow) {
    sortWindow.show();
    sortWindow.focus();
    return;
  }

  sortWindow = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 860,
    minHeight: 500,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    titleBarStyle: "hidden",
    resizable: true,
    movable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    hasShadow: true,
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  sortWindow.loadFile(path.join(__dirname, "renderer", "sort.html"));
  sortWindow.once("ready-to-show", () => sortWindow?.show());
  sortWindow.on("closed", () => {
    sortWindow = null;
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 420,
    height: 310,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, "renderer", "settings.html"));


  settingsWindow.on("closed", () => {
    settingsWindow = null;
    if (mainWindowPrevBounds && mainWindow) {
      mainWindow.setBounds(mainWindowPrevBounds, false);
      mainWindowPrevBounds = null;
    }
  });
}

function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(900, Math.floor(width * 0.8)),
    height: 200,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 720,
    minHeight: 200,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("settings-updated", settings);
    emitAiStatus();
  });

  mainWindow.on("move", () => {
    if (!settings.rememberPos) return;
    const [x, y] = mainWindow.getPosition();
    settings.windowPos = { x, y };
    saveSettings();
  });

  }

function initAutoUpdater() {
  if (!autoUpdater) return;
  if (!app.isPackaged) return;

  const feedUrl = process.env.OFFICEGHOST_UPDATE_URL || process.env.UPDATE_URL || "";
  if (feedUrl) {
    autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (error) => {
    console.error("AutoUpdater error:", error?.message || error);
    if (manualUpdateCheck) {
      manualUpdateCheck = false;
      dialog.showMessageBox({
        type: "error",
        title: "Обновление",
        message: "Не удалось проверить обновления",
        detail: String(error?.message || error || "Неизвестная ошибка")
      }).catch(() => {});
    }
  });

  autoUpdater.on("update-not-available", () => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    dialog.showMessageBox({
      type: "info",
      title: "Обновление",
      message: "У вас уже установлена последняя версия."
    }).catch(() => {});
  });

  autoUpdater.on("update-available", (info) => {
    const ver = info?.version ? ` ${info.version}` : "";
    if (manualUpdateCheck) {
      manualUpdateCheck = false;
      dialog.showMessageBox({
        type: "info",
        title: "Обновление",
        message: `Найдена новая версия${ver}. Скачивание началось автоматически.`
      }).catch(() => {});
    }
  });

  autoUpdater.on("update-downloaded", async (info) => {
    updateDownloadedInfo = info || null;
    const ver = info?.version ? ` ${info.version}` : "";
    const result = await dialog.showMessageBox({
      type: "question",
      buttons: ["Обновить сейчас", "Позже"],
      defaultId: 0,
      cancelId: 1,
      title: "Обновление готово",
      message: `Версия${ver} скачана. Установить сейчас?`,
      detail: "Приложение будет перезапущено автоматически."
    }).catch(() => ({ response: 1 }));

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  checkForAppUpdates(false);

  if (updateCheckTimer) clearInterval(updateCheckTimer);
  updateCheckTimer = setInterval(() => {
    checkForAppUpdates(false);
  }, UPDATE_CHECK_INTERVAL_MS);
}

async function checkForAppUpdates(manual = false) {
  if (!autoUpdater) {
    if (manual) {
      await dialog.showMessageBox({
        type: "warning",
        title: "Обновление",
        message: "Модуль обновлений не подключен. Установите зависимость electron-updater."
      }).catch(() => {});
    }
    return false;
  }

  if (!app.isPackaged) {
    if (manual) {
      await dialog.showMessageBox({
        type: "info",
        title: "Обновление",
        message: "Проверка обновлений работает только в установленной (упакованной) версии приложения."
      }).catch(() => {});
    }
    return false;
  }

  manualUpdateCheck = !!manual;
  try {
    await autoUpdater.checkForUpdates();
    return true;
  } catch (error) {
    if (manual) {
      manualUpdateCheck = false;
      await dialog.showMessageBox({
        type: "error",
        title: "Обновление",
        message: "Не удалось проверить обновления",
        detail: String(error?.message || error || "Неизвестная ошибка")
      }).catch(() => {});
    }
    return false;
  }
}

function getAppIconPath() {
  const rootIconPng = path.join(__dirname, "..", "icon.png");
  const buildIco = path.join(__dirname, "..", "build", "icon.ico");
  // For runtime (especially mac dock/tray), PNG is the safest format.
  if (fs.existsSync(rootIconPng)) return rootIconPng;
  if (process.platform === "win32" && fs.existsSync(buildIco)) return buildIco;
  return "";
}

function getTrayIcon() {
  const iconPath = getAppIconPath();
  if (!iconPath) return nativeImage.createEmpty();
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 18, height: 18 });
}

function createTray() {
  if (tray) return;
  tray = new Tray(getTrayIcon());
  const menu = Menu.buildFromTemplate([
    { label: "Показать", click: () => toggleWindow() },
    { label: "Проверить обновления", click: () => { checkForAppUpdates(true); } },
    { type: "separator" },
    { label: "Выход", click: () => app.quit() }
  ]);
  tray.setToolTip("OfficeGhost");
  tray.setContextMenu(menu);
  tray.on("click", () => toggleWindow());
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  const hotkey = settings.hotkey || "Control+1";
  globalShortcut.register(hotkey, () => {
    toggleWindow();
  });
}

function applyWindowPosition() {
  if (!mainWindow) return;
  const pos = settings.windowPos;
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    mainWindow.setPosition(Math.floor(pos.x), Math.floor(pos.y), false);
  }
}

function hideSettingsWindow() {
  if (settingsWindow) settingsWindow.hide();
  if (mainWindowPrevBounds && mainWindow) {
    mainWindow.setBounds(mainWindowPrevBounds, false);
    mainWindowPrevBounds = null;
  }
}

function toggleWindow() {
  if (!mainWindow) return;

  if (mainWindow.isVisible()) {
    hideSettingsWindow();
    mainWindow.hide();
    return;
  }

  const pos = settings.windowPos;
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    mainWindow.setPosition(Math.floor(pos.x), Math.floor(pos.y), false);
  } else {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const winBounds = mainWindow.getBounds();
    const x = Math.floor((width - winBounds.width) / 2);
    const y = Math.floor(height * 0.15);
    mainWindow.setPosition(x, y, false);
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("focus-input");
}


function emitSortProgress(payload) {
  mainWindow?.webContents.send("sort-progress", payload);
  sortWindow?.webContents.send("sort-progress", payload);
}

function hashText(text) {
  return crypto.createHash("sha1").update(String(text || "")).digest("hex");
}

function ensureIndexLoaded() {
  if (!indexData?.files || !Object.keys(indexData.files).length) {
    loadIndex();
  }
}

function createUnionFind(size) {
  const parent = Array.from({ length: size }, (_, i) => i);
  const rank = Array(size).fill(0);

  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };

  const union = (a, b) => {
    let ra = find(a);
    let rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) [ra, rb] = [rb, ra];
    parent[rb] = ra;
    if (rank[ra] === rank[rb]) rank[ra] += 1;
  };

  return { find, union };
}

async function runDuplicateSort() {
  ensureIndexLoaded();
  const allowedExt = new Set([".doc", ".docx", ".xls", ".xlsx", ".pdf"]);
  const items = Object.values(indexData.files || {}).filter((item) => {
    if (!item || typeof item.path !== "string" || !item.path) return false;
    const ext = String(item.ext || path.extname(item.path) || "").toLowerCase();
    return allowedExt.has(ext);
  });
  const total = items.length;

  sortSessionId += 1;
  const runId = sortSessionId;
  sortStatus = { running: true, phase: "scan", processed: 0, total, groups: 0, copies: 0, error: "" };
  emitSortProgress({ type: "scan", processed: 0, total, groups: 0, copies: 0 });

  if (!total) {
    sortStatus = { running: false, phase: "done", processed: 0, total: 0, groups: 0, copies: 0, error: "" };
    emitSortProgress({ type: "done", processed: 0, total: 0, groups: 0, copies: 0 });
    return { groups: [], total: 0, copies: 0 };
  }

  const prepared = [];
  const nameSizeMap = new Map();
  const contentMap = new Map();

  for (let i = 0; i < items.length; i += 1) {
    if (runId !== sortSessionId) throw new Error("Сортировка была прервана");

    const item = items[i];
    const name = String(item.name || path.basename(item.path)).trim();
    const nameLower = name.toLowerCase();
    const size = Number(item.size || 0);
    const text = String(item.text || "");

    const entry = {
      index: i,
      path: item.path,
      name,
      size,
      nameKey: `${nameLower}|${size}`,
      contentKey: ""
    };

    if (entry.nameKey) {
      if (!nameSizeMap.has(entry.nameKey)) nameSizeMap.set(entry.nameKey, []);
      nameSizeMap.get(entry.nameKey).push(i);
    }

    if (text) {
      entry.contentKey = hashText(text);
      if (!contentMap.has(entry.contentKey)) contentMap.set(entry.contentKey, []);
      contentMap.get(entry.contentKey).push(i);
    }

    prepared.push(entry);

    if ((i + 1) % 200 === 0 || i + 1 === items.length) {
      sortStatus = { ...sortStatus, phase: "scan", processed: i + 1, total };
      emitSortProgress({ type: "scan", processed: i + 1, total, groups: 0, copies: 0 });
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  const uf = createUnionFind(prepared.length);
  const unionBucket = (bucket) => {
    if (!bucket || bucket.length < 2) return;
    const first = bucket[0];
    for (let i = 1; i < bucket.length; i += 1) {
      uf.union(first, bucket[i]);
    }
  };

  for (const bucket of nameSizeMap.values()) unionBucket(bucket);
  for (const bucket of contentMap.values()) unionBucket(bucket);

  const grouped = new Map();
  for (let i = 0; i < prepared.length; i += 1) {
    const root = uf.find(i);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(prepared[i]);
  }

  const groups = [];
  let totalCopies = 0;

  for (const list of grouped.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.path.localeCompare(b.path, "ru"));

    const original = list[0];
    const copies = list.slice(1);
    if (!copies.length) continue;

    const nameKeys = new Map();
    const contentKeys = new Map();
    for (const file of list) {
      if (file.nameKey) nameKeys.set(file.nameKey, (nameKeys.get(file.nameKey) || 0) + 1);
      if (file.contentKey) contentKeys.set(file.contentKey, (contentKeys.get(file.contentKey) || 0) + 1);
    }

    const hasNameMatch = Array.from(nameKeys.values()).some((count) => count > 1);
    const hasContentMatch = Array.from(contentKeys.values()).some((count) => count > 1);
    const reason = hasNameMatch && hasContentMatch
      ? "Совпадают название и содержимое"
      : hasContentMatch
        ? "Совпадает содержимое"
        : "Похожее название и размер";

    groups.push({
      id: `dup-${groups.length + 1}`,
      reason,
      original: { path: original.path, name: original.name, size: original.size },
      copies: copies.map((file) => ({ path: file.path, name: file.name, size: file.size }))
    });
    totalCopies += copies.length;
  }

  groups.sort((a, b) => b.copies.length - a.copies.length);

  sortStatus = {
    running: false,
    phase: "done",
    processed: total,
    total,
    groups: groups.length,
    copies: totalCopies,
    error: ""
  };
  emitSortProgress({ type: "done", processed: total, total, groups: groups.length, copies: totalCopies });

  lastDuplicateResult = { groups, total, copies: totalCopies };
  return { groups, total, copies: totalCopies };
}

function deleteDuplicateFiles(pathsToDelete) {
  const unique = Array.from(new Set((Array.isArray(pathsToDelete) ? pathsToDelete : []).filter((p) => typeof p === "string" && p)));
  const deleted = [];
  const failed = [];

  for (const filePath of unique) {
    try {
      if (!fs.existsSync(filePath)) {
        failed.push({ path: filePath, error: "Файл не найден" });
        continue;
      }
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile()) {
        failed.push({ path: filePath, error: "Это не файл" });
        continue;
      }
      fs.unlinkSync(filePath);
      deleted.push(filePath);
    } catch (error) {
      failed.push({ path: filePath, error: error?.message || String(error) });
    }
  }

  if (deleted.length) {
    for (const key of Object.keys(indexData.files || {})) {
      const item = indexData.files[key];
      if (item?.path && deleted.includes(item.path)) {
        delete indexData.files[key];
      }
    }
    try {
      fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), "utf8");
    } catch {
      // ignore
    }
    indexStatus = { ...indexStatus, fileCount: Object.keys(indexData.files || {}).length };
    mainWindow?.webContents.send("index-status", indexStatus);
  }

  return { deleted, failed };
}

function scheduleIndexingInterval() {
  if (indexIntervalTimer) {
    clearInterval(indexIntervalTimer);
    indexIntervalTimer = null;
  }
  const seconds = Math.max(30, Number.parseInt(settings.indexIntervalSec || 60, 10) || 60);
  indexIntervalTimer = setInterval(() => {
    if (settings.paused) return;
    if (indexWorker || indexStatus.state === "indexing") return;

    // Never auto-start full indexing again when index file already exists.
    if (hasIndexFileOnDisk()) {
      if (indexStatus.state !== "ready") {
        hasSavedIndexSnapshot();
        mainWindow?.webContents.send("index-status", indexStatus);
      }
      return;
    }

    if (indexStatus.state === "idle" || indexStatus.state === "error") {
      startIndexing();
    }
  }, seconds * 1000);
}

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    try {
      const iconPath = getAppIconPath();
      if (iconPath && app.dock?.setIcon) {
        const img = nativeImage.createFromPath(iconPath);
        if (!img.isEmpty()) app.dock.setIcon(img);
      }
    } catch (error) {
      console.error("dock icon set failed", error?.message || error);
    }
  }
  createWindow();
  createTray();
  initAutoUpdater();

  indexPath = path.join(app.getPath("userData"), "index.json");
  settingsPath = path.join(app.getPath("userData"), "settings.json");
  aiStatePath = path.join(app.getPath("userData"), "ai-state.json");
  migrateLegacyUserData();
  loadSettings();
  loadAiStatus();
  syncAiModelFromSettings();
  applyWindowPosition();
  registerHotkey();
  loadIndex();
  loadReport();
  const hasIndex = hasSavedIndexSnapshot() || hasIndexFileOnDisk() || (indexData?.files && Object.keys(indexData.files).length > 0);
  if (!settings.paused && !hasIndex) {
    startIndexing();
  } else if (hasIndex) {
    if (!indexData?.files || !Object.keys(indexData.files).length) {
      hasSavedIndexSnapshot();
    }
    indexStatus = { ...indexStatus, state: "ready", fileCount: Object.keys(indexData.files || {}).length };
    mainWindow?.webContents.send("index-status", indexStatus);
  }
  scheduleIndexingInterval();

  app.setLoginItemSettings({ openAtLogin: true });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});


ipcMain.handle("set-window-height", async (_event, height) => {
  if (!mainWindow) return;
  const h = Math.max(140, Math.min(520, Number(height) || 180));
  const bounds = mainWindow.getBounds();
  mainWindow.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: h }, false);
});

ipcMain.handle("open-path", async (_event, filePath) => {
  if (typeof filePath !== "string") return;
  await shell.openPath(filePath);
});

ipcMain.handle("open-in-folder", async (_event, filePath) => {
  if (typeof filePath !== "string") return false;
  shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle("open-sort-window", async () => {
  createSortWindow();
  if (sortWindow && sortWindow.webContents.isLoading()) {
    sortWindow.webContents.once("did-finish-load", () => {
      sortWindow?.webContents.send("sort-opened", { ts: Date.now() });
    });
  } else {
    sortWindow?.webContents.send("sort-opened", { ts: Date.now() });
  }
  return true;
});

ipcMain.handle("close-sort-window", async () => {
  if (sortWindow && !sortWindow.isDestroyed()) {
    sortWindow.close();
  }
  return true;
});

ipcMain.handle("get-duplicate-result", async () => lastDuplicateResult);

ipcMain.handle("open-settings", async () => {
  createSettingsWindow();
  if (mainWindow && !mainWindowPrevBounds) {
    mainWindowPrevBounds = mainWindow.getBounds();
  }
  centerWithSettings();
  settingsWindow?.show();
  settingsWindow?.focus();
});

ipcMain.handle("close-settings", async () => {
  hideSettingsWindow();
  return true;
});

ipcMain.handle("hide-window", async () => {
  hideSettingsWindow();
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle("search", async (_event, query) => {
  if (!indexData?.files || !Object.keys(indexData.files).length) {
    loadIndex();
  }
  try {
    console.log("search query", query);
  } catch {}
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
  const out = results.slice(0, 20);
  try { console.log("search results", out.length); } catch {}
  return out;
});

ipcMain.handle("get-index-status", async () => indexStatus);

ipcMain.handle("get-report-path", async () => {
  const reportPath = indexPath.replace(/\.json$/i, "") + "-report.json";
  return reportPath;
});

ipcMain.handle("open-report", async () => {
  const reportPath = indexPath.replace(/\.json$/i, "") + "-report.json";
  await shell.openPath(reportPath);
});


ipcMain.handle("get-ai-status", async () => aiStatus);

ipcMain.handle("ask-ai", async (_event, query, filePaths) => {
  const q = String(query || "").trim();
  const attached = Array.isArray(filePaths) ? filePaths : [];
  if (!q) return { ok: false, error: "Пустой запрос" };

  try {
    const moveResult = await tryHandleMoveRequest(q, attached);
    if (moveResult.handled) {
      if (!moveResult.ok) return { ok: false, error: moveResult.message };
      return { ok: true, answer: moveResult.message, moved: moveResult.moved || [], model: getSelectedModel() };
    }

    const answer = await askLocalAi(q, attached);
    return { ok: true, answer, model: getSelectedModel() };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});


ipcMain.handle("install-ai", async () => {
  if (aiStatus.installing) return aiStatus;

  aiStatus = { ...aiStatus, installing: true, progress: "Подготовка установки...", error: "" };
  emitAiStatus();

  try {
    await pullAiModel();
    aiStatus = { ...aiStatus, installing: false, installed: true, progress: "ИИ установлен", error: "" };
    saveAiStatus();
  } catch (error) {
    aiStatus = { ...aiStatus, installing: false, installed: false, error: error?.message || String(error) };
  }

  emitAiStatus();
  return aiStatus;
});

ipcMain.handle("remove-ai", async () => {
  if (aiStatus.installing) return aiStatus;

  const out = await runCommand("ollama", ["rm", getSelectedModel()]);
  if (out.code !== 0 && out.code !== null) {
    aiStatus = { ...aiStatus, error: out.stderr || out.stdout || "Не удалось удалить модель" };
    emitAiStatus();
    return aiStatus;
  }

  aiStatus = { ...aiStatus, installed: false, installing: false, progress: "", error: "" };
  saveAiStatus();
  emitAiStatus();
  return aiStatus;
});


ipcMain.handle("create-file-from-ai", async (_event, payload) => {
  try {
    const query = String(payload?.query || "");
    const answer = String(payload?.answer || "");
    const ext = detectCreateFileIntent(query);
    if (!ext) return { ok: false, skipped: true };

    const outPath = createFileOnDesktop(ext, answer);
    return { ok: true, path: outPath, name: path.basename(outPath), ext };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("get-system-profile", async () => getSystemProfile());
ipcMain.handle("get-recommended-model", async () => getRecommendedModel());
ipcMain.handle("get-settings", async () => settings);

ipcMain.handle("update-settings", async (_event, partial) => {
  if (partial && typeof partial === "object") {
    settings = { ...settings, ...partial };
    if (partial.rememberPos === false) settings.windowPos = null;
    saveSettings();
    if (partial.hotkey) registerHotkey();
    if (partial.aiModel) syncAiModelFromSettings();
    if (typeof partial.indexIntervalSec !== "undefined") scheduleIndexingInterval();
    // do not restart indexing on save; only manual refresh
    if (mainWindow) mainWindow.webContents.send("settings-updated", settings);
  }
  return settings;
});


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
  indexStatus = { state: "indexing", scanned: 0, total: 0, fileCount: Object.keys(indexData.files || {}).length, roots: settings.roots || [] , byExt: indexStatus.byExt || {}, scannedByExt: indexStatus.scannedByExt || {}, lastError: null };
  mainWindow?.webContents.send("index-status", indexStatus);
  settings.paused = false;
  saveSettings();
  startIndexing();
  return indexStatus;
});

ipcMain.handle("start-duplicate-sort", async () => {
  if (sortStatus.running) {
    return { ok: false, error: "Сортировка уже выполняется" };
  }

  try {
    const result = await runDuplicateSort();
    return { ok: true, ...result };
  } catch (error) {
    sortStatus = { ...sortStatus, running: false, phase: "error", error: error?.message || String(error) };
    emitSortProgress({ type: "error", message: sortStatus.error });
    return { ok: false, error: sortStatus.error };
  }
});

ipcMain.handle("delete-duplicate-files", async (_event, pathsToDelete) => {
  try {
    const result = deleteDuplicateFiles(pathsToDelete);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});
