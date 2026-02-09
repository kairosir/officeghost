const input = document.getElementById("query");
const resultsContainer = document.getElementById("results");
const statusEl = document.getElementById("status");
const btnToggle = document.getElementById("btn-toggle");
const btnSettings = document.getElementById("btn-settings");
const settingsPanel = document.getElementById("settings-panel");
const settingsClose = document.getElementById("settings-close");
const settingsSave = document.getElementById("settings-save");
const settingsHotkey = document.getElementById("settings-hotkey");
const settingsRemember = document.getElementById("settings-remember");
const settingsRememberPos = document.getElementById("settings-remember-pos");
const settingsOpacity = document.getElementById("settings-opacity");
const settingsInterval = document.getElementById("settings-interval");
const settingsMaxSize = document.getElementById("settings-maxsize");
const settingsNavItems = Array.from(document.querySelectorAll(".settings-nav-item"));
const settingsSections = Array.from(document.querySelectorAll(".settings-section"));

let results = [];
let activeIndex = 0;
let status = { state: "idle", scanned: 0, total: 0 };
let searchTimer = null;
let settings = { roots: [], paused: false, rememberQuery: true, rememberPos: true };
let currentQuery = "";
let lastQuery = "";

function renderResults() {
  resultsContainer.innerHTML = "";

  results.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "result" + (index === activeIndex ? " active" : "");
    row.innerHTML = `
      <div class="result-title">${highlight(item.title, currentQuery)}</div>
      <div class="result-path">${highlight(item.path, currentQuery)}</div>
      <div class="result-snippet">${highlight(item.snippet, currentQuery)}</div>
    `;
    row.addEventListener("click", () => openResult(index));
    resultsContainer.appendChild(row);
  });
}

function openResult(index) {
  const item = results[index];
  if (!item) return;
  window.assistantApi.openPath(item.path);
  window.assistantApi.hideWindow();
}

function updateActiveIndex(nextIndex) {
  if (!results.length) return;
  activeIndex = (nextIndex + results.length) % results.length;
  renderResults();
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeHotkey(value) {
  if (!value) return "";
  const parts = value
    .split(/\+|\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.length === 1 ? p.toUpperCase() : p));
  const uniq = [];
  for (const p of parts) {
    if (!uniq.includes(p)) uniq.push(p);
  }
  return uniq.join("+");
}

function highlight(text, query = "") {
  if (!text) return "";
  const safeText = escapeHtml(text);
  if (!query) return safeText;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escapedQuery, "gi");
  return safeText.replace(regex, (match) => `<span class="highlight">${match}</span>`);
}

function renderStatus() {
  const byExt = status.byExt || {};
  const scannedByExt = status.scannedByExt || {};
  const parts = Object.keys(byExt).sort().map((ext) => {
    const total = byExt[ext] || 0;
    const done = scannedByExt[ext] || 0;
    return `${ext}: ${done}/${total}`;
  });
  const summary = parts.length ? ` | ${parts.join("  ")}` : "";

  if (status.state === "indexing") {
    statusEl.textContent = `Индексация... ${status.scanned}/${status.total || "?"}${summary}`;
    btnToggle.textContent = "Обновить";
    return;
  }
  if (status.state === "ready") {
    statusEl.textContent = `Индекс готов. Файлов: ${status.fileCount || 0}${summary}`;
    btnToggle.textContent = "Обновить";
    return;
  }
  if (status.state === "paused") {
    statusEl.textContent = "Индексация на паузе";
    btnToggle.textContent = "Обновить";
    return;
  }
  if (status.state === "error") {
    const err = status.lastError ? `Ошибка индексации: ${status.lastError}` : "Ошибка индексации. Проверь логи.";
    statusEl.textContent = err;
    btnToggle.textContent = "Обновить";
    return;
  }
  statusEl.textContent = "";
}

function applySettings(newSettings) {
  settings = newSettings || settings;
  document.body.dataset.theme = "dark";
  document.documentElement.style.setProperty("--bg", `rgba(5, 5, 8, ${settings.opacity || 0.92})`);
  document.documentElement.style.setProperty("--text", "#f2f2f4");
  document.documentElement.style.setProperty("--muted", "#9aa2ad");
  document.documentElement.style.setProperty("--panel", "rgba(12, 14, 20, 0.7)");
  document.documentElement.style.setProperty("--border", "rgba(255, 255, 255, 0.08)");
  const opacityRow = document.getElementById("settings-opacity-row");
  if (opacityRow) opacityRow.style.display = "flex";
  settingsHotkey.value = normalizeHotkey(settings.hotkey || "CommandOrControl+1");
  settingsRemember.checked = !!settings.rememberQuery;
  settingsRememberPos.checked = settings.rememberPos !== false;
  if (settingsOpacity) settingsOpacity.value = settings.opacity || 0.92;
  if (settingsInterval) settingsInterval.value = settings.indexIntervalSec || 60;
  if (settingsMaxSize) settingsMaxSize.value = settings.maxFileSizeMb || 20;
}

