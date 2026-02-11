const fs = require("fs/promises");
const path = require("path");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const xlsx = require("xlsx");

const MAX_FILES = Infinity;
const DEFAULT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 20000;
const RATE_LIMIT_BATCH = 400;
const RATE_LIMIT_WINDOW_MS = 90 * 1000;

const SUPPORTED_EXTS = new Set([".txt", ".md", ".pdf", ".docx", ".xlsx"]);
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".DS_Store",
  "Library",
  "System Volume Information",
  "$RECYCLE.BIN"
]);

let maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_BYTES;
let unlimitedIndexing = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function safeStat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function walkDir(root, onFile) {
  const queue = [root];

  while (queue.length) {
    const current = queue.pop();
    if (!current) continue;

    let dir;
    try {
      dir = await fs.opendir(current);
    } catch {
      continue;
    }

    for await (const entry of dir) {
      if (entry.name.startsWith(".")) continue;
      if (IGNORE_DIRS.has(entry.name)) continue;

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile()) {
        await onFile(fullPath);
      }
    }
  }
}

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (!SUPPORTED_EXTS.has(ext)) return "";

  const stat = await safeStat(filePath);
  if (!stat || stat.size > maxFileSizeBytes) return "";

  if (ext === ".txt" || ext === ".md") {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.slice(0, MAX_TEXT_CHARS);
  }

  if (ext === ".pdf") {
    const data = await fs.readFile(filePath);
    const parsed = await pdfParse(data);
    return (parsed.text || "").slice(0, MAX_TEXT_CHARS);
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return (result.value || "").slice(0, MAX_TEXT_CHARS);
  }

  if (ext === ".xlsx") {
    const workbook = xlsx.readFile(filePath, { cellText: true, cellDates: true });
    const texts = [];
    workbook.SheetNames.forEach((name) => {
      const sheet = workbook.Sheets[name];
      const csv = xlsx.utils.sheet_to_csv(sheet);
      texts.push(csv);
    });
    return texts.join("\n").slice(0, MAX_TEXT_CHARS);
  }

  return "";
}

async function countCandidates(roots) {
  let total = 0;
  const byExt = {};
  let batchStart = Date.now();
  let batchCount = 0;

  for (const root of roots) {
    await walkDir(root, async (filePath) => {
      const ext = require("path").extname(filePath).toLowerCase();
      if (!SUPPORTED_EXTS.has(ext)) return;
      const stat = await safeStat(filePath);
      if (!stat || stat.size > maxFileSizeBytes) return;
      total += 1;
      byExt[ext] = (byExt[ext] || 0) + 1;
    });
  }
  return { total, byExt };
}

async function writeReport(indexPath, scanned, total, byExt, scannedByExt) {
  const report = {
    updatedAt: new Date().toISOString(),
    scanned,
    total,
    byExt,
    scannedByExt
  };
  try {
    const reportPath = indexPath.replace(/\.json$/i, "") + "-report.json";
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  } catch {
    // ignore
  }
}

async function buildIndex(roots, indexPath) {
  let index = {
    version: 1,
    updatedAt: new Date().toISOString(),
    files: {}
  };

  try {
    const raw = await fs.readFile(indexPath, "utf8");
    index = JSON.parse(raw);
  } catch {
    // ignore
  }

  const seen = new Set();
  let scanned = 0;
  const scannedByExt = {};
  const { total, byExt } = await countCandidates(roots);
  process.send?.({ type: "progress", scanned, total, byExt, scannedByExt });

  let batchStart = Date.now();
  let batchCount = 0;

  const tick = async (ext) => {
    scanned += 1;
    scannedByExt[ext] = (scannedByExt[ext] || 0) + 1;

    if (scanned % 20 === 0) {
      process.send?.({ type: "progress", scanned, total, byExt, scannedByExt });
    }

    batchCount += 1;
    if (!unlimitedIndexing && batchCount >= RATE_LIMIT_BATCH) {
      const elapsed = Date.now() - batchStart;
      if (elapsed < RATE_LIMIT_WINDOW_MS) {
        const waitMs = RATE_LIMIT_WINDOW_MS - elapsed;
        process.send?.({ type: "throttle", waitMs });
        await sleep(waitMs);
      }
      batchStart = Date.now();
      batchCount = 0;
    }
  };

  for (const root of roots) {
    await walkDir(root, async (filePath) => {
      if (scanned >= MAX_FILES) return;

      const ext = path.extname(filePath).toLowerCase();
      if (!SUPPORTED_EXTS.has(ext)) return;

      const stat = await safeStat(filePath);
      if (!stat || stat.size > maxFileSizeBytes) return;

      seen.add(filePath);

      const existing = index.files[filePath];
      if (existing && existing.mtimeMs === stat.mtimeMs && existing.size === stat.size) {
        await tick(ext);
        return;
      }

      const record = {
        path: filePath,
        name: path.basename(filePath),
        ext,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        text: ""
      };

      try {
        const text = await extractText(filePath);
        record.text = text;
      } catch {
        record.text = "";
      }

      index.files[filePath] = record;
      await tick(ext);
    });
  }

  for (const filePath of Object.keys(index.files)) {
    if (!seen.has(filePath)) delete index.files[filePath];
  }

  process.send?.({ type: "progress", scanned, total, byExt, scannedByExt });
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(index), "utf8");
  await writeReport(indexPath, scanned, total, byExt, scannedByExt);
  return index;
}

process.on("message", async (message) => {
  if (!message || message.type !== "start") return;
  const { roots, indexPath, maxFileSizeMb, unlimitedIndexing: unlimited } = message;
  unlimitedIndexing = !!unlimited;
  if (maxFileSizeMb && Number.isFinite(maxFileSizeMb)) {
    maxFileSizeBytes = Math.max(1, maxFileSizeMb) * 1024 * 1024;
  }
  process.send?.({ type: "status", state: "indexing" });

  try {
    await buildIndex(roots, indexPath);
    process.send?.({ type: "status", state: "ready" });
    process.send?.({ type: "done" });
  } catch (error) {
    process.send?.({ type: "status", state: "error", error: String(error) });
  }
});
