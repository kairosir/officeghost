const input = document.getElementById("query");
const resultsContainer = document.getElementById("results");
const statusEl = document.getElementById("status");
const aiRowEl = document.getElementById("ai-row");
const aiResponseEl = document.getElementById("ai-response");
const aiFilesEl = document.getElementById("ai-files");
const aiCreatedEl = document.getElementById("ai-created");
const noResultsEl = document.getElementById("no-results");
const btnToggle = document.getElementById("btn-toggle");
const btnSettings = document.getElementById("btn-settings");
const btnAiMode = document.getElementById("btn-ai-mode");
const btnAppUpdate = document.getElementById("btn-app-update");
const btnClose = document.getElementById("btn-close");
const btnSend = document.getElementById("btn-send");
const toolbarEl = document.querySelector(".toolbar");
const sortModalEl = document.getElementById("sort-modal");
const sortCardEl = document.getElementById("sort-card");
const sortDragEl = document.getElementById("sort-drag");
const sortSearchEl = document.getElementById("sort-search");
const sortSpaceInfoEl = document.getElementById("sort-space-info");
const sortWarningEl = document.getElementById("sort-warning");
const sortProgressEl = document.getElementById("sort-progress");
const sortResultsEl = document.getElementById("sort-results");
const sortProgressTextEl = document.getElementById("sort-progress-text");
const sortProgressFillEl = document.getElementById("sort-progress-fill");
const sortSummaryEl = document.getElementById("sort-summary");
const sortListEl = document.getElementById("sort-list");
const sortStartBtn = document.getElementById("sort-start");
const sortCancelBtn = document.getElementById("sort-cancel");
const sortCloseBtn = document.getElementById("sort-close");
const sortDeleteSelectedBtn = document.getElementById("sort-delete-selected");
const sortDeleteAllBtn = document.getElementById("sort-delete-all");

let mode = "search";
let results = [];
let visibleResults = [];
let activeFilter = null;
let activeIndex = 0;
let status = { state: "idle", scanned: 0, total: 0 };
let aiStatus = { installed: false, installing: false, model: "qwen2.5:1.5b", progress: "", error: "" };
let aiFiles = [];
let aiHasAnswer = false;
let aiCreatedFile = null;
let searchTimer = null;
let settings = { rememberQuery: true, rememberPos: false, unlimitedIndexing: false, opacity: 0.92 };
let currentQuery = "";
let lastQuery = "";
let throttleUntil = 0;
let throttleTimer = null;
let duplicateGroups = [];
let sortRunning = false;
let sortWindowDrag = null;
let sortSearchQuery = "";
let aiStatusErrorTimer = null;
let aiResponseErrorTimer = null;
let lastAiAnswerHtml = "";
let currentLanguage = "ru";
let appUpdateStatus = { state: "idle", available: false, version: "", downloading: false, installed: false, error: "" };

const filterLabels = { docx: "Word", pdf: "PDF", xlsx: "Excel", txt: "Text", md: "Markdown" };

