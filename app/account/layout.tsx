import { auth, currentUser } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { AuthNotConfigured } from "@/components/auth-not-configured";
import { isClerkConfigured } from "@/lib/auth-config";

export const dynamic = "force-dynamic";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  if (!isClerkConfigured()) {
    return (
      <main className="account-unconfigured shell">
        <Brand />
        <AuthNotConfigured />
      </main>
    );
  }

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/account");
  const user = await currentUser();
  const name = user?.firstName || user?.primaryEmailAddress?.emailAddress || "Профиль";

  return (
    <main className="account-shell">
      <aside className="account-sidebar">
        <Brand />
        <nav aria-label="Личный кабинет">
          <Link href="/account"><span>⌂</span> Обзор</Link>
          <Link href="/account/profile"><span>◎</span> Профиль и безопасность</Link>
          <a href="https://github.com/kairosir/officeghost/releases/latest" target="_blank" rel="noreferrer"><span>↓</span> Скачать приложение</a>
        </nav>
        <div className="account-side-note">
          <small>ВАШИ ФАЙЛЫ</small>
          <p>Документы и их индекс остаются на вашем компьютере.</p>
        </div>
        <Link className="back-to-site" href="/">← На сайт</Link>
      </aside>
      <section className="account-main">
        <header className="account-topbar">
          <div><small>ЛИЧНЫЙ КАБИНЕТ</small><strong>{name}</strong></div>
          <div className="account-profile-control">
            <UserButton userProfileUrl="/account/profile" appearance={{ elements: { avatarBox: "clerk-avatar account-avatar" } }} />
          </div>
        </header>
        {children}
      </section>
    </main>
  );
}
