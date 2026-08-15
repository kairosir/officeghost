import { Brand } from "@/components/brand";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <header className="auth-header shell">
        <Brand />
        <Link href="/">Вернуться на сайт <span>→</span></Link>
      </header>
      <section className="auth-stage shell">
        <div className="auth-story">
          <p className="eyebrow"><span /> Ваш OfficeGhost</p>
          <h1>Все документы.<br />Один аккаунт.</h1>
          <p>Сохраняйте настройки, управляйте безопасностью и получайте новые версии OfficeGhost в личном кабинете.</p>
          <ul>
            <li><b>✓</b> Подтверждённая почта</li>
            <li><b>✓</b> Защищённые сессии</li>
            <li><b>✓</b> Управление устройствами</li>
          </ul>
        </div>
        <div className="auth-form-wrap">{children}</div>
      </section>
    </main>
  );
}