const I18N = {
  ru: {
    aiMode: "ИИ",
    aiModeTitle: "Режим ИИ",
    settings: "Настройки",
    refresh: "Обновить",
    close: "Закрыть",
    searchPlaceholder: "Искать файлы, заметки, проекты...",
    aiPlaceholder: "Напиши задачу по файлам...",
    send: "Отправить",
    sendTitle: "Отправить (Enter)",
    noResults: "Результатов нет",
    indexing: "Индексация...",
    ready: "Индекс готов. Файлов:",
    paused: "Индексация на паузе",
    indexError: "Ошибка индексации",
    pause: "Пауза",
    limit: "лимит 400 / 1.5 мин",
    unlimited: "без лимита",
    fileOps: "Работа с файлами",
    aiInstalled: "ИИ установлен",
    aiNotInstalled: "ИИ не установлен",
    aiInstall: "Установить ИИ",
    aiRemove: "Удалить",
    aiThinking: "Думаю...",
    aiQueryError: "Ошибка запроса",
    dragFiles: "Перетащи сюда файлы для ИИ",
    createdFile: "Создан файл:",
    open: "Открыть",
    folder: "Папка",
    sortTitle: "Сортировка файлов",
    sortBeforeStart: "Перед запуском",
    sortBeforeText: "Перед запуском закрой все документы и не открывай файлы до завершения сортировки.\nСейчас сортировка работает только с файлами: Word (DOC/DOCX), Excel (XLS/XLSX), PDF.\nНа этапе анализа ассистент ничего не удаляет и не изменяет. После анализа ты сам выбираешь, какие копии удалить.",
    cancel: "Отмена",
    start: "Начать",
    sortingInProgress: "Сортировка выполняется",
    duplicateFiles: "Похожие файлы",
    searchCopies: "Поиск по найденным копиям...",
    copySizeTotal: "Общий размер копий:",
    deleteSelectedCopies: "Удалить выбранные копии",
    deleteAllCopies: "Удалить все копии",
    select: "Выбрать",
    file: "Файл",
    path: "Путь",
    matchBy: "Совпадает по",
    original: "Оригинал",
    group: "Группа",
    analyzingFiles: "Анализ файлов...",
    sortError: "Ошибка сортировки",
    deleteError: "Ошибка удаления"
    ,
    showInFolder: "Показать в папке",
    similar: "Похожие",
    deleted: "Удалено",
    errors: "Ошибок",
    done: "Завершено"
    ,
    updateApp: "Обновить",
    updateAvailable: "Доступно обновление",
    updateDownloading: "Загрузка обновления...",
    updateInstalled: "Обновление установлено. Перезапуск...",
    updateCheckError: "Ошибка проверки обновлений"
  },
  en: {
    aiMode: "AI",
    aiModeTitle: "AI mode",
    settings: "Settings",
    refresh: "Refresh",
    close: "Close",
    searchPlaceholder: "Search files, notes, projects...",
    aiPlaceholder: "Describe your task with files...",
    send: "Send",
    sendTitle: "Send (Enter)",
    noResults: "No results",
    indexing: "Indexing...",
    ready: "Index ready. Files:",
    paused: "Indexing paused",
    indexError: "Indexing error",
    pause: "Pause",
    limit: "limit 400 / 1.5 min",
    unlimited: "unlimited",
    fileOps: "File tools",
    aiInstalled: "AI installed",
    aiNotInstalled: "AI not installed",
    aiInstall: "Install AI",
    aiRemove: "Remove",
    aiThinking: "Thinking...",
    aiQueryError: "Request error",
    dragFiles: "Drop files here for AI",
    createdFile: "Created file:",
    open: "Open",
    folder: "Folder",
    sortTitle: "File sorting",
    sortBeforeStart: "Before start",
    sortBeforeText: "Before start, close all documents and do not open files until sorting finishes.\nSorting currently works only with: Word (DOC/DOCX), Excel (XLS/XLSX), PDF.\nDuring analysis, the assistant does not delete or modify files. After analysis, you choose which duplicates to remove.",
    cancel: "Cancel",
    start: "Start",
    sortingInProgress: "Sorting in progress",
    duplicateFiles: "Similar files",
    searchCopies: "Search in found duplicates...",
    copySizeTotal: "Total duplicate size:",
    deleteSelectedCopies: "Delete selected copies",
    deleteAllCopies: "Delete all copies",
    select: "Select",
    file: "File",
    path: "Path",
    matchBy: "Match by",
    original: "Original",
    group: "Group",
    analyzingFiles: "Analyzing files...",
    sortError: "Sort error",
    deleteError: "Delete error",
    showInFolder: "Show in folder",
    similar: "Similar",
    deleted: "Deleted",
    errors: "Errors",
    done: "Done"
    ,
    updateApp: "Update",
    updateAvailable: "Update available",
    updateDownloading: "Downloading update...",
    updateInstalled: "Update installed. Restarting...",
    updateCheckError: "Update check error"
  }
};

function tr(key) {
  return (I18N[currentLanguage] && I18N[currentLanguage][key]) || I18N.ru[key] || key;
}

function detectDefaultLanguage() {
  const n = (navigator.language || "en").toLowerCase();
  return n.startsWith("ru") ? "ru" : "en";
}

function applyLanguageUI() {
  const settingsBtn = document.getElementById("btn-settings");
  const toggleBtn = document.getElementById("btn-toggle");
  const closeBtn = document.getElementById("btn-close");
  const settingsIcon = document.getElementById("btn-settings-icon");
  const toggleIcon = document.getElementById("btn-toggle-icon");
  if (btnAiMode) {
    btnAiMode.textContent = tr("aiMode");
    btnAiMode.title = tr("aiModeTitle");
    btnAiMode.setAttribute("aria-label", tr("aiModeTitle"));
  }
  if (btnAppUpdate) {
    btnAppUpdate.textContent = tr("updateApp");
  }
  if (settingsBtn) {
    settingsBtn.title = tr("settings");
    settingsBtn.setAttribute("aria-label", tr("settings"));
  }
  if (toggleBtn) {
    toggleBtn.title = tr("refresh");
    toggleBtn.setAttribute("aria-label", tr("refresh"));
  }
  if (closeBtn) {
    closeBtn.title = tr("close");
    closeBtn.setAttribute("aria-label", tr("close"));
  }
  if (settingsIcon) settingsIcon.alt = tr("settings");
  if (toggleIcon) toggleIcon.alt = tr("refresh");
  if (btnSend) {
    btnSend.textContent = tr("send");
    btnSend.title = tr("sendTitle");
  }
  if (noResultsEl) noResultsEl.textContent = tr("noResults");
  const sortDragTitle = document.getElementById("sort-drag-title");
  const sortWarningTitle = document.getElementById("sort-warning-title");
  const sortWarningText = document.getElementById("sort-warning-text");
  const sortProgressTitle = document.getElementById("sort-progress-title");
  const sortResultsTitle = document.getElementById("sort-results-title");
  if (sortDragTitle) sortDragTitle.textContent = tr("sortTitle");
  if (sortWarningTitle) sortWarningTitle.textContent = tr("sortBeforeStart");
  if (sortWarningText) sortWarningText.innerHTML = escapeHtml(tr("sortBeforeText")).replace(/\n/g, "<br/>");
  if (sortProgressTitle) sortProgressTitle.textContent = tr("sortingInProgress");
  if (sortResultsTitle) sortResultsTitle.textContent = tr("duplicateFiles");
  if (sortSearchEl) sortSearchEl.placeholder = tr("searchCopies");
  if (sortCancelBtn) sortCancelBtn.textContent = tr("cancel");
  if (sortStartBtn) sortStartBtn.textContent = tr("start");
  if (sortCloseBtn) sortCloseBtn.textContent = tr("close");
  if (sortDeleteSelectedBtn) sortDeleteSelectedBtn.textContent = tr("deleteSelectedCopies");
  if (sortDeleteAllBtn) sortDeleteAllBtn.textContent = tr("deleteAllCopies");
  renderMode();
  renderAppUpdateButton();
}

