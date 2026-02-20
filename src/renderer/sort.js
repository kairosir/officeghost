const warningEl = document.getElementById("warning");
const progressEl = document.getElementById("progress");
const resultsEl = document.getElementById("results");
const progressTextEl = document.getElementById("progress-text");
const progressFillEl = document.getElementById("progress-fill");
const summaryEl = document.getElementById("summary");
const tbodyEl = document.getElementById("tbody");
const tableEl = document.getElementById("table");
const searchEl = document.getElementById("search");
const selectAllEl = document.getElementById("select-all");

const startBtn = document.getElementById("start");
const deleteSelectedBtn = document.getElementById("delete-selected");
const deleteAllBtn = document.getElementById("delete-all");
const closeBtn = document.getElementById("close");
const windowCloseBtn = document.getElementById("window-close");
const modeEl = document.getElementById("sort-mode");
const sortToolbarEl = document.querySelector(".toolbar");

let groups = [];
let sortRunning = false;
let searchQuery = "";
let freedBytes = 0;
let selectedPaths = new Set();
let sortMode = "duplicates";
let currentLanguage = "ru";

const I18N = {
  ru: {
    titleMain: "Сортировка файлов",
    titleWarning: "Сортировка файлов",
    warningText: "Перед запуском закрой все документы и не открывай файлы до завершения операции. Сейчас анализируются только Word (DOC/DOCX), Excel (XLS/XLSX) и PDF.",
    labelMode: "Режим",
    modeDuplicates: "Сортировка файлов (поиск похожих по названию и содержимому)",
    modeOrganize: "Упорядочить файлы (разложить по папкам по названию)",
    start: "Начать",
    titleProgress: "Анализ файлов",
    preparing: "Подготовка...",
    titleResults: "Результаты сортировки",
    searchPlaceholder: "Поиск по найденным копиям...",
    deleteSelected: "Удалить выбранные копии",
    deleteAll: "Удалить все копии",
    close: "Закрыть",
    headSelect: "Выбрать",
    headFile: "Файл",
    headPath: "Путь",
    headMatch: "Совпадает по",
    headSize: "Размер",
    headFolder: "Папка",
    noRows: "Ничего не найдено по текущему фильтру.",
    noFilesToSort: "Файлы для сортировки не найдены.",
    noSimilar: "Похожие файлы не найдены.",
    group: "Группа",
    similar: "Похожие файлы",
    original: "Оригинал",
    movedFrom: "Перемещен из",
    sortError: "Ошибка сортировки",
    deleteError: "Ошибка удаления",
    unknownError: "Неизвестная ошибка",
    analyzing: "Анализ файлов...",
    done: "Завершено",
    folderFallback: "Папка",
    folderPrefix: "Папка:",
    foldersCreated: "Создано подпапок",
    filesOrganized: "Разложено файлов",
    totalSize: "Общий размер",
    groups: "Групп",
    copies: "Копий",
    allFilesSize: "Общий размер всех файлов",
    copiesSize: "Размер копий",
    freed: "освобождено",
    deleted: "Удалено",
    errors: "Ошибок",
    confirmDeleteAll: "Точно удалить все копии файлов? Будет удалено"
  },
  en: {
    titleMain: "File sorting",
    titleWarning: "File sorting",
    warningText: "Before start, close all documents and do not open files until the operation finishes. Currently only Word (DOC/DOCX), Excel (XLS/XLSX) and PDF are analyzed.",
    labelMode: "Mode",
    modeDuplicates: "File sorting (find similar files by name and content)",
    modeOrganize: "Organize files (place into folders by name)",
    start: "Start",
    titleProgress: "File analysis",
    preparing: "Preparing...",
    titleResults: "Sorting results",
    searchPlaceholder: "Search in found duplicates...",
    deleteSelected: "Delete selected copies",
    deleteAll: "Delete all copies",
    close: "Close",
    headSelect: "Select",
    headFile: "File",
    headPath: "Path",
    headMatch: "Match by",
    headSize: "Size",
    headFolder: "Folder",
    noRows: "No matches for current filter.",
    noFilesToSort: "No files found for sorting.",
    noSimilar: "No similar files found.",
    group: "Group",
    similar: "Similar files",
    original: "Original",
    movedFrom: "Moved from",
    sortError: "Sort error",
    deleteError: "Delete error",
    unknownError: "Unknown error",
    analyzing: "Analyzing files...",
    done: "Done",
    folderFallback: "Folder",
    folderPrefix: "Folder:",
    foldersCreated: "Created subfolders",
    filesOrganized: "Organized files",
    totalSize: "Total size",
    groups: "Groups",
    copies: "Copies",
    allFilesSize: "Total size of all files",
    copiesSize: "Duplicate size",
    freed: "freed",
    deleted: "Deleted",
    errors: "Errors",
    confirmDeleteAll: "Delete all duplicate files? It will remove"
  }
};

