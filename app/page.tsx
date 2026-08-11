const features = [
  {
    number: "01",
    title: "Находит смысл, а не имя файла",
    text: "OfficeGhost индексирует PDF, DOCX, XLSX, презентации и заметки, чтобы вы находили нужное обычным вопросом.",
  },
  {
    number: "02",
    title: "Отвечает по вашим материалам",
    text: "Каждый ответ опирается на документы и показывает источники — вы всегда понимаете, откуда взялась информация.",
  },
  {
    number: "03",
    title: "Создаёт результат",
    text: "Попросите собрать отчёт, подготовить таблицу, написать резюме встречи или создать новый документ из найденного контекста.",
  },
];

const formats = ["PDF", "DOCX", "XLSX", "PPTX", "TXT", "MD"];

export default function Home() {
  return (
    <main>
      <header className="site-header shell">
        <a className="brand" href="#top" aria-label="OfficeGhost — на главную">
          <span className="brand-mark" aria-hidden="true"><i /></span>
          <span>OfficeGhost</span>
        </a>
        <nav className="desktop-nav" aria-label="Основная навигация">
          <a href="#product">Возможности</a>
          <a href="#shortcuts">Автоматизации</a>
          <a href="#privacy">Приватность</a>
        </nav>
        <a className="header-cta" href="#download">Скачать <span>↘</span></a>
      </header>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span /> Локальный AI для ваших файлов</p>
          <h1>Ваши документы<br />умеют отвечать.</h1>
          <p className="hero-lead">
            Находите, понимайте и создавайте новое вместе с персональным AI,
            который работает с вашими файлами.
          </p>
          <div className="hero-actions">
            <a className="button button-dark" href="#download">Скачать бесплатно <span>↘</span></a>
            <a className="text-link" href="#product">Посмотреть возможности <span>→</span></a>
          </div>
          <p className="platform-note">Для macOS и Windows · Бесплатно на старте</p>
        </div>

        <div className="product-stage" aria-label="Интерфейс OfficeGhost">
          <div className="stage-orbit orbit-one" />
          <div className="stage-orbit orbit-two" />
          <div className="app-window">
            <div className="app-topbar">
              <div className="window-dots"><i /><i /><i /></div>
              <span>OfficeGhost</span>
              <div className="secure-pill"><i /> Локально</div>
            </div>
            <div className="app-layout">
              <aside className="app-sidebar">
                <button className="new-chat">＋ <span>Новый чат</span></button>
                <div className="side-section">
                  <small>СЕГОДНЯ</small>
                  <p className="active"><i /> Отчёт за квартал</p>
                  <p><i /> Исследование рынка</p>
                </div>
                <div className="side-section">
                  <small>КОЛЛЕКЦИИ</small>
                  <p><b className="collection-dot lime" /> Работа <em>42</em></p>
                  <p><b className="collection-dot violet" /> Личное <em>18</em></p>
                </div>
                <div className="profile"><span>AK</span><div>Алексей<small>Локальный профиль</small></div></div>
              </aside>
              <div className="chat-panel">
                <div className="chat-heading">
                  <div><small>ЧАТ С КОЛЛЕКЦИЕЙ</small><strong>Отчёт за квартал</strong></div>
                  <button aria-label="Открыть источники">Источники&nbsp; 3</button>
                </div>
                <div className="chat-flow">
                  <div className="user-message">Какие три главных вывода по продажам за квартал?</div>
                  <div className="assistant-message">
                    <div className="mini-mark"><i /></div>
                    <div>
                      <p>Продажи выросли на <mark>18%</mark>, главным образом за счёт корпоративного сегмента.</p>
                      <p>Три ключевых наблюдения:</p>
                      <ol>
                        <li><b>Корпоративные клиенты</b> обеспечили 64% нового дохода.</li>
                        <li><b>Повторные продажи</b> выросли в 1,4 раза.</li>
                        <li><b>Северный регион</b> показал лучший результат.</li>
                      </ol>
                      <div className="source-row"><span>Q3_Отчёт.pdf · стр. 12</span><span>Продажи.xlsx · Лист 2</span></div>
                    </div>
                  </div>
                </div>
                <div className="chat-input"><span>Спросите о своих документах...</span><button aria-label="Отправить">↑</button></div>
              </div>
            </div>
          </div>
          <div className="float-card float-search"><b>⌕</b><div><small>Найдено за 0,2 сек.</small><strong>12 подходящих файлов</strong></div></div>
          <div className="float-card float-file"><span>W</span><div><strong>Краткий отчёт.docx</strong><small>Документ создан</small></div><b>✓</b></div>
        </div>
      </section>

      <section className="formats-strip" aria-label="Поддерживаемые форматы">
        <div className="formats-track">
          <span>Работает со всеми важными форматами</span>
          {formats.map((format) => <b key={format}>{format}</b>)}
        </div>
      </section>

      <section className="product-section shell" id="product">
        <div className="section-intro">
          <p className="section-kicker">Что умеет OfficeGhost</p>
          <h2>От вопроса<br />до готового результата.</h2>
          <p>Один спокойный интерфейс вместо бесконечных папок, поиска и копирования между приложениями.</p>
        </div>
        <div className="feature-grid">
          {features.map((feature) => (
            <article className="feature-card" key={feature.number}>
              <span>{feature.number}</span>
              <div className={`feature-visual visual-${feature.number}`} aria-hidden="true">
                {feature.number === "01" && <><div className="search-bar">⌕ <i /> <i /></div><div className="file-stack"><b>PDF</b><b>DOC</b><b>XLS</b></div></>}
                {feature.number === "02" && <><div className="answer-lines"><i /><i /><i /></div><div className="quote-chip">“</div></>}
                {feature.number === "03" && <><div className="paper"><i /><i /><i /></div><div className="created-check">✓</div></>}
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="shortcuts-section" id="shortcuts">
        <div className="shell shortcuts-grid">
          <div className="shortcuts-copy">
            <p className="section-kicker">Автоматизации</p>
            <h2>Рутина работает<br />сама.</h2>
            <p>Собирайте сценарии из простых действий и запускайте их кнопкой, горячей клавишей или по расписанию.</p>
            <a className="text-link light-link" href="#download">Попробовать OfficeGhost <span>→</span></a>
          </div>
          <div className="workflow" aria-label="Пример автоматизации">
            <div className="workflow-top"><span>Еженедельный отчёт</span><small>Каждую пятницу, 17:00</small></div>
            <div className="workflow-step"><b>1</b><div><small>НАЙТИ</small><strong>Новые документы в папке «Продажи»</strong></div><span>⌕</span></div>
            <i className="workflow-line" />
            <div className="workflow-step"><b>2</b><div><small>ОБРАБОТАТЬ</small><strong>Собрать ключевые показатели и выводы</strong></div><span>✦</span></div>
            <i className="workflow-line" />
            <div className="workflow-step"><b>3</b><div><small>СОЗДАТЬ</small><strong>Сохранить отчёт в формате DOCX</strong></div><span>＋</span></div>
            <div className="workflow-ready"><span>● Готово к запуску</span><button>Запустить &nbsp;▶</button></div>
          </div>
        </div>
      </section>

      <section className="privacy-section shell" id="privacy">
        <div className="privacy-badge"><span className="brand-mark large"><i /></span></div>
        <div className="privacy-copy">
          <p className="section-kicker">Приватность по умолчанию</p>
          <h2>Ваши файлы остаются вашими.</h2>
          <p>Индекс хранится на вашем компьютере. OfficeGhost может работать с локальной моделью без отправки документов в облако.</p>
          <div className="privacy-points">
            <span><b>✓</b> Локальный индекс</span>
            <span><b>✓</b> Контроль папок</span>
            <span><b>✓</b> AI без облака</span>
          </div>
        </div>
      </section>

      <section className="download-section" id="download">
        <div className="shell download-inner">
          <p className="eyebrow centered"><span /> Скоро в открытом доступе</p>
          <h2>Перестаньте искать.<br />Начните спрашивать.</h2>
          <p>Первая версия OfficeGhost готовится для macOS и Windows.</p>
          <div className="download-buttons">
            <a href="mailto:arhey575@gmail.com?subject=OfficeGhost%20Early%20Access">Получить ранний доступ <span>→</span></a>
          </div>
        </div>
      </section>

      <footer className="site-footer shell">
        <a className="brand" href="#top"><span className="brand-mark"><i /></span><span>OfficeGhost</span></a>
        <p>Ваши документы умеют отвечать.</p>
        <div><a href="#product">Возможности</a><a href="#privacy">Приватность</a><a href="mailto:arhey575@gmail.com">Связаться</a></div>
        <small>© 2026 OfficeGhost</small>
      </footer>
    </main>
  );
}