function renderAppUpdateButton() {
  if (!btnAppUpdate) return;
  const st = appUpdateStatus || {};
  const show = !!st.available || st.state === "downloading";
  btnAppUpdate.classList.toggle("hidden", !show);
  if (!show) return;
  if (st.state === "downloading") {
    btnAppUpdate.textContent = tr("updateDownloading");
    btnAppUpdate.disabled = true;
    return;
  }
  const ver = st.version ? ` ${st.version}` : "";
  btnAppUpdate.textContent = `${tr("updateApp")}${ver}`;
  btnAppUpdate.disabled = false;
}

function setHidden(el, hidden) {
  if (!el) return;
  el.classList.toggle("hidden", hidden);
}

function setResultsVisibility(show) {
  setHidden(resultsContainer, !show);
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function highlight(text, query = "") {
  if (!text) return "";
  const safeText = escapeHtml(text);
  if (!query) return safeText;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escapedQuery, "gi");
  return safeText.replace(regex, (match) => `<span class="highlight">${match}</span>`);
}

function parseProgressMeta(progressText) {
  const text = String(progressText || "");
  const percentMatch = text.match(/(\d+)%/);
  const value = percentMatch ? Math.max(0, Math.min(100, parseInt(percentMatch[1], 10))) : null;
  return { text, percent: value };
}

function updateWindowHeight() {
  if (mode === "search") {
    if (!currentQuery) {
      window.assistantApi.setWindowHeight(220);
      return;
    }
    const hasRows = visibleResults.length > 0;
    window.assistantApi.setWindowHeight(hasRows ? 430 : 250);
    return;
  }

  const baseHeight = aiStatus.installed ? 250 : 220;
  const withAnswerHeight = aiStatus.installed ? 420 : 350;
  const withCreatedFileHeight = aiStatus.installed ? 560 : 500;
  if (aiCreatedFile) {
    window.assistantApi.setWindowHeight(withCreatedFileHeight);
    return;
  }
  window.assistantApi.setWindowHeight(aiHasAnswer ? withAnswerHeight : baseHeight);
}

function scheduleAiStatusErrorClear() {
  if (aiStatusErrorTimer) clearTimeout(aiStatusErrorTimer);
  if (!aiStatus.error) return;
  aiStatusErrorTimer = setTimeout(() => {
    aiStatus = { ...aiStatus, error: "" };
    renderAiRow();
  }, 10000);
}

function renderNoResults() {
  if (mode !== "search") {
    setHidden(noResultsEl, true);
    return;
  }
  const show = Boolean(currentQuery && visibleResults.length === 0);
  setHidden(noResultsEl, !show);
}

function renderCreatedFile() {
  if (!aiCreatedFile) {
    aiCreatedEl.innerHTML = "";
    setHidden(aiCreatedEl, true);
    return;
  }

  aiCreatedEl.innerHTML = `
    <div class="created-title">${tr("createdFile")} ${escapeHtml(aiCreatedFile.name || "result")}</div>
    <div class="created-path">${escapeHtml(aiCreatedFile.path || "")}</div>
    <div class="created-actions">
      <button class="result-action" data-open-file>${tr("open")}</button>
      <button class="result-action" data-open-folder>📁 ${tr("folder")}</button>
    </div>
  `;
  setHidden(aiCreatedEl, false);

  aiCreatedEl.querySelector("[data-open-file]")?.addEventListener("click", () => {
    window.assistantApi.openPath(aiCreatedFile.path);
  });
  aiCreatedEl.querySelector("[data-open-folder]")?.addEventListener("click", () => {
    window.assistantApi.openInFolder(aiCreatedFile.path);
  });
}

function renderResults() {
  resultsContainer.innerHTML = "";
  visibleResults = activeFilter
    ? results.filter((r) => r.path?.toLowerCase().endsWith(`.${activeFilter}`))
    : results;

  visibleResults.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "result" + (index === activeIndex ? " active" : "");
    row.innerHTML = `
      <div class="result-head">
        <div class="result-title">${highlight(item.title || "", currentQuery)}</div>
        <button class="result-action" title="${tr("showInFolder")}" data-folder>📁</button>
      </div>
      <div class="result-path">${highlight(item.path || "", currentQuery)}</div>
      <div class="result-snippet">${highlight(item.snippet || "", currentQuery)}</div>
    `;
    row.addEventListener("click", () => openResult(index));
    row.querySelector("[data-folder]")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (item.path) window.assistantApi.openInFolder(item.path);
    });
    resultsContainer.appendChild(row);
  });

  renderNoResults();
}

