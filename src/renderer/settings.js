const settingsHotkey = document.getElementById("settings-hotkey");
const settingsRemember = document.getElementById("settings-remember");
const settingsRememberPos = document.getElementById("settings-remember-pos");
const settingsInterval = document.getElementById("settings-interval");
const settingsMaxSize = document.getElementById("settings-maxsize");
const settingsUnlimited = document.getElementById("settings-unlimited");
const settingsScheduleEnabled = document.getElementById("settings-schedule-enabled");
const settingsScheduleMinutes = document.getElementById("settings-schedule-minutes");
const settingsAiModel = document.getElementById("settings-ai-model");
const settingsLanguage = document.getElementById("settings-language");
const aiRecommended = document.getElementById("ai-recommended");
const systemProfile = document.getElementById("system-profile");
const reportPathInput = document.getElementById("report-path");
const reportOpenBtn = document.getElementById("report-open");
const settingsSave = document.getElementById("settings-save");
const settingsClose = document.getElementById("settings-close");
const contactEmailBtn = document.getElementById("contact-email");
const settingsNavItems = Array.from(document.querySelectorAll(".settings-nav-item"));
const settingsSections = Array.from(document.querySelectorAll(".settings-section"));

let hotkeyCaptureMode = false;
let currentHotkey = "CommandOrControl+1";
let currentLanguage = "ru";

const I18N = {
  ru: {
    title: "Настройки",
    navTitle: "Разделы",
    navGeneral: "Общее",
    navHotkeys: "Горячие клавиши",
    navBehavior: "Индексация",
    navAi: "ИИ",
    navContacts: "Контакты",
    labelLanguage: "Язык интерфейса",
    labelRemember: "Запоминать последний поиск",
    labelRememberPos: "Запоминать позицию окна",
    labelHotkey: "Горячая клавиша",
    hintHotkey: "Одна клавиша или 1 модификатор + клавиша. Одиночная цифра только с numpad.",
    labelReport: "Отчет индексации",
    open: "Открыть",
    labelInterval: "Интервал авто‑индексации (сек)",
    labelScheduleEnabled: "Запланированная индексация",
    labelScheduleMinutes: "Период плановой индексации",
    schedule15: "Каждые 15 минут",
    schedule30: "Каждые 30 минут",
    schedule60: "Каждый 1 час",
    schedule180: "Каждые 3 часа",
    schedule360: "Каждые 6 часов",
    schedule720: "Каждые 12 часов",
    schedule1440: "Каждые 24 часа",
    scheduleHint: "Во время плановой индексации ассистент продолжает работать по последнему проиндексированному набору файлов.",
    labelMaxSize: "Макс. размер файла (MB)",
    labelUnlimited: "Без лимита индексации",
    labelAiRecommended: "Рекомендуемая модель",
    labelAiModel: "Текущая модель",
    labelSystemProfile: "Профиль устройства",
    hintAiLocal: "Локальный режим: ответы строятся только по проиндексированным файлам и вложениям.",
    labelContacts: "Связаться с нами",
    hintContacts: "Нажми на иконку, чтобы открыть сообщение.",
    save: "Сохранить",
    close: "Закрыть"
  },
  en: {
    title: "Settings",
    navTitle: "Sections",
    navGeneral: "General",
    navHotkeys: "Hotkeys",
    navBehavior: "Indexing",
    navAi: "AI",
    navContacts: "Contacts",
    labelLanguage: "Interface language",
    labelRemember: "Remember last search",
    labelRememberPos: "Remember window position",
    labelHotkey: "Hotkey",
    hintHotkey: "Single key or 1 modifier + key. Standalone digit is allowed only from numpad.",
    labelReport: "Index report",
    open: "Open",
    labelInterval: "Auto-index interval (sec)",
    labelScheduleEnabled: "Scheduled indexing",
    labelScheduleMinutes: "Scheduled indexing period",
    schedule15: "Every 15 minutes",
    schedule30: "Every 30 minutes",
    schedule60: "Every 1 hour",
    schedule180: "Every 3 hours",
    schedule360: "Every 6 hours",
    schedule720: "Every 12 hours",
    schedule1440: "Every 24 hours",
    scheduleHint: "During scheduled indexing, the assistant remains available using the last indexed dataset.",
    labelMaxSize: "Max file size (MB)",
    labelUnlimited: "Unlimited indexing",
    labelAiRecommended: "Recommended model",
    labelAiModel: "Current model",
    labelSystemProfile: "System profile",
    hintAiLocal: "Local mode: answers are built only from indexed files and attachments.",
    labelContacts: "Contact us",
    hintContacts: "Click the icon to open a message.",
    save: "Save",
    close: "Close"
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
  const map = {
    "settings-title": "title",
    "settings-nav-title": "navTitle",
    "nav-general": "navGeneral",
    "nav-hotkeys": "navHotkeys",
    "nav-behavior": "navBehavior",
    "nav-ai": "navAi",
    "nav-contacts": "navContacts",
    "label-language": "labelLanguage",
    "label-remember": "labelRemember",
    "label-remember-pos": "labelRememberPos",
    "label-hotkey": "labelHotkey",
    "hint-hotkey": "hintHotkey",
    "label-report": "labelReport",
    "label-interval": "labelInterval",
    "label-schedule-enabled": "labelScheduleEnabled",
    "label-schedule-minutes": "labelScheduleMinutes",
    "hint-schedule": "scheduleHint",
    "label-maxsize": "labelMaxSize",
    "label-unlimited": "labelUnlimited",
    "label-ai-recommended": "labelAiRecommended",
    "label-ai-model": "labelAiModel",
    "label-system-profile": "labelSystemProfile",
    "hint-ai-local": "hintAiLocal",
    "label-contacts": "labelContacts",
    "hint-contacts": "hintContacts"
  };

  Object.entries(map).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = t(key);
  });

  if (reportOpenBtn) {
    reportOpenBtn.textContent = t("open");
    reportOpenBtn.title = t("open");
  }
  if (settingsSave) settingsSave.textContent = t("save");
  if (settingsClose) settingsClose.title = t("close");
  if (settingsScheduleMinutes) {
    const labels = {
      "15": "schedule15",
      "30": "schedule30",
      "60": "schedule60",
      "180": "schedule180",
      "360": "schedule360",
      "720": "schedule720",
      "1440": "schedule1440"
    };
    Array.from(settingsScheduleMinutes.options).forEach((opt) => {
      const key = labels[String(opt.value)];
      if (key) opt.textContent = t(key);
    });
  }

  document.documentElement.lang = currentLanguage;
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

