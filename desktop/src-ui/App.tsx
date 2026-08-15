import { Fragment, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowUpRight, Check, ChevronDown, ChevronRight, CircleUserRound, Clock3, Copy, Database, Download, ExternalLink, File, FileArchive, FilePlus2, Files, FolderOpen, Library, LogIn, LogOut, MessageSquareText, MonitorCheck, Paperclip, PanelRightClose, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, WandSparkles, X, Zap } from "lucide-react";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageAction, MessageActions, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputBody, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from "@/components/ai-elements/prompt-input";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import { TooltipProvider } from "@/components/ui/tooltip";
import { askDocuments, beginDesktopAuth, checkAppUpdate, chooseChatFiles, chooseIndexFolder, createFileFromAnswer, getAiStatus, getAppUpdateStatus, getDesktopAuth, getIndexStatus, getSettings, installAppUpdate, openPath, refreshIndex, searchDocuments, signOutDesktop, subscribeAiStatus, subscribeAppUpdateStatus, subscribeDesktopAuth, subscribeIndexStatus, updateSettings, type AiStatus, type DesktopAuthStatus, type HistoryMessage, type IndexStatus, type SearchResult, type Settings, type UpdateStatus } from "@/lib/officeghost";

type View = "chat" | "library" | "automations" | "account";
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; sources?: SearchResult[]; query?: string };
type ChatThread = { id: string; title: string; createdAt: number; messages: ChatMessage[] };

const CHAT_STORAGE = "officeghost.chats.v1";
const WELCOME_TEXT = "Привет! Я OfficeGhost. Могу общаться с вами, искать информацию в документах по вашей просьбе, делать сводки и создавать новые файлы.";
const welcomeMessage = (): ChatMessage => ({ id: crypto.randomUUID(), role: "assistant", content: WELCOME_TEXT });
const createThread = (): ChatThread => ({ id: crypto.randomUUID(), title: "Новый чат", createdAt: Date.now(), messages: [welcomeMessage()] });

function Brand() { return <div className="brand"><img src="/officeghost-mark.png" alt="" /><span>OfficeGhost</span></div>; }
function StatusDot({ active = true }: { active?: boolean }) { return <span className={active ? "status-dot" : "status-dot status-dot--muted"} />; }

