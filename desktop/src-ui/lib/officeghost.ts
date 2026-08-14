import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type SearchResult = { title: string; path: string; snippet: string; score?: number };
export type IndexStatus = { state: string; scanned: number; total: number; fileCount: number; current?: string; lastError?: string; roots?: string[] };
export type AiStatus = { installed: boolean; installing: boolean; model: string; online?: boolean; provider?: string; progress?: string; error?: string };
export type Settings = { roots?: string[]; paused?: boolean; hotkey?: string; scheduleEnabled?: boolean; scheduleMinutes?: number; aiModel?: string };
export type HistoryMessage = { role: "user" | "assistant"; content: string };

const demoFiles: SearchResult[] = [
  { title: "Стратегия продукта 2026.pdf", path: "/Documents/OfficeGhost/Стратегия продукта 2026.pdf", snippet: "Приоритеты продукта: приватная работа с документами, быстрый локальный поиск и понятные автоматизации.", score: 3 },
  { title: "Итоги встречи с командой.docx", path: "/Documents/OfficeGhost/Итоги встречи с командой.docx", snippet: "Запуск закрытой беты запланирован после завершения индексации и проверки сценариев создания документов.", score: 2 },
  { title: "Бюджет Q3.xlsx", path: "/Documents/OfficeGhost/Бюджет Q3.xlsx", snippet: "Сводная таблица расходов, плановых закупок и операционного бюджета третьего квартала.", score: 1 },
];

const isTauri = () => "__TAURI_INTERNALS__" in window;
const call = <T,>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);

export async function getIndexStatus(): Promise<IndexStatus> {
  return isTauri() ? call("get_index_status") : { state: "done", scanned: 2847, total: 2847, fileCount: 2847 };
}

export async function getAiStatus(): Promise<AiStatus> {
  return isTauri() ? call("get_ai_status") : { installed: true, installing: false, model: "qwen2.5:3b" };
}

export async function getSettings(): Promise<Settings> {
  return isTauri() ? call("get_settings") : { paused: false, hotkey: "CommandOrControl+Space", scheduleEnabled: true, scheduleMinutes: 30 };
}

export async function updateSettings(partial: Settings): Promise<Settings> {
  return isTauri() ? call("update_settings", { partial }) : { ...(await getSettings()), ...partial };
}

export async function chooseIndexFolder(): Promise<Settings> {
  return isTauri() ? call("choose_index_folder") : getSettings();
}

export async function chooseChatFiles(): Promise<string[]> {
  return isTauri() ? call("choose_chat_files") : [];
}

export async function installAi(): Promise<AiStatus> {
  return isTauri() ? call("install_ai") : getAiStatus();
}

export async function subscribeIndexStatus(handler: (status: IndexStatus) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<IndexStatus>("index-status", (event) => handler(event.payload));
}

export async function subscribeAiStatus(handler: (status: AiStatus) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<AiStatus>("ai-status", (event) => handler(event.payload));
}

export async function searchDocuments(query: string): Promise<SearchResult[]> {
  if (isTauri()) return call("search", { query });
  const term = query.trim().toLowerCase();
  if (!term) return demoFiles;
  const matched = demoFiles.filter((file) => `${file.title} ${file.snippet}`.toLowerCase().includes(term));
  return matched.length ? matched : demoFiles.slice(0, 2);
}

export async function askDocuments(query: string, filePaths: string[] = [], history: HistoryMessage[] = [], useDocuments = true) {
  if (isTauri()) return call<{ ok: boolean; answer?: string; error?: string; provider?: string }>("ask_ai", { query, filePaths, history, useDocuments });
  await new Promise((resolve) => window.setTimeout(resolve, 850));
  return { ok: true, answer: "По материалам из вашей библиотеки, главный приоритет — запустить закрытую бету после проверки индексации и сценариев создания документов. Команда также выделила приватную локальную обработку и быстрый поиск как ключевые преимущества продукта.", provider: "preview" };
}

export async function refreshIndex(): Promise<IndexStatus> {
  return isTauri() ? call("refresh_index") : getIndexStatus();
}

export async function openPath(filePath: string) {
  if (isTauri()) await call("open_path", { filePath });
}

export async function createFileFromAnswer(query: string, answer: string) {
  if (!isTauri()) return { ok: true, path: "/Desktop/Новый документ.md" };
  return call<{ ok: boolean; path?: string; error?: string; skipped?: boolean }>("create_file_from_ai", { payload: { query, answer } });
}