function keyToMainToken(event) {
  if (event.code.startsWith("Numpad") && /^Numpad[0-9]$/.test(event.code)) {
    return { token: event.code.replace("Numpad", "num"), isNumpadDigit: true, isDigit: true };
  }

  if (/^Digit[0-9]$/.test(event.code)) {
    return { token: event.code.replace("Digit", ""), isNumpadDigit: false, isDigit: true };
  }

  if (/^Key[A-Z]$/.test(event.code)) {
    return { token: event.code.replace("Key", ""), isNumpadDigit: false, isDigit: false };
  }

  if (event.key === " ") return { token: "Space", isNumpadDigit: false, isDigit: false };
  if (["Enter", "Tab", "Escape", "Backspace"].includes(event.key)) {
    return { token: event.key, isNumpadDigit: false, isDigit: false };
  }

  return null;
}

function buildAcceleratorFromEvent(event) {
  const main = keyToMainToken(event);
  if (!main) return { ok: false, message: currentLanguage === "en" ? "Press a letter, digit or control key" : "Нажми букву, цифру или служебную клавишу" };

  const mods = [];
  if (event.ctrlKey || event.metaKey) mods.push("CommandOrControl");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");

  if (mods.length > 1) {
    return { ok: false, message: currentLanguage === "en" ? "Only one modifier key is allowed" : "Допускается только одна модификаторная клавиша" };
  }

  if (mods.length === 0 && main.isDigit && !main.isNumpadDigit) {
    return { ok: false, message: currentLanguage === "en" ? "Standalone digit is allowed only from numpad" : "Одиночная цифра только с numpad" };
  }

  const parts = mods.length ? [mods[0], main.token] : [main.token];
  return { ok: true, value: parts.join("+") };
}

function activateSection(id) {
  settingsNavItems.forEach((btn) => btn.classList.toggle("active", btn.dataset.section === id));
  settingsSections.forEach((section) => section.classList.toggle("active", section.dataset.section === id));
  if (settingsSave) {
    settingsSave.style.display = id === "contacts" ? "none" : "inline-flex";
  }
}

settingsNavItems.forEach((btn) => {
  btn.addEventListener("click", () => activateSection(btn.dataset.section));
});

window.assistantApi.getSettings().then(async (data) => {
  const settings = data || {};
  const detected = detectDefaultLanguage();
  currentLanguage = settings.language === "en" || settings.language === "ru" ? settings.language : detected;
  applyI18n();

  if (!settings.language) {
    await window.assistantApi.updateSettings({ language: currentLanguage });
  }

  currentHotkey = normalizeHotkey(settings.hotkey || "CommandOrControl+1");
  settingsHotkey.value = currentHotkey;
  settingsRemember.checked = !!settings.rememberQuery;
  settingsRememberPos.checked = settings.rememberPos !== false;
  if (settingsInterval) settingsInterval.value = settings.indexIntervalSec || 60;
  if (settingsMaxSize) settingsMaxSize.value = settings.maxFileSizeMb || 20;
  if (settingsUnlimited) settingsUnlimited.checked = !!settings.unlimitedIndexing;
  if (settingsScheduleEnabled) settingsScheduleEnabled.checked = !!settings.scheduleEnabled;
  if (settingsScheduleMinutes) settingsScheduleMinutes.value = String(settings.scheduleMinutes || 60);
  if (settingsAiModel) settingsAiModel.value = settings.aiModel || "qwen2.5:1.5b";
  if (settingsLanguage) settingsLanguage.value = currentLanguage;

  if (settingsScheduleMinutes && settingsScheduleEnabled) {
    settingsScheduleMinutes.disabled = !settingsScheduleEnabled.checked;
  }
});