function Sidebar({ view, documentCount, threads, activeThreadId, updateStatus, authStatus, onView, onNewChat, onOpenChat, onCheckUpdate, onInstallUpdate }: { view: View; documentCount: number; threads: ChatThread[]; activeThreadId: string; updateStatus: UpdateStatus; authStatus: DesktopAuthStatus; onView: (view: View) => void; onNewChat: () => void; onOpenChat: (id: string) => void; onCheckUpdate: () => void; onInstallUpdate: () => void }) {
  const [chatsOpen, setChatsOpen] = useState(true);
  return <aside className="sidebar">
    <div className="sidebar-top" data-tauri-drag-region><Brand /><button className="icon-button" aria-label="Настроить папки" onClick={() => onView("library")}><Settings2 size={17} /></button></div>
    <button className="new-chat" onClick={onNewChat}><Plus size={17} />Новый чат<span>⌘ N</span></button>
    <nav className="primary-nav" aria-label="Основная навигация">
      <button className={view === "chat" ? "active chat-nav" : "chat-nav"} onClick={() => { onView("chat"); setChatsOpen(true); }}><MessageSquareText size={17} />Чат<span className="chat-chevron" onClick={(event) => { event.stopPropagation(); setChatsOpen((value) => !value); }}>{chatsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span></button>
      {chatsOpen && <div className="chat-stack">{threads.map((thread) => <button key={thread.id} className={thread.id === activeThreadId && view === "chat" ? "recent-chat selected" : "recent-chat"} onClick={() => onOpenChat(thread.id)} title={thread.title}><span>{thread.title}</span></button>)}</div>}
      <button className={view === "library" ? "active" : ""} onClick={() => onView("library")}><Library size={17} />Библиотека{documentCount > 0 && <span className="nav-badge">{documentCount.toLocaleString("ru-RU")}</span>}</button>
      <button className={view === "automations" ? "active" : ""} onClick={() => onView("automations")}><Zap size={17} />Автоматизации</button>
    </nav>
    <div className="sidebar-spacer" />
    <div className="local-card"><div className="local-icon"><Database size={17} /></div><div><strong>Ваши файлы локальны</strong><span>По запросу передаётся только нужный контекст</span></div><Check size={15} className="local-check" /></div>
    <button className={`update-control update-control--${updateStatus.state}`} disabled={updateStatus.state === "checking" || updateStatus.downloading} onClick={updateStatus.available ? onInstallUpdate : onCheckUpdate} title={updateStatus.error || "Проверить наличие обновлений"}>{updateStatus.state === "checking" || updateStatus.downloading ? <RefreshCw className="spin" size={15} /> : updateStatus.available ? <Download size={15} /> : <RefreshCw size={15} />}<span><strong>{updateStatus.downloading ? `Загрузка ${updateStatus.progress || 0}%` : updateStatus.available ? `Обновить до ${updateStatus.version}` : updateStatus.state === "error" ? "Повторить проверку" : "Проверить обновления"}</strong><small>{updateStatus.state === "up-to-date" ? "Установлена последняя версия" : updateStatus.downloading ? "Не закрывайте OfficeGhost" : updateStatus.error || "Обновления устанавливаются безопасно"}</small></span></button>
    <button className={view === "account" ? "profile active" : "profile"} onClick={() => onView("account")}>
      {authStatus.profile?.imageUrl ? <img src={authStatus.profile.imageUrl} alt="" /> : <CircleUserRound size={22} />}
      <span><strong>{authStatus.profile?.name || "Личное пространство"}</strong><small>{authStatus.authenticated ? authStatus.profile?.email : "Войти в OfficeGhost"}</small></span><ChevronRight size={15} />
    </button>
  </aside>;
}

function DocumentIcon({ title }: { title: string }) {
  const ext = title.split(".").pop()?.toUpperCase() || "FILE";
  return <div className={`doc-icon doc-icon--${ext.toLowerCase()}`}><File size={18} /><span>{ext}</span></div>;
}

const SEARCH_COMMAND_WORDS = new Set(["найди", "найдите", "найти", "поищи", "поищите", "ищи", "ищите", "ищу", "поиск", "покажи", "покажите", "мне", "пожалуйста", "слово", "слова", "фразу", "фраза", "в", "во", "на", "по", "из", "с", "со", "файл", "файлы", "файле", "файлах", "документ", "документы", "документе", "документах", "find", "search", "show", "please", "for", "in", "my", "file", "files", "document", "documents"]);

function queryTerms(query: string) {
  return [...new Set((query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || []).filter((term) => term.length > 1 && !SEARCH_COMMAND_WORDS.has(term)))].sort((a, b) => b.length - a.length);
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const terms = queryTerms(query);
  if (!terms.length) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu");
  return <>{text.split(pattern).map((part, index) => terms.includes(part.toLowerCase()) ? <mark key={index}>{part}</mark> : <Fragment key={index}>{part}</Fragment>)}</>;
}

function SourcePanel({ sources, query, indexStatus, onRefresh }: { sources: SearchResult[]; query: string; indexStatus: IndexStatus; onRefresh: () => void }) {
  const count = indexStatus.fileCount || indexStatus.total || 0;
  return <aside className="source-panel">
    <div className="source-heading"><div><span>Найденные файлы</span><strong>{sources.length} источников</strong></div><button className="icon-button" aria-label="Панель источников"><PanelRightClose size={17} /></button></div>
    <div className="context-scope"><div className="scope-icon"><Files size={18} /></div><div><strong>Все документы</strong><span>{count ? `${count.toLocaleString("ru-RU")} файлов` : "Локальная библиотека"}</span></div></div>
    <div className="panel-label">Совпадения в документах</div>
    <div className="source-list">{sources.map((doc, index) => <button className="source-card" key={`${doc.path}-${index}`} onClick={() => doc.path && openPath(doc.path)}><DocumentIcon title={doc.title} /><span><strong>{doc.title}</strong><small><HighlightText text={doc.snippet || "Документ из локальной библиотеки"} query={query} /></small></span><ArrowUpRight size={15} /></button>)}{!sources.length && <p className="source-empty">Файлы появятся здесь только когда вы попросите найти что-либо в документах.</p>}</div>
    <div className="source-spacer" />
    <div className="index-card"><div className="index-row"><span><StatusDot active={indexStatus.state === "ready"} />{indexStatus.state === "indexing" ? `Индексация ${indexStatus.scanned}/${indexStatus.total || "…"}` : count ? "Индекс актуален" : "Индекс пуст"}</span><button onClick={onRefresh}><RefreshCw className={indexStatus.state === "indexing" ? "spin" : ""} size={14} /></button></div><div className="progress"><span style={{ width: indexStatus.total ? `${Math.min(100, indexStatus.scanned / indexStatus.total * 100)}%` : count ? "100%" : "0%" }} /></div><p>{indexStatus.lastError || (count ? `${count.toLocaleString("ru-RU")} документов доступны для поиска` : "Добавьте папку с документами")}</p></div>
  </aside>;
}

const isDocumentSearchRequest = (query: string) => /(найд|поиск|ищу|покажи|в каких файлах|где встреча|где упомина|по документ|в документ|search|find|which files|in my documents?)/iu.test(query);

function ChatView({ thread, threads, indexStatus, aiStatus, onThreadChange, onIndexStatus }: { thread: ChatThread; threads: ChatThread[]; indexStatus: IndexStatus; aiStatus: AiStatus; onThreadChange: (thread: ChatThread) => void; onIndexStatus: (status: IndexStatus) => void }) {
  const [status, setStatus] = useState<"ready" | "submitted" | "error">("ready");
  const [attachedPaths, setAttachedPaths] = useState<string[]>([]);
  const latestWithSources = [...thread.messages].reverse().find((message) => message.sources);
  const sources = latestWithSources?.sources ?? [];

  const submit = async ({ text }: { text: string }) => {
    const query = text.trim();
    if (!query || status === "submitted") return;
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: query };
    const nextThread = { ...thread, title: thread.title === "Новый чат" ? query.slice(0, 42) : thread.title, messages: [...thread.messages, userMessage] };
    onThreadChange(nextThread);
    setStatus("submitted");
    const useDocuments = attachedPaths.length > 0 || isDocumentSearchRequest(query);
    const memory: HistoryMessage[] = threads.flatMap((item) => item.messages.filter((message) => message.id !== userMessage.id && message.content !== WELCOME_TEXT).map(({ role, content }) => ({ role, content }))).slice(-24);
    try {
      const found = useDocuments ? await searchDocuments(query) : [];
      const answer = await askDocuments(query, attachedPaths, memory, useDocuments);
      if (!answer.ok) throw new Error(answer.error || "Не удалось получить ответ");
      onThreadChange({ ...nextThread, messages: [...nextThread.messages, { id: crypto.randomUUID(), role: "assistant", content: answer.answer || "Ответ не получен.", sources: useDocuments ? found.slice(0, 40) : undefined, query }] });
      setStatus("ready");
      setAttachedPaths([]);
    } catch (error) {
      onThreadChange({ ...nextThread, messages: [...nextThread.messages, { id: crypto.randomUUID(), role: "assistant", content: `Не удалось ответить: ${error instanceof Error ? error.message : "неизвестная ошибка"}` }] });
      setStatus("error");
    }
  };

  const addAttachments = async () => { const selected = await chooseChatFiles(); setAttachedPaths((current) => [...new Set([...current, ...selected])]); };
  const handleCreate = async (message: ChatMessage) => { if (message.query) { const result = await createFileFromAnswer(message.query, message.content); if (result.ok && result.path) await openPath(result.path); } };

  return <div className="workspace">
    <main className="chat-main">
      <header className="chat-header" data-tauri-drag-region><div><h1>{thread.title}</h1><p><StatusDot active={aiStatus.online !== false || aiStatus.installed} />{aiStatus.installed ? `Локальный ИИ · ${aiStatus.model}` : "Облачный ИИ · готов при подключении к интернету"}</p></div><button className="context-button"><Files size={16} />Документы — по запросу</button></header>
      <Conversation className="conversation"><ConversationContent className="conversation-content">
        {thread.messages.length <= 1 && <div className="chat-intro"><div className="ghost-orb"><img src="/officeghost-mark.png" alt="" /></div><h2>Чем помочь?</h2><p>Просто поговорим — или попросите найти что-либо в ваших документах.</p></div>}
        {thread.messages.map((message) => <Message from={message.role} key={message.id} className="chat-message"><MessageContent className={message.role === "assistant" ? "assistant-content" : "user-content"}>{message.role === "assistant" ? <MessageResponse>{message.content}</MessageResponse> : message.content}{!!message.sources?.length && <Sources><SourcesTrigger count={message.sources.length}>Найдено файлов: {message.sources.length}<ChevronDown size={14} /></SourcesTrigger><SourcesContent>{message.sources.map((source) => <Source href="#" title={source.title} key={source.path} onClick={(event) => { event.preventDefault(); openPath(source.path); }} />)}</SourcesContent></Sources>}</MessageContent>{message.role === "assistant" && message.query && <MessageActions className="message-actions"><MessageAction tooltip="Копировать" onClick={() => navigator.clipboard.writeText(message.content)}><Copy size={14} /></MessageAction><MessageAction tooltip="Создать файл" onClick={() => handleCreate(message)}><FilePlus2 size={14} /></MessageAction></MessageActions>}</Message>)}
      </ConversationContent><ConversationScrollButton /></Conversation>
      <div className="composer-wrap">{!!attachedPaths.length && <div className="attached-files">{attachedPaths.map((path) => <span key={path}><Paperclip size={12} />{path.split(/[\\/]/).pop()}<button onClick={() => setAttachedPaths((items) => items.filter((item) => item !== path))}><X size={12} /></button></span>)}</div>}<PromptInput onSubmit={submit} className="composer"><PromptInputBody><PromptInputTextarea placeholder="Напишите сообщение или попросите найти что-либо в документах…" /></PromptInputBody><PromptInputFooter><PromptInputTools><button type="button" className="attach-button" onClick={addAttachments} title="Добавить документы"><Paperclip size={15} /></button><span className="local-pill"><Sparkles size={13} />Облачный + локальный ИИ</span></PromptInputTools><PromptInputSubmit status={status} /></PromptInputFooter></PromptInput><p className="composer-note">Поиск в документах запускается только по вашей просьбе.</p></div>
    </main>
    <SourcePanel sources={sources} query={latestWithSources?.query || ""} indexStatus={indexStatus} onRefresh={async () => onIndexStatus(await refreshIndex())} />
  </div>;
}

