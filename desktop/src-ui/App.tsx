import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bot, Check, ChevronDown, CircleUserRound, Clock3, Copy, Database, File, FileArchive, FilePlus2, Files, FolderOpen, History, Library, MessageSquareText, MoreHorizontal, PanelRightClose, Plus, RefreshCw, Search, Settings2, Sparkles, WandSparkles, Zap } from "lucide-react";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageAction, MessageActions, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputActionAddAttachments, PromptInputActionMenu, PromptInputActionMenuContent, PromptInputActionMenuTrigger, PromptInputBody, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from "@/components/ai-elements/prompt-input";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import { TooltipProvider } from "@/components/ui/tooltip";
import { askDocuments, createFileFromAnswer, getAiStatus, getIndexStatus, getSettings, openPath, refreshIndex, searchDocuments, updateSettings, type AiStatus, type IndexStatus, type SearchResult, type Settings } from "@/lib/officeghost";

type View = "chat" | "library" | "automations";
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; sources?: SearchResult[]; query?: string };
const initialMessages: ChatMessage[] = [{ id: "welcome", role: "assistant", content: "Привет! Я OfficeGhost. Могу найти информацию во всех ваших документах, сравнить несколько файлов, подготовить сводку или создать новый документ." }];
const recentChats = ["План запуска продукта", "Сводка по договорам", "Расходы за третий квартал"];

function Brand() {
  return <div className="brand"><img src="/officeghost-mark.png" alt="" /><span>OfficeGhost</span></div>;
}

function StatusDot({ active = true }: { active?: boolean }) {
  return <span className={active ? "status-dot" : "status-dot status-dot--muted"} />;
}

function Sidebar({ view, onView, onNewChat }: { view: View; onView: (view: View) => void; onNewChat: () => void }) {
  return <aside className="sidebar">
    <div className="sidebar-top" data-tauri-drag-region><Brand /><button className="icon-button" aria-label="Настройки"><Settings2 size={17} /></button></div>
    <button className="new-chat" onClick={onNewChat}><Plus size={17} />Новый чат<span>⌘ N</span></button>
    <nav className="primary-nav" aria-label="Основная навигация">
      <button className={view === "chat" ? "active" : ""} onClick={() => onView("chat")}><MessageSquareText size={17} />Чат</button>
      <button className={view === "library" ? "active" : ""} onClick={() => onView("library")}><Library size={17} />Библиотека<span className="nav-badge">2.8K</span></button>
      <button className={view === "automations" ? "active" : ""} onClick={() => onView("automations")}><Zap size={17} />Автоматизации</button>
    </nav>
    <div className="sidebar-section"><div className="sidebar-label"><span>Недавние</span><History size={14} /></div>
      {recentChats.map((chat) => <button className="recent-chat" key={chat} onClick={() => onView("chat")}><span>{chat}</span><MoreHorizontal size={15} /></button>)}
    </div>
    <div className="sidebar-spacer" />
    <div className="local-card"><div className="local-icon"><Database size={17} /></div><div><strong>Работает локально</strong><span>Данные остаются на устройстве</span></div><Check size={15} className="local-check" /></div>
    <button className="profile"><CircleUserRound size={22} /><span><strong>Личное пространство</strong><small>Бесплатный план</small></span><ChevronDown size={15} /></button>
  </aside>;
}

function DocumentIcon({ title }: { title: string }) {
  const ext = title.split(".").pop()?.toUpperCase() || "FILE";
  return <div className={`doc-icon doc-icon--${ext.toLowerCase()}`}><File size={18} /><span>{ext}</span></div>;
}