Promise.all([
  window.assistantApi.getSystemProfile ? window.assistantApi.getSystemProfile() : Promise.resolve(null),
  window.assistantApi.getRecommendedModel ? window.assistantApi.getRecommendedModel() : Promise.resolve(null)
]).then(([profile, recommended]) => {
  if (profile && systemProfile) {
    systemProfile.value = `${profile.platform}/${profile.arch}, RAM ${profile.totalMemGb} GB, CPU ${profile.cpuCount}`;
  }
  if (aiRecommended) {
    aiRecommended.value = recommended || "qwen2.5:1.5b";
  }
  if (settingsAiModel && recommended && !settingsAiModel.value) {
    settingsAiModel.value = recommended;
  }
});

window.assistantApi.getReportPath().then((p) => {
  if (reportPathInput) reportPathInput.value = p;
});

if (reportOpenBtn) {
  reportOpenBtn.addEventListener("click", () => window.assistantApi.openReport());
}

async function saveSettings() {
  const partial = {
    hotkey: normalizeHotkey(currentHotkey) || "CommandOrControl+1",
    rememberQuery: !!settingsRemember.checked,
    rememberPos: !!settingsRememberPos.checked,
    indexIntervalSec: settingsInterval ? parseInt(settingsInterval.value || "60", 10) : 60,
    maxFileSizeMb: settingsMaxSize ? parseInt(settingsMaxSize.value || "20", 10) : 20,
    unlimitedIndexing: settingsUnlimited ? !!settingsUnlimited.checked : false,
    scheduleEnabled: settingsScheduleEnabled ? !!settingsScheduleEnabled.checked : false,
    scheduleMinutes: settingsScheduleMinutes ? parseInt(settingsScheduleMinutes.value || "60", 10) : 60,
    aiModel: settingsAiModel ? settingsAiModel.value : "qwen2.5:1.5b",
    aiProvider: "local",
    language: settingsLanguage ? settingsLanguage.value : currentLanguage
  };

  if (!settingsRememberPos.checked) partial.windowPos = null;
  await window.assistantApi.updateSettings(partial);
}

settingsSave?.addEventListener("click", async () => {
  await saveSettings();
});

settingsLanguage?.addEventListener("change", async () => {
  currentLanguage = settingsLanguage.value === "ru" ? "ru" : "en";
  applyI18n();
  await saveSettings();
});

settingsHotkey.addEventListener("focus", () => {
  hotkeyCaptureMode = true;
  settingsHotkey.value = currentLanguage === "en" ? "Press keys..." : "Нажмите клавишу...";
});

settingsHotkey.addEventListener("blur", () => {
  hotkeyCaptureMode = false;
  settingsHotkey.value = currentHotkey;
});

settingsHotkey.addEventListener("keydown", (event) => {
  if (!hotkeyCaptureMode) return;
  event.preventDefault();

  if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;

  const built = buildAcceleratorFromEvent(event);
  if (!built.ok) {
    settingsHotkey.value = built.message;
    return;
  }

  currentHotkey = built.value;
  settingsHotkey.value = currentHotkey;
  settingsHotkey.blur();
});

if (contactEmailBtn) {
  contactEmailBtn.addEventListener("click", () => {
    window.assistantApi.openPath("mailto:arhey575@gmail.com?subject=OfficeGhost%20Support&body=Hello!%20I%20need%20help%20with%20OfficeGhost.%0A%0AIssue:%20");
  });
}

activateSection("general");

if (settingsClose) {
  settingsClose.addEventListener("click", () => {
    if (window.assistantApi.closeSettings) {
      window.assistantApi.closeSettings();
    } else {
      window.close();
    }
  });
}

settingsScheduleEnabled?.addEventListener("change", async () => {
  if (settingsScheduleMinutes) settingsScheduleMinutes.disabled = !settingsScheduleEnabled.checked;
  await saveSettings();
});

settingsScheduleMinutes?.addEventListener("change", async () => {
  await saveSettings();
});

settingsAiModel?.addEventListener("change", async () => {
  await saveSettings();
});
