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
const toolbarStartBtn = document.getElementById("toolbar-start");
const windowCloseBtn = document.getElementById("window-close");

let groups = [];
let sortRunning = false;
let searchQuery = "";
let freedBytes = 0;
let selectedPaths = new Set();

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
  const freed = freedBytes > 0 ? ` (-${formatBytes(freedBytes)} освобождено)` : "";

  summaryEl.textContent = groupCount
    ? `Групп: ${groupCount}. Копий: ${copyCount}. Общий размер всех файлов: ${formatBytes(allFilesBytes)}. Размер копий: ${formatBytes(copiesBytes)}${freed}`
    : "Похожие файлы не найдены.";
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
    tbodyEl.innerHTML = '<div class="empty">Ничего не найдено по текущему фильтру.</div>';
    updateDeleteButtonsState();
    return;
  }

  let html = "";
  list.forEach((group, groupIdx) => {
    html += `<div class="group"><div class="group-title">Группа ${groupIdx + 1}: ${escapeHtml(group.reason || "Похожие файлы")}</div>`;

    html += rowHtml({
      checkbox: false,
      name: group.original?.name || group.original?.path || "",
      path: group.original?.path || "",
      match: "Оригинал",
      size: Number(group.original?.size || 0),
      folderPath: group.original?.path || "",
      isOriginal: true
    });

    (group.copies || []).forEach((copy, idx) => {
      const copyPath = copy.path || "";
      html += rowHtml({
        checkbox: true,
        id: `c-${groupIdx}-${idx}`,
        name: copy.name || copy.path || "",
        path: copyPath,
        match: group.reason || "Похожие",
        size: Number(copy.size || 0),
        folderPath: copyPath,
        checked: selectedPaths.has(copyPath)
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
    summaryEl.textContent = `Ошибка удаления: ${resp?.error || "Неизвестная ошибка"}`;
    return;
  }

  trackFreedSpace(resp.deleted || []);
  applyDeleted(resp.deleted || []);
  updateSummary();
  renderRows();

  const failed = (resp.failed || []).length;
  if (failed) {
    summaryEl.textContent += ` Ошибок: ${failed}.`;
  }
}

function setProgress(processed, total, label) {
  const t = Math.max(1, Number(total || 0));
  const p = Math.max(0, Number(processed || 0));
  const pct = Math.max(0, Math.min(100, Math.round((p / t) * 100)));
  progressTextEl.textContent = `${label} ${p}/${t}`;
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
  setSection("progress");
  setProgress(0, 1, "Анализ файлов...");

  const resp = await window.assistantApi.startDuplicateSort();
  sortRunning = false;

  setSection("results");
  if (!resp?.ok) {
    groups = [];
    selectedPaths = new Set();
    updateSummary();
    summaryEl.textContent = `Ошибка сортировки: ${resp?.error || "Неизвестная ошибка"}`;
    renderRows();
    return;
  }

  groups = Array.isArray(resp.groups) ? resp.groups : [];
  searchQuery = "";
  searchEl.value = "";
  freedBytes = 0;
  initSelectionAll();
  updateSummary();
  renderRows();
}

window.addEventListener("sort-progress", (event) => {
  const detail = event.detail || {};
  if (detail.type === "scan") setProgress(detail.processed || 0, detail.total || 1, "Анализ файлов...");
  if (detail.type === "done") setProgress(detail.total || 1, detail.total || 1, "Завершено");
});

window.addEventListener("sort-opened", () => {
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
  const ok = window.confirm(`Точно удалить все копии файлов? Будет удалено: ${all.length} шт.`);
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

toolbarStartBtn?.addEventListener("click", async () => {
  if (sortRunning) return;
  await startSort();
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
  initColumnResize();
  setSection("warning");

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