function SourcePanel({ sources, indexStatus, onRefresh }: { sources: SearchResult[]; indexStatus: IndexStatus; onRefresh: () => void }) {
  const docs = sources.length ? sources : [
    { title: "Стратегия продукта 2026.pdf", path: "", snippet: "Основные цели и приоритеты продукта" },
    { title: "Итоги встречи с командой.docx", path: "", snippet: "Решения, сроки и ответственные" },
    { title: "Бюджет Q3.xlsx", path: "", snippet: "Плановые и фактические расходы" },
  ];
  const count = indexStatus.fileCount || indexStatus.total || 0;
  return <aside className="source-panel">
    <div className="source-heading"><div><span>Контекст</span><strong>{docs.length} источника</strong></div><button className="icon-button"><PanelRightClose size={17} /></button></div>
    <div className="context-scope"><div className="scope-icon"><Files size={18} /></div><div><strong>Все документы</strong><span>{count ? `${count.toLocaleString("ru-RU")} файлов` : "Локальная библиотека"}</span></div><ChevronDown size={15} /></div>
    <div className="panel-label">Использовано в ответе</div>
    <div className="source-list">{docs.slice(0, 5).map((doc, index) => <button className="source-card" key={`${doc.title}-${index}`} onClick={() => doc.path && openPath(doc.path)}><DocumentIcon title={doc.title} /><span><strong>{doc.title}</strong><small>{doc.snippet || "Документ из локальной библиотеки"}</small></span><ArrowUpRight size={15} /></button>)}</div>
    <div className="source-spacer" />
    <div className="index-card"><div className="index-row"><span><StatusDot active={indexStatus.state !== "error"} />Индекс актуален</span><button onClick={onRefresh}><RefreshCw size={14} /></button></div><div className="progress"><span /></div><p>{count ? `${count.toLocaleString("ru-RU")} документов доступны для поиска` : "Документы готовы к локальному поиску"}</p></div>
  </aside>;
}

function ChatView({ indexStatus, aiStatus, onIndexStatus }: { indexStatus: IndexStatus; aiStatus: AiStatus; onIndexStatus: (status: IndexStatus) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [status, setStatus] = useState<"ready" | "submitted" | "error">("ready");
  const sources = [...messages].reverse().find((message) => message.sources?.length)?.sources ?? [];

  const submit = async ({ text }: { text: string }) => {
    const query = text.trim();
    if (!query || status === "submitted") return;
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content: query }]);
    setStatus("submitted");
    try {
      const [answer, found] = await Promise.all([askDocuments(query), searchDocuments(query)]);
      if (!answer.ok) throw new Error(answer.error || "Не удалось получить ответ");
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: answer.answer || "Ответ не получен.", sources: found.slice(0, 5), query }]);
      setStatus("ready");
    } catch (error) {
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: `Не удалось ответить: ${error instanceof Error ? error.message : "неизвестная ошибка"}` }]);
      setStatus("error");
    }
  };

  const handleCreate = async (message: ChatMessage) => {
    if (!message.query) return;
    const result = await createFileFromAnswer(message.query, message.content);
    if (result.ok && result.path) await openPath(result.path);
  };

  return <div className="workspace">
    <main className="chat-main">
      <header className="chat-header" data-tauri-drag-region><div><h1>Чат с документами</h1><p><StatusDot active={aiStatus.installed} />{aiStatus.installed ? `Локальная модель · ${aiStatus.model}` : "Локальная модель не установлена"}</p></div><button className="context-button"><Files size={16} />Все документы<ChevronDown size={14} /></button></header>
      <Conversation className="conversation"><ConversationContent className="conversation-content">
        <div className="chat-intro"><div className="ghost-orb"><img src="/officeghost-mark.png" alt="" /></div><h2>Что найдём в документах?</h2><p>Спросите о содержимом файлов или поручите создать новый документ.</p></div>
        {messages.map((message) => <Message from={message.role} key={message.id} className="chat-message">
          <MessageContent className={message.role === "assistant" ? "assistant-content" : "user-content"}>
            {message.role === "assistant" ? <MessageResponse>{message.content}</MessageResponse> : message.content}
            {!!message.sources?.length && <Sources><SourcesTrigger count={message.sources.length}>Использовано источников: {message.sources.length}<ChevronDown size={14} /></SourcesTrigger><SourcesContent>{message.sources.map((source) => <Source href="#" title={source.title} key={source.path} onClick={(event) => { event.preventDefault(); openPath(source.path); }} />)}</SourcesContent></Sources>}
          </MessageContent>
          {message.role === "assistant" && message.id !== "welcome" && <MessageActions className="message-actions"><MessageAction tooltip="Копировать" onClick={() => navigator.clipboard.writeText(message.content)}><Copy size={14} /></MessageAction><MessageAction tooltip="Создать файл" onClick={() => handleCreate(message)}><FilePlus2 size={14} /></MessageAction></MessageActions>}
        </Message>)}
      </ConversationContent><ConversationScrollButton /></Conversation>
      <div className="composer-wrap"><PromptInput onSubmit={submit} accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.md" multiple className="composer"><PromptInputBody><PromptInputTextarea placeholder="Спросите что-нибудь о своих документах…" /></PromptInputBody><PromptInputFooter><PromptInputTools><PromptInputActionMenu><PromptInputActionMenuTrigger tooltip="Добавить файл" /><PromptInputActionMenuContent><PromptInputActionAddAttachments label="Добавить документ" /></PromptInputActionMenuContent></PromptInputActionMenu><span className="local-pill"><Sparkles size={13} />Локальный ИИ</span></PromptInputTools><PromptInputSubmit status={status} /></PromptInputFooter></PromptInput><p className="composer-note">OfficeGhost отвечает только на основе ваших локальных документов.</p></div>
    </main>
    <SourcePanel sources={sources} indexStatus={indexStatus} onRefresh={async () => onIndexStatus(await refreshIndex())} />
  </div>;
}