function activateSection(id) {
  settingsNavItems.forEach((btn) => btn.classList.toggle("active", btn.dataset.section === id));
  settingsSections.forEach((section) => {
    section.classList.toggle("active", section.dataset.section === id);
  });
}

settingsNavItems.forEach((btn) => {
  btn.addEventListener("click", () => activateSection(btn.dataset.section));
});

input.addEventListener("input", (event) => {
  const query = event.target.value.trim();
  currentQuery = query;
  lastQuery = query;
  if (settings.rememberQuery) {
    localStorage.setItem("lastQuery", lastQuery);
  }
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    if (!query) {
      results = [];
      activeIndex = 0;
      renderResults();
      renderStatus();
      return;
    }

    results = await window.assistantApi.search(query);
    activeIndex = 0;
    renderResults();
    renderStatus();
  }, 200);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    updateActiveIndex(activeIndex + 1);
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    updateActiveIndex(activeIndex - 1);
  }
  if (event.key === "Enter") {
    event.preventDefault();
    openResult(activeIndex);
  }
  if (event.key === "Escape") {
    event.preventDefault();
    window.assistantApi.hideWindow();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.assistantApi.hideWindow();
  }
});

window.addEventListener("focus-input", () => {
  input.focus();
  input.select();
});

window.addEventListener("DOMContentLoaded", () => {
  input.focus();
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

  window.addEventListener("settings-updated", (event) => {
    applySettings(event.detail || settings);
  });

  activateSection("general");
});

window.addEventListener("blur", () => {
  if (!settings.rememberQuery) {
    input.value = "";
    results = [];
  } else {
    input.value = lastQuery;
  }
  currentQuery = "";
  renderResults();
  renderStatus();
});

window.addEventListener("message", (event) => {
  if (event.data?.type === "index-status") {
    status = event.data.payload || status;
    renderStatus();
  }
});

window.addEventListener("index-status", (event) => {
  status = event.detail || status;
  renderStatus();
});

window.addEventListener("index-status-update", (event) => {
  status = event.detail || status;
  renderStatus();
});

btnToggle.addEventListener("click", async () => {
  const updated = await window.assistantApi.refreshIndex();
  status = updated || status;
  renderStatus();
});

btnSettings.addEventListener("click", () => {
  settingsPanel.classList.add("show");
});

settingsClose.addEventListener("click", () => {
  settingsPanel.classList.remove("show");
});

settingsSave.addEventListener("click", async () => {
  const partial = {
    hotkey: normalizeHotkey(settingsHotkey.value.trim()) || "CommandOrControl+1",
    rememberQuery: !!settingsRemember.checked,
    rememberPos: !!settingsRememberPos.checked,
    opacity: settingsOpacity ? parseFloat(settingsOpacity.value) : 0.92,
    indexIntervalSec: settingsInterval ? parseInt(settingsInterval.value || "60", 10) : 60,
    maxFileSizeMb: settingsMaxSize ? parseInt(settingsMaxSize.value || "20", 10) : 20
  };
  if (!settingsRememberPos.checked) {
    partial.windowPos = null;
  }
  const updated = await window.assistantApi.updateSettings(partial);
  applySettings(updated || settings);
  settingsPanel.classList.remove("show");
});
if (settingsOpacity) {
  settingsOpacity.addEventListener("input", () => {
    const value = parseFloat(settingsOpacity.value || "0.92");
    document.documentElement.style.setProperty("--bg", `rgba(5, 5, 8, ${value})`);
  });
  settingsOpacity.addEventListener("change", async () => {
    const value = parseFloat(settingsOpacity.value || "0.92");
    const updated = await window.assistantApi.updateSettings({ opacity: value });
    applySettings(updated || settings);
  });
}


settingsHotkey.addEventListener("input", () => {
  const formatted = normalizeHotkey(settingsHotkey.value);
  if (formatted !== settingsHotkey.value) {
    settingsHotkey.value = formatted;
  }
});
