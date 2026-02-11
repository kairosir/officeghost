const { app, BrowserWindow, globalShortcut, ipcMain, shell, screen, dialog, Tray, Menu, nativeImage } = require("electron");
const { fork, spawn } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

let mainWindow = null;
let settingsWindow = null;
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
  "найди", "найти", "поищи", "поиск", "информация", "инфо", "данные", "покажи", "скажи", "расскажи", "собери", "сделай", "пожалуйста", "про",
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

  const tokens = tokenizeQuery(raw);
  if (!tokens.length) return [];

  const tokenVarMap = new Map(tokens.map((t) => [t, tokenVariants(t)]));
  const scored = [];

  for (const item of Object.values(indexData.files || {})) {
    const name = String(item.name || "").toLowerCase();
    const pathText = String(item.path || "").toLowerCase();
    const text = String(item.text || "");
    const textLower = text.toLowerCase();

    let score = 0;
    const hitTokens = new Set();

    if (name.includes(raw) || pathText.includes(raw) || textLower.includes(raw)) {
      score += 14;
      hitTokens.add("phrase");
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

      if (inName) score += 8;
      if (inPath) score += 4;
      if (inText) score += 2;
      if (inName || inPath || inText) hitTokens.add(token);
    }

    const minHits = tokens.length >= 2 ? 2 : 1;
    if (!score || hitTokens.size < minHits) continue;

    let snippet = text.slice(0, 560);
    const focusToken = tokens.find((t) => {
      const variants = tokenVarMap.get(t) || [t];
      return variants.some((v) => textLower.includes(v));
    }) || raw;

    const idx = textLower.indexOf(focusToken);
    if (idx !== -1) {
      const start = Math.max(0, idx - 220);
      const end = Math.min(text.length, idx + focusToken.length + 380);
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
    "Ты дружелюбный локальный AI-ассистент для работы с файлами пользователя.",
    "Используй только факты из локальных файлов ниже. Интернет использовать нельзя.",
    "Отвечай простым человеческим языком, без канцелярита и без шаблонных заголовков.",
    "Если данных мало, предложи 1-2 уточняющих вопроса или попроси добавить файл.",
    "Если уверенно нашел данные, кратко перечисли, что именно нашел и где (пути файлов можно упомянуть в конце обычным списком).",
    "Запрос пользователя:",
    query,
    "",
    "Контекст из индекса:",
    contextBlock || "[пусто]",
    "",
    "Прикрепленные пользователем файлы:",
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

  const yesNoFilesQuery = /^(есть\s+ли|есть)\b.*(файл|файлы|документ|документы)/i.test(q);
  if (yesNoFilesQuery && useFileMode) {
    if (!hasLocalContext && !hasAttachedText) {
      const rough = quickCategoryMatches(q, 3);
      if (rough.length) {
        return `Да, похожие файлы есть. Вот примеры:
- ${rough.join("\n- ")}`;
      }
      return "Пока не нашел подходящие файлы по этому запросу. Можешь уточнить тему или добавить файл в окно ИИ.";
    }
    const examples = contextItems.slice(0, 3).map((item) => item.path).filter(Boolean);
    const prefix = contextItems.length > 0 ? "Да, похожие файлы есть." : "Да, нашел данные во вложенных файлах.";
    return examples.length
      ? `${prefix}
Примеры:
- ${examples.join("\n- ")}`
      : prefix;
  }

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
    { type: "separator" },
    { label: "Выход", click: () => app.quit() }
  ]);
  tray.setToolTip("AI Assistant");
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

function scheduleIndexingInterval() {
  if (indexIntervalTimer) {
    clearInterval(indexIntervalTimer);
    indexIntervalTimer = null;
  }
  const seconds = Math.max(30, Number.parseInt(settings.indexIntervalSec || 60, 10) || 60);
  indexIntervalTimer = setInterval(() => {
    if (settings.paused) return;
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

  indexPath = path.join(app.getPath("userData"), "index.json");
  settingsPath = path.join(app.getPath("userData"), "settings.json");
  aiStatePath = path.join(app.getPath("userData"), "ai-state.json");
  loadSettings();
  loadAiStatus();
  syncAiModelFromSettings();
  applyWindowPosition();
  registerHotkey();
  loadIndex();
  loadReport();
  const hasIndex = indexData?.files && Object.keys(indexData.files).length > 0;
  if (!settings.paused && !hasIndex) startIndexing();
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
  if (!q) return { ok: false, error: "Пустой запрос" };

  try {
    const answer = await askLocalAi(q, Array.isArray(filePaths) ? filePaths : []);
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
