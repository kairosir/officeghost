const settingsHotkey = document.getElementById("settings-hotkey");
const settingsRemember = document.getElementById("settings-remember");
const settingsRememberPos = document.getElementById("settings-remember-pos");
const settingsInterval = document.getElementById("settings-interval");
const settingsMaxSize = document.getElementById("settings-maxsize");
const settingsUnlimited = document.getElementById("settings-unlimited");
const settingsAiModel = document.getElementById("settings-ai-model");
const aiRecommended = document.getElementById("ai-recommended");
const systemProfile = document.getElementById("system-profile");
const licenseEmail = document.getElementById("license-email");
const licenseKey = document.getElementById("license-key");
const licenseStatus = document.getElementById("license-status");
const reportPathInput = document.getElementById("report-path");
const reportOpenBtn = document.getElementById("report-open");
const settingsSave = document.getElementById("settings-save");
const settingsClose = document.getElementById("settings-close");
const contactEmailBtn = document.getElementById("contact-email");
const contactDiscordBtn = document.getElementById("contact-discord");
const settingsNavItems = Array.from(document.querySelectorAll(".settings-nav-item"));
const settingsSections = Array.from(document.querySelectorAll(".settings-section"));

let hotkeyCaptureMode = false;
let currentHotkey = "CommandOrControl+1";

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
  if (!main) return { ok: false, message: "Нажми букву, цифру или служебную клавишу" };

  const mods = [];
  if (event.ctrlKey || event.metaKey) mods.push("CommandOrControl");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");

  if (mods.length > 1) {
    return { ok: false, message: "Допускается только одна модификаторная клавиша" };
  }

  if (mods.length === 0 && main.isDigit && !main.isNumpadDigit) {
    return { ok: false, message: "Одиночная цифра только с numpad" };
  }

  const parts = mods.length ? [mods[0], main.token] : [main.token];
  return { ok: true, value: parts.join("+") };
}

function activateSection(id) {
  settingsNavItems.forEach((btn) => btn.classList.toggle("active", btn.dataset.section === id));
  settingsSections.forEach((section) => section.classList.toggle("active", section.dataset.section === id));
}

settingsNavItems.forEach((btn) => {
  btn.addEventListener("click", () => activateSection(btn.dataset.section));
});

Promise.all([
  window.assistantApi.getSettings(),
  window.assistantApi.getSystemProfile ? window.assistantApi.getSystemProfile() : Promise.resolve(null),
  window.assistantApi.getRecommendedModel ? window.assistantApi.getRecommendedModel() : Promise.resolve(null)
]).then(([data, profile, recommended]) => {
  const settings = data || {};
  currentHotkey = normalizeHotkey(settings.hotkey || "CommandOrControl+1");
  settingsHotkey.value = currentHotkey;
  settingsRemember.checked = !!settings.rememberQuery;
  settingsRememberPos.checked = settings.rememberPos !== false;
  if (settingsInterval) settingsInterval.value = settings.indexIntervalSec || 60;
  if (settingsMaxSize) settingsMaxSize.value = settings.maxFileSizeMb || 20;
  if (settingsUnlimited) settingsUnlimited.checked = !!settings.unlimitedIndexing;
  if (settingsAiModel) settingsAiModel.value = settings.aiModel || recommended || "qwen2.5:1.5b";
  if (licenseEmail) licenseEmail.value = settings.licenseEmail || "";
  if (licenseKey) licenseKey.value = settings.licenseKey || "";
  if (licenseStatus) licenseStatus.value = settings.licenseStatus || "FREE";

  if (profile && systemProfile) {
    systemProfile.value = `${profile.platform}/${profile.arch}, RAM ${profile.totalMemGb} GB, CPU ${profile.cpuCount}`;
  }

  if (aiRecommended) {
    aiRecommended.value = recommended || "qwen2.5:1.5b";
  }
});

window.assistantApi.getReportPath().then((p) => {
  if (reportPathInput) reportPathInput.value = p;
});

if (reportOpenBtn) {
  reportOpenBtn.addEventListener("click", () => window.assistantApi.openReport());
}

settingsSave.addEventListener("click", async () => {
  const partial = {
    hotkey: normalizeHotkey(currentHotkey) || "CommandOrControl+1",
    rememberQuery: !!settingsRemember.checked,
    rememberPos: !!settingsRememberPos.checked,
    indexIntervalSec: settingsInterval ? parseInt(settingsInterval.value || "60", 10) : 60,
    maxFileSizeMb: settingsMaxSize ? parseInt(settingsMaxSize.value || "20", 10) : 20,
    unlimitedIndexing: settingsUnlimited ? !!settingsUnlimited.checked : false,
    aiModel: settingsAiModel ? settingsAiModel.value : "qwen2.5:1.5b",
    licenseEmail: licenseEmail ? licenseEmail.value.trim() : "",
    licenseKey: licenseKey ? licenseKey.value.trim() : "",
    licenseStatus: licenseStatus ? licenseStatus.value.trim() || "FREE" : "FREE"
  };

  if (!settingsRememberPos.checked) partial.windowPos = null;
  await window.assistantApi.updateSettings(partial);
});

settingsHotkey.addEventListener("focus", () => {
  hotkeyCaptureMode = true;
  settingsHotkey.value = "Нажмите клавишу...";
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
    window.assistantApi.openPath("mailto:support@officeghost.app");
  });
}

if (contactDiscordBtn) {
  contactDiscordBtn.addEventListener("click", () => {
    window.assistantApi.openPath("https://discord.gg/officeghost");
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
