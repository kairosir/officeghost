import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";

export const metadata = { title: "Личный кабинет — OfficeGhost" };

function formatDate(timestamp?: number | null) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(timestamp);
}

export default async function AccountPage() {
  const user = await currentUser();
  const email = user?.primaryEmailAddress;
  const firstName = user?.firstName || "Пользователь";
  const verified = email?.verification?.status === "verified";

  return (
    <div className="account-content">
      <section className="account-welcome">
        <div>
          <p className="section-kicker">Добро пожаловать</p>
          <h1>{firstName}, всё под контролем.</h1>
          <p>Здесь можно управлять аккаунтом OfficeGhost, безопасностью и версиями приложения.</p>
        </div>
        <span className="account-orbit"><i className="brand-mark" /></span>
      </section>

      <div className="account-stat-grid">
        <article>
          <small>СТАТУС АККАУНТА</small>
          <strong><i className={verified ? "status-dot ok" : "status-dot"} /> {verified ? "Почта подтверждена" : "Ожидает подтверждения"}</strong>
          <p>{email?.emailAddress || "Адрес не указан"}</p>
        </article>
        <article>
          <small>ТАРИФ</small>
          <strong>Early Access</strong>
          <p>Бесплатный доступ на старте</p>
        </article>
        <article>
          <small>С НАМИ С</small>
          <strong>{formatDate(user?.createdAt)}</strong>
          <p>Аккаунт OfficeGhost</p>
        </article>
      </div>

      <div className="account-columns">
        <section className="account-panel download-panel">
          <div className="panel-heading">
            <div><p className="section-kicker">Приложение</p><h2>OfficeGhost для компьютера</h2></div>
            <span className="version-pill">Последняя версия</span>
          </div>
          <p>Установите OfficeGhost и начните общаться со своими документами. Обновления будут приходить автоматически.</p>
          <div className="platform-downloads">
            <a href="https://github.com/kairosir/officeghost/releases/latest" target="_blank" rel="noreferrer"><span className="platform-icon">⊞</span><div><small>СКАЧАТЬ ДЛЯ</small><strong>Windows</strong></div><b>↓</b></a>
            <a href="https://github.com/kairosir/officeghost/releases/latest" target="_blank" rel="noreferrer"><span className="platform-icon">●</span><div><small>СКАЧАТЬ ДЛЯ</small><strong>macOS</strong></div><b>↓</b></a>
          </div>
        </section>

        <section className="account-panel security-panel">
          <div className="panel-heading"><div><p className="section-kicker">Безопасность</p><h2>Защита аккаунта</h2></div></div>
          <ul>
            <li><span className={verified ? "check-circle" : "check-circle waiting"}>{verified ? "✓" : "!"}</span><div><strong>Основная почта</strong><small>{verified ? "Адрес успешно подтверждён" : "Завершите подтверждение почты"}</small></div></li>
            <li><span className="check-circle">✓</span><div><strong>Безопасная сессия</strong><small>Данные входа защищены</small></div></li>
          </ul>
          <Link className="panel-link" href="/account/profile">Настроить профиль и безопасность <span>→</span></Link>
        </section>
      </div>

      <section className="account-panel device-panel">
        <div className="panel-heading"><div><p className="section-kicker">Устройства</p><h2>Связанные приложения</h2></div><span className="coming-pill">Скоро</span></div>
        <p>В следующей версии здесь появятся компьютеры, подключённые к вашему аккаунту, и управление их сессиями.</p>
      </section>
    </div>
  );
}