function renderMode() {
  const aiMode = mode === "ai";
  btnAiMode.classList.toggle("active", aiMode);
  btnAiMode.textContent = tr("aiMode");

  if (aiMode) {
    input.placeholder = tr("aiPlaceholder");
    setHidden(btnSend, false);
    setHidden(aiFilesEl, !aiStatus.installed);
    setHidden(aiResponseEl, !aiHasAnswer);
    setResultsVisibility(false);
    setHidden(noResultsEl, true);
  } else {
    input.placeholder = tr("searchPlaceholder");
    setHidden(btnSend, true);
    setHidden(aiResponseEl, true);
    setHidden(aiFilesEl, true);
    setHidden(aiCreatedEl, true);
    setResultsVisibility(Boolean(currentQuery && results.length));
  }

  updateWindowHeight();
}

function renderAiFiles() {
  if (!aiFilesEl) return;
  if (!aiFiles.length) {
    aiFilesEl.textContent = tr("dragFiles");
    return;
  }
  aiFilesEl.innerHTML = aiFiles
    .map((filePath, idx) => `<span class="ai-file-pill">${escapeHtml(filePath.split(/[\\/]/).pop())}<button class="ai-file-remove" data-remove="${idx}" title="${tr("aiRemove")}">×</button></span>`)
    .join("");

  aiFilesEl.querySelectorAll(".ai-file-remove").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const idx = Number(btn.dataset.remove);
      if (Number.isFinite(idx)) {
        aiFiles.splice(idx, 1);
        renderAiFiles();
      }
    });
  });
}

function openResult(index) {
  const item = visibleResults[index];
  if (!item) return;
  window.assistantApi.openPath(item.path);
  window.assistantApi.hideWindow();
}

function updateActiveIndex(nextIndex) {
  if (!visibleResults.length) return;
  activeIndex = (nextIndex + visibleResults.length) % visibleResults.length;
  renderResults();
}


function renderStatus() {
  const byExt = status.byExt || {};
  const scannedByExt = status.scannedByExt || {};

  statusEl.innerHTML = "";

  let textLine = "";
  if (status.state === "indexing") {
    const limitLabel = settings.unlimitedIndexing ? tr("unlimited") : tr("limit");
    textLine = `${tr("indexing")} ${status.scanned}/${status.total || "?"} (${limitLabel})`;
  } else if (status.state === "ready") {
    textLine = `${tr("ready")} ${status.fileCount || 0}`;
  } else if (status.state === "paused") {
    textLine = tr("paused");
  } else if (status.state === "error") {
    textLine = status.lastError ? `${tr("indexError")}: ${status.lastError}` : `${tr("indexError")}.`;
  }

  if (textLine) {
    const span = document.createElement("span");
    span.className = "status-text";
    span.textContent = textLine;
    statusEl.appendChild(span);
  }

  if (!settings.unlimitedIndexing && throttleUntil && Date.now() < throttleUntil) {
    const secs = Math.max(0, Math.ceil((throttleUntil - Date.now()) / 1000));
    const pause = document.createElement("span");
    pause.className = "status-text";
    pause.textContent = `${tr("pause")}: ${secs}s`;
    statusEl.appendChild(pause);
  }

  if (mode !== "search") return;

  const filters = ["docx", "pdf", "xlsx", "txt", "md"];
  if (status.state) {
    const wrap = document.createElement("div");
    wrap.className = "status-filters";
    filters.forEach((ext) => {
      const total = byExt[`.${ext}`] || 0;
      const done = scannedByExt[`.${ext}`] || 0;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "status-filter" + (activeFilter === ext ? " active" : "");
      btn.dataset.ext = ext;
      btn.textContent = `${filterLabels[ext]} ${done}/${total}`;
      btn.addEventListener("click", () => {
        activeFilter = activeFilter === ext ? null : ext;
        renderResults();
        renderStatus();
        updateWindowHeight();
      });
      wrap.appendChild(btn);
    });

    const sortBtn = document.createElement("button");
    sortBtn.type = "button";
    sortBtn.className = "status-filter status-sort-btn";
    sortBtn.textContent = tr("fileOps");
    sortBtn.addEventListener("click", () => {
      window.assistantApi.openSortWindow();
    });
    wrap.appendChild(sortBtn);

    statusEl.appendChild(wrap);
  }
}


function showSortSection(section) {
  setHidden(sortWarningEl, section !== "warning");
  setHidden(sortProgressEl, section !== "progress");
  setHidden(sortResultsEl, section !== "results");
  if (sortCardEl) {
    sortCardEl.classList.toggle("sort-results-mode", section === "results");
  }
}

function openSortWarning() {
  if (sortRunning) return;
  setHidden(sortModalEl, false);
  showSortSection("warning");
}