function LibraryView({ indexStatus, onIndexStatus }: { indexStatus: IndexStatus; onIndexStatus: (status: IndexStatus) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const runSearch = async () => { setLoading(true); setResults(await searchDocuments(query)); setLoading(false); };
  useEffect(() => { searchDocuments("").then(setResults); }, []);
  return <main className="page-main">
    <header className="page-header" data-tauri-drag-region><div><span className="eyebrow">Локальная библиотека</span><h1>Ваши документы</h1><p>OfficeGhost индексирует содержимое файлов и находит нужное по смыслу.</p></div><button className="primary-button" onClick={async () => onIndexStatus(await refreshIndex())}><RefreshCw size={16} />Обновить индекс</button></header>
    <section className="stats-row"><div className="stat-card"><div><Files size={18} /></div><span><strong>{(indexStatus.fileCount || indexStatus.total || 0).toLocaleString("ru-RU")}</strong><small>Документов в индексе</small></span></div><div className="stat-card"><div><Check size={18} /></div><span><strong>5 форматов</strong><small>PDF, DOCX, XLSX, TXT, MD</small></span></div><div className="stat-card"><div><Clock3 size={18} /></div><span><strong>Автоматически</strong><small>Следим за изменениями</small></span></div></section>
    <section className="library-card"><div className="library-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && runSearch()} placeholder="Найти документ или фрагмент текста" /></div><button onClick={runSearch}>{loading ? <RefreshCw className="spin" size={16} /> : <Search size={16} />}Найти</button></div><div className="file-table-head"><span>Документ</span><span>Найденный фрагмент</span><span /></div><div className="file-table">
      {results.map((doc, index) => <button key={`${doc.path}-${index}`} onClick={() => openPath(doc.path)}><DocumentIcon title={doc.title} /><span className="file-name"><strong>{doc.title}</strong><small>{doc.path}</small></span><span className="file-snippet">{doc.snippet || "Содержимое готово к поиску"}</span><ArrowUpRight size={16} /></button>)}
      {!results.length && <div className="empty-state"><FileArchive size={28} /><strong>Ничего не найдено</strong><span>Попробуйте изменить запрос или обновить индекс.</span></div>}
    </div></section>
  </main>;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return <button className={`toggle ${checked ? "on" : ""}`} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><span /></button>;
}

function AutomationsView({ settings, onSettings }: { settings: Settings; onSettings: (settings: Settings) => void }) {
  const patchSetting = async (partial: Settings) => onSettings(await updateSettings(partial));
  return <main className="page-main automations-page">
    <header className="page-header" data-tauri-drag-region><div><span className="eyebrow">Работает в фоне</span><h1>Автоматизации</h1><p>Меньше рутины: OfficeGhost сам поддерживает библиотеку в порядке.</p></div><button className="primary-button"><Plus size={16} />Новый сценарий</button></header>
    <section className="automation-grid">
      <article className="automation-card featured"><div className="automation-icon"><RefreshCw size={20} /></div><div className="automation-title"><span><StatusDot />Активно</span><h2>Обновлять индекс</h2><p>Находит новые и изменённые документы каждые {settings.scheduleMinutes || 30} минут.</p></div><Toggle checked={settings.scheduleEnabled !== false} onChange={(value) => patchSetting({ scheduleEnabled: value })} /><div className="automation-meta"><Clock3 size={15} />Следующий запуск через 18 минут</div></article>
      <article className="automation-card"><div className="automation-icon purple"><FileArchive size={20} /></div><div className="automation-title"><span>Готово к настройке</span><h2>Разбирать загрузки</h2><p>Раскладывать новые файлы по папкам на основе названия и содержимого.</p></div><Toggle checked={false} onChange={() => {}} /><div className="automation-meta"><FolderOpen size={15} />Папка «Загрузки»</div></article>
      <article className="automation-card"><div className="automation-icon orange"><WandSparkles size={20} /></div><div className="automation-title"><span>Готово к настройке</span><h2>Еженедельная сводка</h2><p>Собирать изменения в выбранных документах в один короткий отчёт.</p></div><Toggle checked={false} onChange={() => {}} /><div className="automation-meta"><Clock3 size={15} />Каждый понедельник, 09:00</div></article>
    </section>
    <section className="shortcut-card"><div className="shortcut-icon"><Bot size={22} /></div><div><span className="eyebrow">Быстрый доступ</span><h2>OfficeGhost всегда под рукой</h2><p>Откройте компактный поиск поверх любого приложения и задайте вопрос своим документам.</p></div><kbd>⌘ Space</kbd></section>
  </main>;
}

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [chatKey, setChatKey] = useState(0);
  const [indexStatus, setIndexStatus] = useState<IndexStatus>({ state: "idle", scanned: 0, total: 0, fileCount: 0 });
  const [aiStatus, setAiStatus] = useState<AiStatus>({ installed: false, installing: false, model: "qwen2.5:3b" });
  const [settings, setSettings] = useState<Settings>({ scheduleEnabled: true, scheduleMinutes: 30 });
  useEffect(() => { Promise.all([getIndexStatus(), getAiStatus(), getSettings()]).then(([index, ai, nextSettings]) => { setIndexStatus(index); setAiStatus(ai); setSettings(nextSettings); }); }, []);
  const content = useMemo(() => {
    if (view === "library") return <LibraryView indexStatus={indexStatus} onIndexStatus={setIndexStatus} />;
    if (view === "automations") return <AutomationsView settings={settings} onSettings={setSettings} />;
    return <ChatView key={chatKey} indexStatus={indexStatus} aiStatus={aiStatus} onIndexStatus={setIndexStatus} />;
  }, [view, chatKey, indexStatus, aiStatus, settings]);
  return <TooltipProvider><div className="app-shell"><Sidebar view={view} onView={setView} onNewChat={() => { setChatKey((key) => key + 1); setView("chat"); }} />{content}</div></TooltipProvider>;
}
