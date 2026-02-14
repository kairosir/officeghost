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
const btnClose = document.getElementById("btn-close");
const btnSend = document.getElementById("btn-send");
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
let duplicateGroups = [];
let sortRunning = false;
let sortWindowDrag = null;
let sortSearchQuery = "";

const filterLabels = { docx: "Word", pdf: "PDF", xlsx: "Excel", txt: "Text", md: "Markdown" };

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
      window.assistantApi.setWindowHeight(200);
      return;
    }
    const hasRows = visibleResults.length > 0;
    window.assistantApi.setWindowHeight(hasRows ? 420 : 230);
    return;
  }

  const baseHeight = aiStatus.installed ? 290 : 220;
  const withAnswerHeight = aiStatus.installed ? 400 : 320;
  window.assistantApi.setWindowHeight(aiHasAnswer ? withAnswerHeight : baseHeight);
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
    <div class="created-title">Создан файл: ${escapeHtml(aiCreatedFile.name || "result")}</div>
    <div class="created-path">${escapeHtml(aiCreatedFile.path || "")}</div>
    <div class="created-actions">
      <button class="result-action" data-open-file>Открыть</button>
      <button class="result-action" data-open-folder>📁 Папка</button>
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
        <button class="result-action" title="Показать в папке" data-folder>📁</button>
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
  btnAiMode.textContent = "ИИ";

  if (aiMode) {
    input.placeholder = "Напиши задачу по файлам...";
    setHidden(btnSend, false);
    setHidden(aiFilesEl, !aiStatus.installed);
    setHidden(aiResponseEl, !aiHasAnswer);
    setResultsVisibility(false);
    setHidden(noResultsEl, true);
  } else {
    input.placeholder = "Искать файлы, заметки, проекты...";
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
    aiFilesEl.textContent = "Перетащи сюда файлы для ИИ";
    return;
  }
  aiFilesEl.innerHTML = aiFiles
    .map((filePath, idx) => `<span class="ai-file-pill">${escapeHtml(filePath.split(/[\\/]/).pop())}<button class="ai-file-remove" data-remove="${idx}" title="Удалить">×</button></span>`)
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
    const limitLabel = settings.unlimitedIndexing ? "без лимита" : "лимит 400 / 1.5 мин";
    textLine = `Индексация... ${status.scanned}/${status.total || "?"} (${limitLabel})`;
  } else if (status.state === "ready") {
    textLine = `Индекс готов. Файлов: ${status.fileCount || 0}`;
  } else if (status.state === "paused") {
    textLine = "Индексация на паузе";
  } else if (status.state === "error") {
    textLine = status.lastError ? `Ошибка индексации: ${status.lastError}` : "Ошибка индексации. Проверь логи.";
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
    pause.textContent = `Пауза: ${secs} сек`;
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
    sortBtn.textContent = "Сортировка";
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
    sortListEl.innerHTML = '<div class="sort-empty">Похожие файлы не найдены по текущему фильтру.</div>';
    return;
  }

  const head = document.createElement("div");
  head.className = "sort-table-head";
  head.innerHTML = `
    <div class="sort-check-all-wrap"><input id="sort-select-all" type="checkbox" checked /><span>Выбрать</span></div>
    <div>Файл</div>
    <div>Путь</div>
    <div>Совпадает по</div>
    <div>Папка</div>
  `;
  sortListEl.appendChild(head);

  groupsToShow.forEach((group, groupIndex) => {
    const container = document.createElement("div");
    container.className = "sort-group-block";

    const groupLabel = document.createElement("div");
    groupLabel.className = "sort-group-label";
    groupLabel.textContent = `Группа ${groupIndex + 1}: ${group.reason || "Похожие файлы"}`;
    container.appendChild(groupLabel);

    const originalRow = document.createElement("div");
    originalRow.className = "sort-table-row sort-original-row";
    originalRow.innerHTML = `
      <div>—</div>
      <div class="sort-file-cell">${escapeHtml(group.original?.name || group.original?.path || "")} <span class="sort-size">(${formatBytes(group.original?.size || 0)})</span></div>
      <div class="sort-path-cell">${escapeHtml(group.original?.path || "")}</div>
      <div>Оригинал</div>
      <div><button class="result-action" data-folder="${escapeHtml(group.original?.path || "")}" title="Открыть папку">📁</button></div>
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
        <div>${escapeHtml(group.reason || "Похожие")}</div>
        <div><button class="result-action" data-folder="${escapeHtml(copy.path || "")}" title="Открыть папку">📁</button></div>
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
    ? `Найдено групп: ${groups}. Копий для удаления: ${copies}.`
    : "Похожие файлы не найдены.";

  if (sortSpaceInfoEl) {
    sortSpaceInfoEl.textContent = `Общий размер копий: ${formatBytes(totalBytes)}`;
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
  setSortProgress(0, 1, "Анализ файлов...");

  const response = await window.assistantApi.startDuplicateSort();
  sortRunning = false;

  if (!response?.ok) {
    showSortSection("results");
    duplicateGroups = [];
    updateSortSummary();
    sortSummaryEl.textContent = `Ошибка сортировки: ${response?.error || "Неизвестная ошибка"}`;
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
    sortSummaryEl.textContent = `Ошибка удаления: ${response?.error || "Неизвестная ошибка"}`;
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
  sortSummaryEl.textContent += ` Удалено: ${deletedCount}.` + (failedCount ? ` Ошибок: ${failedCount}.` : "");
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
    text.textContent = meta.text || "ИИ: установка...";
    left.appendChild(text);

    const progress = document.createElement("div");
    progress.className = "ai-progress";
    const fill = document.createElement("div");
    fill.className = "ai-progress-fill";
    fill.style.width = `${meta.percent ?? 8}%`;
    progress.appendChild(fill);
    left.appendChild(progress);
  } else if (aiStatus.installed) {
    text.textContent = `ИИ установлен (${aiStatus.model || "model"})`;
    left.appendChild(text);
  } else {
    text.textContent = "ИИ не установлен";
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
    btn.textContent = "Удалить";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      await window.assistantApi.removeAi();
    });
  } else {
    btn.textContent = "Установить ИИ";
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
  document.documentElement.style.setProperty("--bg", `rgba(5, 5, 8, ${settings.opacity || 0.92})`);
  document.documentElement.style.setProperty("--text", "#f2f2f4");
  document.documentElement.style.setProperty("--muted", "#9aa2ad");
  document.documentElement.style.setProperty("--panel", "rgba(12, 14, 20, 0.7)");
  document.documentElement.style.setProperty("--border", "rgba(255, 255, 255, 0.08)");
}

async function runAiQuery(query) {
  aiHasAnswer = true;
  aiCreatedFile = null;
  renderCreatedFile();
  setHidden(aiResponseEl, false);
  updateWindowHeight();
  aiResponseEl.innerHTML = "<div class=\"ai-answer pending\">Думаю...</div>";

  const resp = await window.assistantApi.askAi(query, aiFiles);
  if (!resp?.ok) {
    aiResponseEl.innerHTML = `<div class=\"ai-answer error\">${escapeHtml(resp?.error || "Ошибка запроса")}</div>`;
    return;
  }

  const answer = resp.answer || "";
  aiResponseEl.innerHTML = `<div class=\"ai-answer\">${escapeHtml(answer).replace(/\n/g, "<br/>")}</div>`;

  const created = await window.assistantApi.createFileFromAi({ query, answer });
  if (created?.ok && created.path) {
    aiCreatedFile = created;
    renderCreatedFile();
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
    if (!query) {
      aiHasAnswer = false;
      aiResponseEl.innerHTML = "";
      aiCreatedFile = null;
      renderCreatedFile();
      setHidden(aiResponseEl, true);
      updateWindowHeight();
    }
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

  window.assistantApi.getIndexStatus().then((data) => {
    status = data || status;
    renderStatus();
  });

  window.assistantApi.getSettings().then((data) => {
    applySettings(data || settings);
    if (settings.rememberQuery) {
      const saved = localStorage.getItem("lastQuery");
      if (saved) {
        input.value = saved;
        input.dispatchEvent(new Event("input"));
      }
    }
  });

  if (window.assistantApi.getAiStatus) {
    window.assistantApi.getAiStatus().then((data) => {
      if (data && typeof data === "object") aiStatus = { ...aiStatus, ...data };
      renderAiRow();
    });
  }

  window.addEventListener("settings-updated", (event) => {
    applySettings(event.detail || settings);
    renderStatus();
  });

  window.addEventListener("ai-status", (event) => {
    aiStatus = { ...aiStatus, ...(event.detail || {}) };
    renderAiRow();
    renderMode();
    renderAiFiles();
  });

  window.addEventListener("ai-progress", (event) => {
    const progress = event.detail?.message || "";
    aiStatus = { ...aiStatus, progress };
    renderAiRow();
  });

  window.addEventListener("sort-progress", (event) => {
    const detail = event.detail || {};
    if (detail.type === "scan") {
      setSortProgress(detail.processed || 0, detail.total || 1, "Анализ файлов...");
    }
    if (detail.type === "done") {
      setSortProgress(detail.total || 1, detail.total || 1, "Завершено");
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

btnSend.addEventListener("click", async () => {
  const query = input.value.trim();
  if (!query || mode !== "ai") return;
  await runAiQuery(query);
});