function closeSortModal() {
  if (sortRunning) return;
  setHidden(sortModalEl, true);
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

function filteredDuplicateGroups() {
  const q = sortSearchQuery.trim().toLowerCase();
  if (!q) return duplicateGroups;
  return duplicateGroups.map((group) => {
    const inOriginal = `${group.original?.name || ""} ${group.original?.path || ""}`.toLowerCase().includes(q);
    const copies = (group.copies || []).filter((copy) => `${copy.name || ""} ${copy.path || ""}`.toLowerCase().includes(q));
    if (inOriginal) return group;
    if (!copies.length) return null;
    return { ...group, copies };
  }).filter(Boolean);
}

function renderDuplicateGroups() {
  if (!sortListEl) return;
  sortListEl.innerHTML = "";

  const groupsToShow = filteredDuplicateGroups();
  if (!groupsToShow.length) {
    sortListEl.innerHTML = `<div class="sort-empty">${tr("duplicateFiles")} — ${tr("noResults").toLowerCase()}.</div>`;
    return;
  }

  const head = document.createElement("div");
  head.className = "sort-table-head";
  head.innerHTML = `
    <div class="sort-check-all-wrap"><input id="sort-select-all" type="checkbox" checked /><span>${tr("select")}</span></div>
    <div>${tr("file")}</div>
    <div>${tr("path")}</div>
    <div>${tr("matchBy")}</div>
    <div>${tr("folder")}</div>
  `;
  sortListEl.appendChild(head);

  groupsToShow.forEach((group, groupIndex) => {
    const container = document.createElement("div");
    container.className = "sort-group-block";

    const groupLabel = document.createElement("div");
    groupLabel.className = "sort-group-label";
    groupLabel.textContent = `${tr("group")} ${groupIndex + 1}: ${group.reason || tr("duplicateFiles")}`;
    container.appendChild(groupLabel);

    const originalRow = document.createElement("div");
    originalRow.className = "sort-table-row sort-original-row";
    originalRow.innerHTML = `
      <div>—</div>
      <div class="sort-file-cell">${escapeHtml(group.original?.name || group.original?.path || "")} <span class="sort-size">(${formatBytes(group.original?.size || 0)})</span></div>
      <div class="sort-path-cell">${escapeHtml(group.original?.path || "")}</div>
      <div>${tr("original")}</div>
      <div><button class="result-action" data-folder="${escapeHtml(group.original?.path || "")}" title="${tr("folder")}">📁</button></div>
    `;
    container.appendChild(originalRow);

    (group.copies || []).forEach((copy, idx) => {
      const checkboxId = `dup-${groupIndex}-${idx}`;
      const row = document.createElement("div");
      row.className = "sort-table-row sort-copy-row";
      row.innerHTML = `
        <div><input id="${checkboxId}" type="checkbox" class="dup-checkbox" data-path="${escapeHtml(copy.path || "")}" checked /></div>
        <div class="sort-file-cell"><label for="${checkboxId}">${escapeHtml(copy.name || copy.path || "")}</label> <span class="sort-size">(${formatBytes(copy.size || 0)})</span></div>
        <div class="sort-path-cell">${escapeHtml(copy.path || "")}</div>
        <div>${escapeHtml(group.reason || tr("similar"))}</div>
        <div><button class="result-action" data-folder="${escapeHtml(copy.path || "")}" title="${tr("folder")}">📁</button></div>
      `;
      container.appendChild(row);
    });

    sortListEl.appendChild(container);
  });

  sortListEl.querySelectorAll("[data-folder]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      const filePath = btn.getAttribute("data-folder");
      if (filePath) window.assistantApi.openInFolder(filePath);
    });
  });

  const selectAll = document.getElementById("sort-select-all");
  selectAll?.addEventListener("change", () => {
    const checked = !!selectAll.checked;
    sortListEl.querySelectorAll(".dup-checkbox").forEach((el) => {
      el.checked = checked;
    });
  });
}

function updateSortSummary() {
  const groups = duplicateGroups.length;
  const copies = duplicateGroups.reduce((acc, group) => acc + (group.copies || []).length, 0);
  const totalBytes = duplicateGroups.reduce((acc, group) => {
    return acc + (group.copies || []).reduce((sum, copy) => sum + Number(copy.size || 0), 0);
  }, 0);

  sortSummaryEl.textContent = groups
    ? (currentLanguage === "en"
      ? `Groups found: ${groups}. Copies to delete: ${copies}.`
      : `Найдено групп: ${groups}. Копий для удаления: ${copies}.`)
    : (currentLanguage === "en" ? "No similar files found." : "Похожие файлы не найдены.");

  if (sortSpaceInfoEl) {
    sortSpaceInfoEl.textContent = `${tr("copySizeTotal")} ${formatBytes(totalBytes)}`;
  }
}

function setSortProgress(processed, total, label) {
  const safeTotal = Math.max(1, Number(total || 0));
  const safeProcessed = Math.max(0, Number(processed || 0));
  const pct = Math.max(0, Math.min(100, Math.round((safeProcessed / safeTotal) * 100)));
  if (sortProgressTextEl) sortProgressTextEl.textContent = `${label} ${safeProcessed}/${safeTotal}`;
  if (sortProgressFillEl) sortProgressFillEl.style.width = `${pct}%`;
}

