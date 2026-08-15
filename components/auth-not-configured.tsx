export function AuthNotConfigured() {
  return (
    <div className="auth-config-card">
      <span className="auth-config-icon">⌁</span>
      <p className="section-kicker">Подключение аккаунтов</p>
      <h2>Остался один шаг</h2>
      <p>Система личного кабинета уже встроена. Подключите Clerk к проекту OfficeGhost в Vercel, и регистрация станет доступна.</p>
    </div>
  );
}