function t(key) {
  return (I18N[currentLanguage] && I18N[currentLanguage][key]) || I18N.ru[key] || key;
}

function detectDefaultLanguage() {
  const n = (navigator.language || "en").toLowerCase();
  return n.startsWith("ru") ? "ru" : "en";
}

function applyI18n() {
  const byId = {
    "title-main": "titleMain",
    "title-warning": "titleWarning",
    "warning-text": "warningText",
    "label-mode": "labelMode",
    "mode-duplicates": "modeDuplicates",
    "mode-organize": "modeOrganize",
    "start": "start",
    "title-progress": "titleProgress",
    "title-results": "titleResults",
    "delete-selected": "deleteSelected",
    "delete-all": "deleteAll",
    "close": "close",
    "head-select": "headSelect",
    "head-file": "headFile",
    "head-path": "headPath",
    "head-match": "headMatch",
    "head-size": "headSize",
    "head-folder": "headFolder"
  };

  Object.entries(byId).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = t(key);
  });

  document.title = t("titleMain");
  if (searchEl) searchEl.placeholder = t("searchPlaceholder");
  if (progressTextEl && !progressTextEl.textContent.trim()) progressTextEl.textContent = t("preparing");
  if (windowCloseBtn) windowCloseBtn.title = `${t("close")} (Esc)`;
  document.documentElement.lang = currentLanguage;
}

async function resizeSortWindow(width, height) {
  if (!window.assistantApi.resizeSortWindow) return;
  try {
    await window.assistantApi.resizeSortWindow(width, height);
  } catch {
    // ignore
  }
}