async function startDuplicateSort() {
  sortRunning = true;
  setHidden(sortModalEl, false);
  showSortSection("progress");
  setSortProgress(0, 1, tr("analyzingFiles"));

  const response = await window.assistantApi.startDuplicateSort();
  sortRunning = false;

  if (!response?.ok) {
    showSortSection("results");
    duplicateGroups = [];
    updateSortSummary();
    sortSummaryEl.textContent = `${tr("sortError")}: ${response?.error || (currentLanguage === "en" ? "Unknown error" : "Неизвестная ошибка")}`;
    renderDuplicateGroups();
    return;
  }

  duplicateGroups = Array.isArray(response.groups) ? response.groups : [];
  sortSearchQuery = "";
  if (sortSearchEl) sortSearchEl.value = "";
  showSortSection("results");
  updateSortSummary();
  renderDuplicateGroups();
}

function getSelectedDuplicatePaths() {
  return Array.from(document.querySelectorAll(".dup-checkbox:checked"))
    .map((el) => el.dataset.path)
    .filter(Boolean);
}

async function removeDuplicatePaths(paths) {
  if (!paths.length) return;
  const response = await window.assistantApi.deleteDuplicateFiles(paths);
  if (!response?.ok) {
    sortSummaryEl.textContent = `${tr("deleteError")}: ${response?.error || (currentLanguage === "en" ? "Unknown error" : "Неизвестная ошибка")}`;
    return;
  }

  const deletedSet = new Set(response.deleted || []);
  duplicateGroups = duplicateGroups.map((group) => ({
    ...group,
    copies: (group.copies || []).filter((copy) => !deletedSet.has(copy.path))
  })).filter((group) => (group.copies || []).length > 0);

  updateSortSummary();
  renderDuplicateGroups();

  const deletedCount = (response.deleted || []).length;
  const failedCount = (response.failed || []).length;
  sortSummaryEl.textContent += ` ${tr("deleted")}: ${deletedCount}.` + (failedCount ? ` ${tr("errors")}: ${failedCount}.` : "");
}

function initSortFloatingWindow() {
  if (!sortCardEl || !sortDragEl) return;

  sortCardEl.style.left = "20px";
  sortCardEl.style.top = "20px";

  sortDragEl.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    const rect = sortCardEl.getBoundingClientRect();
    sortWindowDrag = {
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top
    };
    event.preventDefault();
  });

  window.addEventListener("mousemove", (event) => {
    if (!sortWindowDrag) return;
    const dx = event.clientX - sortWindowDrag.startX;
    const dy = event.clientY - sortWindowDrag.startY;
    const left = Math.max(0, sortWindowDrag.left + dx);
    const top = Math.max(0, sortWindowDrag.top + dy);
    sortCardEl.style.left = `${left}px`;
    sortCardEl.style.top = `${top}px`;
  });

  window.addEventListener("mouseup", () => {
    sortWindowDrag = null;
  });
}

function renderAiRow() {
  if (!aiRowEl) return;
  aiRowEl.innerHTML = "";

  const left = document.createElement("div");
  left.className = "ai-progress-wrap";

  const text = document.createElement("span");
  text.className = "ai-text";

  if (aiStatus.installing) {
    const meta = parseProgressMeta(aiStatus.progress);
    text.textContent = meta.text || `${tr("aiMode")}: ...`;
    left.appendChild(text);

    const progress = document.createElement("div");
    progress.className = "ai-progress";
    const fill = document.createElement("div");
    fill.className = "ai-progress-fill";
    fill.style.width = `${meta.percent ?? 8}%`;
    progress.appendChild(fill);
    left.appendChild(progress);
  } else if (aiStatus.installed) {
    text.textContent = `${tr("aiInstalled")} (${aiStatus.model || "model"})`;
    left.appendChild(text);
  } else {
    text.textContent = tr("aiNotInstalled");
    left.appendChild(text);
  }

  aiRowEl.appendChild(left);

  if (aiStatus.error) {
    const error = document.createElement("span");
    error.className = "ai-error";
    error.textContent = aiStatus.error;
    aiRowEl.appendChild(error);
  }

  if (aiStatus.installing) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ai-btn";

  if (aiStatus.installed) {
    btn.textContent = tr("aiRemove");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      await window.assistantApi.removeAi();
    });
  } else {
    btn.textContent = tr("aiInstall");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      await window.assistantApi.installAi();
    });
  }

  aiRowEl.appendChild(btn);
}

function applySettings(newSettings) {
  settings = newSettings || settings;
  document.body.dataset.theme = "dark";
  document.documentElement.style.setProperty("--bg", `rgba(22, 25, 31, ${settings.opacity || 0.88})`);
  document.documentElement.style.setProperty("--text", "#f4f6f8");
  document.documentElement.style.setProperty("--muted", "#b6bec8");
  document.documentElement.style.setProperty("--panel", "rgba(34, 38, 46, 0.72)");
  document.documentElement.style.setProperty("--border", "rgba(255, 255, 255, 0.10)");
}

