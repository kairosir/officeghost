const input = document.getElementById("query");
const resultsContainer = document.getElementById("results");
const statusEl = document.getElementById("status");
const btnToggle = document.getElementById("btn-toggle");

let results = [];
let activeIndex = 0;
let status = { state: "idle", scanned: 0 };
let searchTimer = null;
let settings = { roots: [], paused: false };
let currentQuery = "";

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

function highlight(text, query) {
  if (!text) return "";
  const safeText = escapeHtml(text);
  if (!query) return safeText;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escapedQuery, "gi");
  return safeText.replace(regex, (match) => `<span class="highlight">${match}</span>`);
}

function renderStatus() {
  if (status.state === "indexing") {
    statusEl.textContent = `Индексация... файлов: ${status.scanned}. Папки: ${status.roots?.join(", ") || "-"}`;
    btnToggle.textContent = "Обновить";
    return;
  }
  if (status.state === "ready") {
    statusEl.textContent = `Индекс готов. Файлов: ${status.fileCount || 0}. Папки: ${status.roots?.join(", ") || "-"}`;
    btnToggle.textContent = "Обновить";
    return;
  }
  if (status.state === "paused") {
    statusEl.textContent = "Индексация на паузе";
    btnToggle.textContent = "Обновить";
    return;
  }
  if (status.state === "error") {
    statusEl.textContent = "Ошибка индексации. Проверь логи.";
    btnToggle.textContent = "Обновить";
    return;
  }
  statusEl.textContent = "";
}

input.addEventListener("input", (event) => {
  const query = event.target.value.trim();
  currentQuery = query;
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
    settings = data || settings;
  });
});

window.addEventListener("blur", () => {
  input.value = "";
  results = [];
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