function setSection(section) {
  warningEl.classList.toggle("hidden", section !== "warning");
  progressEl.classList.toggle("hidden", section !== "progress");
  resultsEl.classList.toggle("hidden", section !== "results");
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(size >= 100 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getAllCopyPaths() {
  return groups.flatMap((group) => (group.copies || []).map((copy) => copy.path)).filter(Boolean);
}

function syncSelectionWithGroups() {
  const all = new Set(getAllCopyPaths());
  selectedPaths = new Set(Array.from(selectedPaths).filter((p) => all.has(p)));
}

function initSelectionAll() {
  selectedPaths = new Set(getAllCopyPaths());
}

function filteredGroups() {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((group) => {
      const originalText = `${group.original?.name || ""} ${group.original?.path || ""}`.toLowerCase();
      const originalHit = originalText.includes(q);
      const copies = (group.copies || []).filter((copy) => `${copy.name || ""} ${copy.path || ""}`.toLowerCase().includes(q));
      if (originalHit) return group;
      if (!copies.length) return null;
      return { ...group, copies };
    })
    .filter(Boolean);
}

function getStats() {
  const allFilesBytes = groups.reduce((acc, group) => {
    const original = Number(group.original?.size || 0);
    const copies = (group.copies || []).reduce((s, copy) => s + Number(copy.size || 0), 0);
    return acc + original + copies;
  }, 0);

  const copiesBytes = groups.reduce((acc, group) => {
    return acc + (group.copies || []).reduce((s, copy) => s + Number(copy.size || 0), 0);
  }, 0);

  return { allFilesBytes, copiesBytes };
}

function updateDeleteButtonsState() {
  if (sortMode === "organized") {
    deleteAllBtn.disabled = true;
    deleteSelectedBtn.disabled = true;
    deleteAllBtn.classList.remove("active-danger");
    deleteSelectedBtn.classList.remove("active-accent");
    if (selectAllEl) {
      selectAllEl.checked = false;
      selectAllEl.indeterminate = false;
    }
    return;
  }

  const total = getAllCopyPaths().length;
  const checked = selectedPaths.size;

  deleteAllBtn.classList.remove("active-danger");
  deleteSelectedBtn.classList.remove("active-accent");

  deleteAllBtn.disabled = total === 0;
  deleteSelectedBtn.disabled = checked === 0;

  if (total > 0 && checked === total) {
    deleteAllBtn.classList.add("active-danger");
  } else if (checked > 0) {
    deleteSelectedBtn.classList.add("active-accent");
  }

  if (selectAllEl) {
    selectAllEl.checked = total > 0 && checked === total;
    selectAllEl.indeterminate = checked > 0 && checked < total;
  }
}

function updateSummary() {
  const groupCount = groups.length;
  const copyCount = groups.reduce((acc, g) => acc + (g.copies || []).length, 0);
  const { allFilesBytes, copiesBytes } = getStats();
  const freed = freedBytes > 0 ? ` (-${formatBytes(freedBytes)} ${t("freed")})` : "";

  if (!groupCount) {
    summaryEl.textContent = sortMode === "organized" ? t("noFilesToSort") : t("noSimilar");
    return;
  }

  if (sortMode === "organized") {
    const prefixRe = new RegExp(`^${t("folderPrefix").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i");
    const preview = groups
      .slice(0, 4)
      .map((g) => {
        const folder = (g.original?.name || g.reason || t("folderFallback")).replace(prefixRe, "");
        const count = (g.copies || []).length;
        return `${folder}: ${count}`;
      })
      .join(" | ");
    const suffix = groups.length > 4 ? " | ..." : "";
    summaryEl.textContent = `${t("foldersCreated")}: ${groupCount}. ${t("filesOrganized")}: ${copyCount}. ${t("totalSize")}: ${formatBytes(allFilesBytes)}.${freed} ${preview}${suffix}`;
    return;
  }

  summaryEl.textContent = `${t("groups")}: ${groupCount}. ${t("copies")}: ${copyCount}. ${t("allFilesSize")}: ${formatBytes(allFilesBytes)}. ${t("copiesSize")}: ${formatBytes(copiesBytes)}${freed}`;
}

function rowHtml({ checkbox, name, path, match, size, folderPath, isOriginal = false, id = "", checked = false }) {
  return `
    <div class="row ${isOriginal ? "original" : "copy"}">
      <div class="cell">${checkbox ? `<input id="${id}" type="checkbox" class="dup-check" data-path="${escapeHtml(path)}" ${checked ? "checked" : ""} />` : "—"}</div>
      <div class="cell">${checkbox ? `<label for="${id}">${escapeHtml(name)}</label>` : escapeHtml(name)}</div>
      <div class="cell path" title="${escapeHtml(path)}">${escapeHtml(path)}</div>
      <div class="cell">${escapeHtml(match)}</div>
      <div class="cell right">${formatBytes(size)}</div>
      <div class="cell center"><button class="open-btn" data-folder="${escapeHtml(folderPath || path)}">📁</button></div>
    </div>
  `;
}

function renderRows() {
  const list = filteredGroups();
  tbodyEl.innerHTML = "";

  if (!list.length) {
    tbodyEl.innerHTML = `<div class="empty">${t("noRows")}</div>`;
    updateDeleteButtonsState();
    return;
  }

  const selectAllWrap = document.querySelector(".check-head");
  if (selectAllWrap) {
    selectAllWrap.style.visibility = sortMode === "organized" ? "hidden" : "visible";
  }

  let html = "";
  list.forEach((group, groupIdx) => {
    html += `<div class="group"><div class="group-title">${t("group")} ${groupIdx + 1}: ${escapeHtml(group.reason || t("similar"))}</div>`;

    html += rowHtml({
      checkbox: false,
      name: group.original?.name || group.original?.path || "",
      path: group.original?.path || "",
      match: t("original"),
      size: Number(group.original?.size || 0),
      folderPath: group.original?.path || "",
      isOriginal: true
    });

    (group.copies || []).forEach((copy, idx) => {
      const copyPath = copy.path || "";
      const checkboxEnabled = sortMode !== "organized";
      html += rowHtml({
        checkbox: checkboxEnabled,
        id: `c-${groupIdx}-${idx}`,
        name: copy.name || copy.path || "",
        path: copyPath,
        match: sortMode === "organized" ? `${t("movedFrom")}: ${copy.from || ""}` : (group.reason || t("similar")),
        size: Number(copy.size || 0),
        folderPath: copyPath,
        checked: checkboxEnabled ? selectedPaths.has(copyPath) : false
      });
    });

    html += "</div>";
  });

  tbodyEl.innerHTML = html;

  tbodyEl.querySelectorAll("[data-folder]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      const filePath = btn.getAttribute("data-folder");
      if (filePath) window.assistantApi.openInFolder(filePath);
    });
  });

  tbodyEl.querySelectorAll(".dup-check").forEach((input) => {
    input.addEventListener("change", () => {
      const filePath = input.dataset.path;
      if (!filePath) return;
      if (input.checked) selectedPaths.add(filePath);
      else selectedPaths.delete(filePath);
      updateDeleteButtonsState();
    });
  });

  updateDeleteButtonsState();
}

function getSelectedPaths() {
  return Array.from(selectedPaths);
}

function trackFreedSpace(deletedPaths) {
  const deletedSet = new Set(deletedPaths || []);
  const freed = groups.reduce((acc, group) => {
    return acc + (group.copies || []).reduce((sum, copy) => {
      return sum + (deletedSet.has(copy.path) ? Number(copy.size || 0) : 0);
    }, 0);
  }, 0);
  freedBytes += freed;
}

function applyDeleted(deletedPaths) {
  const deletedSet = new Set(deletedPaths || []);
  groups = groups
    .map((group) => ({
      ...group,
      copies: (group.copies || []).filter((copy) => !deletedSet.has(copy.path))
    }))
    .filter((group) => (group.copies || []).length > 0);
  syncSelectionWithGroups();
}

async function removePaths(paths) {
  if (!paths.length) return;
  const resp = await window.assistantApi.deleteDuplicateFiles(paths);
  if (!resp?.ok) {
    summaryEl.textContent = `${t("deleteError")}: ${resp?.error || t("unknownError")}`;
    return;
  }

  trackFreedSpace(resp.deleted || []);
  applyDeleted(resp.deleted || []);
  updateSummary();
  renderRows();

  const failed = (resp.failed || []).length;
  if (failed) {
    summaryEl.textContent += ` ${t("errors")}: ${failed}.`;
  }
}

function setProgress(processed, total, label) {
  const tTotal = Math.max(1, Number(total || 0));
  const p = Math.max(0, Number(processed || 0));
  const pct = Math.max(0, Math.min(100, Math.round((p / tTotal) * 100)));
  progressTextEl.textContent = `${label} ${p}/${tTotal}`;
  progressFillEl.style.width = `${pct}%`;
}

function initColumnResize() {
  const colMap = {
    file: "--c-file",
    path: "--c-path",
    match: "--c-match",
    size: "--c-size"
  };

  let state = null;
  document.querySelectorAll(".head-resizable .resizer").forEach((resizer) => {
    resizer.addEventListener("mousedown", (event) => {
      const col = resizer.parentElement?.dataset.col;
      const varName = colMap[col];
      if (!varName) return;

      const computed = getComputedStyle(tableEl).getPropertyValue(varName).trim();
      const startWidth = parseFloat(computed) || resizer.parentElement.getBoundingClientRect().width;
      state = { varName, startX: event.clientX, startWidth };
      event.preventDefault();
    });
  });

  window.addEventListener("mousemove", (event) => {
    if (!state) return;
    const width = Math.max(120, state.startWidth + (event.clientX - state.startX));
    tableEl.style.setProperty(state.varName, `${width}px`);
  });

  window.addEventListener("mouseup", () => {
    state = null;
  });
}

async function startSort() {
  sortRunning = true;
  await resizeSortWindow(1080, 860);
  setSection("progress");
  setProgress(0, 1, t("analyzing"));

  const mode = modeEl ? modeEl.value : "duplicates";
  const resp = await window.assistantApi.startDuplicateSort(mode);
  sortRunning = false;

  setSection("results");
  if (!resp?.ok) {
    groups = [];
    selectedPaths = new Set();
    updateSummary();
    summaryEl.textContent = `${t("sortError")}: ${resp?.error || t("unknownError")}`;
    renderRows();
    return;
  }

  sortMode = resp.mode === "organized" || (modeEl && modeEl.value === "organize") ? "organized" : "duplicates";
  groups = Array.isArray(resp.groups) ? resp.groups : [];
  searchQuery = "";
  searchEl.value = "";
  freedBytes = 0;
  initSelectionAll();

  if (deleteSelectedBtn) deleteSelectedBtn.style.display = sortMode === "organized" ? "none" : "";
  if (deleteAllBtn) deleteAllBtn.style.display = sortMode === "organized" ? "none" : "";

  updateSummary();
  renderRows();
}

window.addEventListener("sort-progress", (event) => {
  const detail = event.detail || {};
  if (detail.type === "scan") setProgress(detail.processed || 0, detail.total || 1, t("analyzing"));
  if (detail.type === "done") setProgress(detail.total || 1, detail.total || 1, t("done"));
});

window.addEventListener("sort-opened", async () => {
  sortMode = modeEl && modeEl.value === "organize" ? "organized" : "duplicates";
  if (deleteSelectedBtn) deleteSelectedBtn.style.display = "";
  if (deleteAllBtn) deleteAllBtn.style.display = "";
  await resizeSortWindow(820, 380);
  setSection("warning");
});

startBtn.addEventListener("click", async () => {
  if (sortRunning) return;
  await startSort();
});

deleteSelectedBtn.addEventListener("click", async () => {
  await removePaths(getSelectedPaths());
});

deleteAllBtn.addEventListener("click", async () => {
  const all = getAllCopyPaths();
  if (!all.length) return;
  const ok = window.confirm(`${t("confirmDeleteAll")}: ${all.length}.`);
  if (!ok) return;
  await removePaths(all);
});

closeBtn?.addEventListener("click", () => {
  if (window.assistantApi.closeSortWindow) {
    window.assistantApi.closeSortWindow();
  } else {
    window.close();
  }
});

windowCloseBtn?.addEventListener("click", () => {
  if (window.assistantApi.closeSortWindow) {
    window.assistantApi.closeSortWindow();
  } else {
    window.close();
  }
});

selectAllEl.addEventListener("change", () => {
  const checked = !!selectAllEl.checked;
  const all = getAllCopyPaths();
  selectedPaths = checked ? new Set(all) : new Set();
  renderRows();
});

searchEl.addEventListener("input", (event) => {
  searchQuery = String(event.target.value || "");
  renderRows();
});

window.addEventListener("DOMContentLoaded", async () => {
  try {
    const st = await window.assistantApi.getSettings();
    currentLanguage = st?.language === "ru" || st?.language === "en" ? st.language : detectDefaultLanguage();
  } catch {
    currentLanguage = detectDefaultLanguage();
  }
  applyI18n();
  initColumnResize();
  setSection("warning");

  sortToolbarEl?.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    const tNode = event.target;
    if (tNode && tNode.closest && tNode.closest("button, input, textarea, select, a")) return;
    if (window.assistantApi.beginDragSort) {
      window.assistantApi.beginDragSort().catch(() => {});
    }
  });

  const data = await window.assistantApi.getDuplicateResult();
  if (data && Array.isArray(data.groups)) {
    groups = data.groups;
    syncSelectionWithGroups();
    updateSummary();
  }
});

window.addEventListener("keydown", async (event) => {
  const isCmd = event.metaKey || event.ctrlKey;

  if (event.key === "Escape") {
    event.preventDefault();
    if (window.assistantApi.closeSortWindow) {
      window.assistantApi.closeSortWindow();
    } else {
      window.close();
    }
    return;
  }

  if (isCmd && event.key.toLowerCase() === "w") {
    event.preventDefault();
    if (window.assistantApi.closeSortWindow) {
      window.assistantApi.closeSortWindow();
    } else {
      window.close();
    }
    return;
  }

  if (isCmd && event.key.toLowerCase() === "r") {
    event.preventDefault();
    if (!sortRunning) await startSort();
    return;
  }

  if (isCmd && event.key.toLowerCase() === "f" && !resultsEl.classList.contains("hidden")) {
    event.preventDefault();
    searchEl.focus();
    searchEl.select();
  }
});