async function runAiQuery(query) {
  if (aiResponseErrorTimer) {
    clearTimeout(aiResponseErrorTimer);
    aiResponseErrorTimer = null;
  }
  aiHasAnswer = true;
  aiCreatedFile = null;
  renderCreatedFile();
  setHidden(aiResponseEl, false);
  updateWindowHeight();
  aiResponseEl.innerHTML = `<div class=\"ai-answer pending\">${tr("aiThinking")}</div>`;

  await new Promise((r) => setTimeout(r, 0));
  const resp = await window.assistantApi.askAi(query, aiFiles);
  if (!resp?.ok) {
    aiResponseEl.innerHTML = `<div class=\"ai-answer error\">${escapeHtml(resp?.error || tr("aiQueryError"))}</div>`;
    aiResponseErrorTimer = setTimeout(() => {
      if (lastAiAnswerHtml) {
        aiResponseEl.innerHTML = lastAiAnswerHtml;
        return;
      }
      aiHasAnswer = false;
      setHidden(aiResponseEl, true);
      aiResponseEl.innerHTML = "";
      updateWindowHeight();
    }, 10000);
    return;
  }

  const answer = resp.answer || "";
  lastAiAnswerHtml = `<div class=\"ai-answer\">${escapeHtml(answer).replace(/\n/g, "<br/>")}</div>`;
  aiResponseEl.innerHTML = lastAiAnswerHtml;
  if (aiStatus.error) {
    aiStatus = { ...aiStatus, error: "" };
    renderAiRow();
  }

  const created = await window.assistantApi.createFileFromAi({ query, answer });
  if (created?.ok && created.path) {
    aiCreatedFile = created;
    renderCreatedFile();
    updateWindowHeight();
  }
}

input.addEventListener("input", (event) => {
  const query = event.target.value.trim();
  currentQuery = query;
  lastQuery = query;
  if (settings.rememberQuery) {
    localStorage.setItem("lastQuery", lastQuery);
  }

  if (mode === "ai") {
    // Keep previous answer visible until user sends a new query.
    return;
  }

  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    if (!query) {
      results = [];
      visibleResults = [];
      activeIndex = 0;
      renderResults();
      renderStatus();
      setResultsVisibility(false);
      renderNoResults();
      updateWindowHeight();
      return;
    }

    results = await window.assistantApi.search(query);
    activeIndex = 0;
    renderResults();
    renderStatus();
    setResultsVisibility(visibleResults.length > 0);
    updateWindowHeight();
  }, 200);
});

input.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    if (mode === "ai") {
      const query = input.value.trim();
      if (query) await runAiQuery(query);
      return;
    }
    openResult(activeIndex);
    return;
  }

  if (mode === "search") {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      updateActiveIndex(activeIndex + 1);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      updateActiveIndex(activeIndex - 1);
    }
  }

  if (event.key === "Escape") {
    if (!sortModalEl?.classList.contains("hidden")) return;
    event.preventDefault();
    window.assistantApi.hideWindow();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!sortModalEl?.classList.contains("hidden")) return;
    window.assistantApi.hideWindow();
  }
});

window.addEventListener("focus-input", () => {
  input.focus();
  input.select();
});

window.addEventListener("dragover", (event) => {
  if (mode !== "ai" || !aiStatus.installed) return;
  event.preventDefault();
});

window.addEventListener("drop", (event) => {
  if (mode !== "ai" || !aiStatus.installed) return;
  event.preventDefault();
  const files = Array.from(event.dataTransfer?.files || []);
  const paths = files.map((f) => f.path).filter(Boolean);
  if (!paths.length) return;
  aiFiles = Array.from(new Set([...aiFiles, ...paths])).slice(0, 8);
  renderAiFiles();
});