function LibraryView({ indexStatus, settings, onIndexStatus, onSettings }: { indexStatus: IndexStatus; settings: Settings; onIndexStatus: (status: IndexStatus) => void; onSettings: (settings: Settings) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const runSearch = async () => { const value = query.trim(); if (!value) return; setLoading(true); const [found, smart] = await Promise.all([searchDocuments(value), askDocuments(`Найди в документах: ${value}. Назови файлы и в 1-2 предложениях объясни смысл найденного.`, [], [], true)]); setResults(found); setAnswer(smart.answer || smart.error || ""); setLoading(false); };
  const removeRoot = async (root: string) => { const next = await updateSettings({ roots: (settings.roots || []).filter((item) => item !== root) }); onSettings(next); onIndexStatus(await refreshIndex()); };
  useEffect(() => { searchDocuments("").then(setResults); }, []);
  return <main className="page-main library-page">
    <header className="page-header" data-tauri-drag-region><div><span className="eyebrow">Локальная библиотека</span><h1>Ваши документы</h1><p>Умный поиск показывает ответ, файлы и реальные совпадения.</p></div><div className="header-actions"><button className="secondary-button" onClick={async () => { const next = await chooseIndexFolder(); onSettings(next); onIndexStatus(await refreshIndex()); }}><FolderOpen size={16} />Добавить папку</button><button className="primary-button" onClick={async () => onIndexStatus(await refreshIndex())}><RefreshCw className={indexStatus.state === "indexing" ? "spin" : ""} size={16} />Обновить индекс</button></div></header>
    {!!settings.roots?.length && <div className="indexed-roots">{settings.roots.map((root) => <span key={root}><FolderOpen size={13} />{root}<button onClick={() => removeRoot(root)}><X size={12} /></button></span>)}</div>}
    {indexStatus.state === "error" && <div className="error-banner"><AlertCircle size={17} /><span><strong>Не удалось обновить индекс</strong>{indexStatus.lastError}</span></div>}
    <section className="stats-row"><div className="stat-card"><div><Files size={18} /></div><span><strong>{(indexStatus.fileCount || indexStatus.total || 0).toLocaleString("ru-RU")}</strong><small>Документов в индексе</small></span></div><div className="stat-card"><div><Check size={18} /></div><span><strong>11 форматов</strong><small>PDF, Office, текст и таблицы</small></span></div><div className="stat-card"><div><Clock3 size={18} /></div><span><strong>Автоматически</strong><small>Разрешённые папки сохранены</small></span></div></section>
    <section className="library-card"><div className="library-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && runSearch()} placeholder="Слово, фраза или вопрос по документам" /></div><button onClick={runSearch}>{loading ? <RefreshCw className="spin" size={16} /> : <Search size={16} />}Найти</button></div>{answer && <div className="library-answer"><Sparkles size={16} /><p>{answer}</p></div>}<div className="file-table-head"><span>Документ</span><span>Найденный фрагмент</span><span /></div><div className="file-table">
      {results.map((doc, index) => <button key={`${doc.path}-${index}`} onClick={() => openPath(doc.path)}><DocumentIcon title={doc.title} /><span className="file-name"><strong><HighlightText text={doc.title} query={query} /></strong><small>{doc.path}</small></span><span className="file-snippet"><HighlightText text={doc.snippet || "Содержимое готово к поиску"} query={query} /></span><ArrowUpRight size={16} /></button>)}
      {!results.length && <div className="empty-state"><FileArchive size={28} /><strong>Ничего не найдено</strong><span>Попробуйте изменить запрос или обновить индекс.</span></div>}
    </div></section>
  </main>;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) { return <button className={`toggle ${checked ? "on" : ""}`} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><span /></button>; }
function AutomationsView({ settings, onSettings }: { settings: Settings; onSettings: (settings: Settings) => void }) {
  const patchSetting = async (partial: Settings) => onSettings(await updateSettings(partial));
  return <main className="page-main automations-page"><header className="page-header" data-tauri-drag-region><div><span className="eyebrow">Работает в фоне</span><h1>Автоматизации</h1><p>OfficeGhost сам поддерживает библиотеку в порядке.</p></div></header><section className="automation-grid"><article className="automation-card featured"><div className="automation-icon"><RefreshCw size={20} /></div><div className="automation-title"><span><StatusDot active={settings.scheduleEnabled !== false} />{settings.scheduleEnabled !== false ? "Активно" : "Приостановлено"}</span><h2>Обновлять индекс</h2><p>Находит новые и изменённые документы каждые {settings.scheduleMinutes || 30} минут.</p></div><Toggle checked={settings.scheduleEnabled !== false} onChange={(value) => patchSetting({ scheduleEnabled: value })} /><div className="automation-meta"><Clock3 size={15} />Интервал: {settings.scheduleMinutes || 30} минут</div></article><article className="automation-card muted-card"><div className="automation-icon purple"><FileArchive size={20} /></div><div className="automation-title"><span>В разработке</span><h2>Разбирать загрузки</h2><p>Раскладывать новые файлы по папкам на основе названия и содержимого.</p></div></article><article className="automation-card muted-card"><div className="automation-icon orange"><WandSparkles size={20} /></div><div className="automation-title"><span>В разработке</span><h2>Еженедельная сводка</h2><p>Собирать изменения в выбранных документах в короткий отчёт.</p></div></article></section></main>;
}

function AccountView({ authStatus, documentCount, updateStatus, onAuthChange }: { authStatus: DesktopAuthStatus; documentCount: number; updateStatus: UpdateStatus; onAuthChange: (status: DesktopAuthStatus) => void }) {
  const waiting = authStatus.status === "waiting";
  const signIn = async () => onAuthChange(await beginDesktopAuth());
  const signOut = async () => onAuthChange(await signOutDesktop());

  if (!authStatus.authenticated || !authStatus.profile) {
    return <main className="account-view account-view--signed-out">
      <header className="account-app-header" data-tauri-drag-region><span>Аккаунт OfficeGhost</span><small>ЛИЧНОЕ ПРОСТРАНСТВО</small></header>
      <section className="account-signin-card">
        <div className="account-orbit-app"><img src="/officeghost-mark.png" alt="" /></div>
        <span className="eyebrow">Синхронизация аккаунта</span>
        <h1>Войдите, не покидая безопасный поток.</h1>
        <p>OfficeGhost откроет страницу входа в вашем браузере. После Google-авторизации браузер вернёт вас прямо в приложение.</p>
        <button className="account-signin-button" disabled={waiting} onClick={signIn}>{waiting ? <RefreshCw className="spin" size={17} /> : <LogIn size={17} />}{waiting ? "Ждём подтверждение в браузере…" : "Войти через браузер"}</button>
        {authStatus.error && <div className="account-auth-error"><AlertCircle size={15} />{authStatus.error}</div>}
        <div className="account-flow-note"><ShieldCheck size={17} /><span><strong>Пароль не передаётся приложению</strong><small>Авторизация выполняется на защищённом сайте OfficeGhost</small></span></div>
      </section>
    </main>;
  }

  const profile = authStatus.profile;
  return <main className="account-view">
    <header className="account-app-header" data-tauri-drag-region><span>Аккаунт OfficeGhost</span><small>СЕССИЯ АКТИВНА</small></header>
    <div className="account-app-content">
      <section className="account-identity-card">
        <div className="account-identity-main"><img src={profile.imageUrl || "/officeghost-mark.png"} alt="" /><div><span className="eyebrow">Личное пространство</span><h1>{profile.name}</h1><p>{profile.email}</p></div></div>
        <span className="account-plan">{profile.plan || "Early Access"}</span>
      </section>
      <section className="account-app-grid">
        <article><div className="account-metric-icon"><Files size={19} /></div><span><small>ЛОКАЛЬНАЯ БИБЛИОТЕКА</small><strong>{documentCount.toLocaleString("ru-RU")} документов</strong><p>Индекс хранится только на этом компьютере.</p></span></article>
        <article><div className="account-metric-icon"><MonitorCheck size={19} /></div><span><small>ЭТО УСТРОЙСТВО</small><strong>OfficeGhost 0.3.2</strong><p>{updateStatus.available ? `Доступно обновление ${updateStatus.version}` : "Приложение подключено к аккаунту."}</p></span></article>
      </section>
      <section className="account-session-panel"><div><ShieldCheck size={20} /><span><strong>Защищённая сессия</strong><small>Вход подтверждён через officeghost.com. Локальные документы не загружаются в аккаунт.</small></span></div><StatusDot /></section>
      <div className="account-app-actions"><button onClick={() => openPath("https://www.officeghost.com/account/profile")}><ExternalLink size={15} />Управлять профилем на сайте</button><button className="danger" onClick={signOut}><LogOut size={15} />Выйти на этом устройстве</button></div>
    </div>
  </main>;
}

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [threads, setThreads] = useState<ChatThread[]>(() => { try { const stored = JSON.parse(localStorage.getItem(CHAT_STORAGE) || "[]") as ChatThread[]; return stored.length ? stored : [createThread()]; } catch { return [createThread()]; } });
  const [activeThreadId, setActiveThreadId] = useState(() => threads[0].id);
  const [indexStatus, setIndexStatus] = useState<IndexStatus>({ state: "idle", scanned: 0, total: 0, fileCount: 0 });
  const [aiStatus, setAiStatus] = useState<AiStatus>({ installed: false, installing: false, model: "cloud", online: true });
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: "idle", available: false, version: "", downloading: false, installed: false });
  const [settings, setSettings] = useState<Settings>({ scheduleEnabled: true, scheduleMinutes: 30 });
  const [authStatus, setAuthStatus] = useState<DesktopAuthStatus>({ authenticated: false, status: "signed_out" });
  useEffect(() => { localStorage.setItem(CHAT_STORAGE, JSON.stringify(threads.slice(0, 50))); }, [threads]);
  useEffect(() => { Promise.all([getIndexStatus(), getAiStatus(), getSettings(), getAppUpdateStatus(), getDesktopAuth()]).then(([index, ai, nextSettings, update, auth]) => { setIndexStatus(index); setAiStatus(ai); setSettings(nextSettings); setUpdateStatus(update); setAuthStatus(auth); }); let stopIndex = () => {}; let stopAi = () => {}; let stopUpdate = () => {}; let stopAuth = () => {}; subscribeIndexStatus(setIndexStatus).then((stop) => { stopIndex = stop; }); subscribeAiStatus(setAiStatus).then((stop) => { stopAi = stop; }); subscribeAppUpdateStatus(setUpdateStatus).then((stop) => { stopUpdate = stop; }); subscribeDesktopAuth(setAuthStatus).then((stop) => { stopAuth = stop; }); return () => { stopIndex(); stopAi(); stopUpdate(); stopAuth(); }; }, []);
  const activeThread = threads.find((thread) => thread.id === activeThreadId) || threads[0];
  const updateThread = (next: ChatThread) => setThreads((current) => current.map((thread) => thread.id === next.id ? next : thread));
  const newChat = () => { const next = createThread(); setThreads((current) => [next, ...current]); setActiveThreadId(next.id); setView("chat"); };
  const content = useMemo(() => view === "library" ? <LibraryView indexStatus={indexStatus} settings={settings} onIndexStatus={setIndexStatus} onSettings={setSettings} /> : view === "automations" ? <AutomationsView settings={settings} onSettings={setSettings} /> : view === "account" ? <AccountView authStatus={authStatus} documentCount={indexStatus.fileCount || 0} updateStatus={updateStatus} onAuthChange={setAuthStatus} /> : <ChatView thread={activeThread} threads={threads} indexStatus={indexStatus} aiStatus={aiStatus} onThreadChange={updateThread} onIndexStatus={setIndexStatus} />, [view, activeThread, threads, indexStatus, aiStatus, settings, authStatus, updateStatus]);
  return <TooltipProvider><div className="app-shell"><Sidebar view={view} documentCount={indexStatus.fileCount || 0} threads={threads} activeThreadId={activeThreadId} updateStatus={updateStatus} authStatus={authStatus} onView={setView} onNewChat={newChat} onOpenChat={(id) => { setActiveThreadId(id); setView("chat"); }} onCheckUpdate={() => { void checkAppUpdate().then(setUpdateStatus); }} onInstallUpdate={() => { void installAppUpdate().then(setUpdateStatus); }} />{content}</div></TooltipProvider>;
}