window.addEventListener("DOMContentLoaded", () => {
  input.focus();
  setResultsVisibility(false);
  renderAiFiles();
  renderCreatedFile();
  renderStatus();

  window.assistantApi.getIndexStatus().then((data) => {
    status = data || status;
    renderStatus();
  }).catch(() => {
    renderStatus();
  });

  window.assistantApi.getSettings().then((data) => {
    const incoming = data || settings;
    currentLanguage = incoming.language === "en" || incoming.language === "ru"
      ? incoming.language
      : detectDefaultLanguage();
    if (!incoming.language) {
      window.assistantApi.updateSettings({ language: currentLanguage }).catch(() => {});
    }
    applyLanguageUI();
    applySettings(incoming);
    if (settings.rememberQuery) {
      const saved = localStorage.getItem("lastQuery");
      if (saved) {
        input.value = saved;
        input.dispatchEvent(new Event("input"));
      }
    }

    if (!settings.paused && window.assistantApi.startIndexing) {
      const st = status?.state || "idle";
      if (st === "idle" || st === "error") {
        window.assistantApi.startIndexing().catch(() => {});
      }
    }
  }).catch(() => {});

  if (window.assistantApi.getAiStatus) {
    window.assistantApi.getAiStatus().then((data) => {
      if (data && typeof data === "object") aiStatus = { ...aiStatus, ...data };
      renderAiRow();
      scheduleAiStatusErrorClear();
    });
  }

  if (window.assistantApi.getAppUpdateStatus) {
    window.assistantApi.getAppUpdateStatus().then((st) => {
      if (st && typeof st === "object") appUpdateStatus = { ...appUpdateStatus, ...st };
      renderAppUpdateButton();
      if (st?.state === "available") {
        aiStatus = { ...aiStatus, error: `${tr("updateAvailable")}${st?.version ? ` ${st.version}` : ""}` };
        renderAiRow();
        scheduleAiStatusErrorClear();
      }
    }).catch(() => {});
  }

  window.addEventListener("settings-updated", (event) => {
    const next = event.detail || settings;
    if (next.language === "en" || next.language === "ru") {
      currentLanguage = next.language;
      applyLanguageUI();
    }
    applySettings(next);
    renderStatus();
  });

  window.addEventListener("ai-status", (event) => {
    aiStatus = { ...aiStatus, ...(event.detail || {}) };
    renderAiRow();
    scheduleAiStatusErrorClear();
    renderMode();
    renderAiFiles();
  });

  window.addEventListener("app-update-status", (event) => {
    const st = event.detail || {};
    appUpdateStatus = { ...appUpdateStatus, ...st };
    renderAppUpdateButton();
    if (st.state === "available") {
      aiStatus = { ...aiStatus, error: `${tr("updateAvailable")}${st.version ? ` ${st.version}` : ""}` };
      renderAiRow();
      scheduleAiStatusErrorClear();
    } else if (st.state === "downloading") {
      aiStatus = { ...aiStatus, error: tr("updateDownloading") };
      renderAiRow();
      scheduleAiStatusErrorClear();
    } else if (st.state === "installed") {
      aiStatus = { ...aiStatus, error: tr("updateInstalled") };
      renderAiRow();
      scheduleAiStatusErrorClear();
    } else if (st.state === "error" && st.error) {
      aiStatus = { ...aiStatus, error: `${tr("updateCheckError")}: ${st.error}` };
      renderAiRow();
      scheduleAiStatusErrorClear();
    }
  });

  window.addEventListener("ai-progress", (event) => {
    const progress = event.detail?.message || "";
    aiStatus = { ...aiStatus, progress };
    renderAiRow();
  });

  window.addEventListener("sort-progress", (event) => {
    const detail = event.detail || {};
    if (detail.type === "scan") {
      setSortProgress(detail.processed || 0, detail.total || 1, tr("analyzingFiles"));
    }
  if (detail.type === "done") {
      setSortProgress(detail.total || 1, detail.total || 1, tr("done"));
    }
  });

  sortCancelBtn?.addEventListener("click", () => {
    closeSortModal();
  });

  sortCloseBtn?.addEventListener("click", () => {
    closeSortModal();
  });

  sortStartBtn?.addEventListener("click", async () => {
    if (sortRunning) return;
    await startDuplicateSort();
  });

  sortDeleteSelectedBtn?.addEventListener("click", async () => {
    const selected = getSelectedDuplicatePaths();
    await removeDuplicatePaths(selected);
  });

  sortDeleteAllBtn?.addEventListener("click", async () => {
    const all = Array.from(document.querySelectorAll(".dup-checkbox"))
      .map((el) => el.dataset.path)
      .filter(Boolean);
    await removeDuplicatePaths(all);
  });

  sortSearchEl?.addEventListener("input", (event) => {
    sortSearchQuery = String(event.target.value || "");
    renderDuplicateGroups();
  });

  toolbarEl?.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    const t = event.target;
    if (t && t.closest && t.closest("button, input, textarea, select, a")) return;
    if (window.assistantApi.beginDrag) {
      window.assistantApi.beginDrag().catch(() => {});
    }
  });

  initSortFloatingWindow();

  renderAiRow();
  renderMode();
  renderNoResults();
});

window.addEventListener("index-status", (event) => {
  status = event.detail || status;
  renderStatus();
});

window.addEventListener("index-throttle", (event) => {
  const waitMs = event.detail?.waitMs || 0;
  if (settings.unlimitedIndexing) return;
  if (waitMs > 0) {
    throttleUntil = Date.now() + waitMs;
    if (throttleTimer) clearInterval(throttleTimer);
    throttleTimer = setInterval(() => {
      if (!throttleUntil || Date.now() >= throttleUntil) {
        clearInterval(throttleTimer);
        throttleTimer = null;
        throttleUntil = 0;
      }
      renderStatus();
    }, 1000);
  }
});

btnToggle.addEventListener("click", async () => {
  status = { ...status, state: "indexing", scanned: 0, total: status.total || 0 };
  renderStatus();
  const updated = await window.assistantApi.refreshIndex();
  status = updated || status;
  renderStatus();
});

btnSettings.addEventListener("click", () => {
  window.assistantApi.openSettings();
});

btnAiMode.addEventListener("click", () => {
  mode = mode === "ai" ? "search" : "ai";
  renderMode();
  renderStatus();
  input.focus();
});

btnClose.addEventListener("click", () => {
  window.assistantApi.hideWindow();
});

btnAppUpdate?.addEventListener("click", async () => {
  if (btnAppUpdate.disabled) return;
  btnAppUpdate.disabled = true;
  try {
    await window.assistantApi.installAppUpdate();
  } catch {
    // ignore
  } finally {
    btnAppUpdate.disabled = false;
  }
});

btnSend.addEventListener("click", async () => {
  const query = input.value.trim();
  if (!query || mode !== "ai") return;
  await runAiQuery(query);
});
