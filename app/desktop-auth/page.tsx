import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { DesktopAuthBridge } from "@/components/desktop-auth-bridge";
import { createDesktopGrant, isValidDesktopState, type DesktopProfile } from "@/lib/desktop-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Вход в приложение — OfficeGhost" };

export default async function DesktopAuthPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const state = String((await searchParams).state || "");
  if (!isValidDesktopState(state)) redirect("/");

  const { isAuthenticated } = await auth();
  if (!isAuthenticated) {
    const returnTo = `/desktop-auth?state=${encodeURIComponent(state)}`;
    redirect(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);
  }

  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const email = user.primaryEmailAddress?.emailAddress || "";
  const profile: DesktopProfile = {
    id: user.id,
    name: user.fullName || user.firstName || email || "Пользователь OfficeGhost",
    email,
    imageUrl: user.imageUrl,
    plan: "Early Access",
  };
  const code = await createDesktopGrant(state, profile);
  const deepLink = `officeghost://auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;

  return (
    <main className="desktop-auth-page">
      <div className="desktop-auth-glow" />
      <section className="desktop-auth-card">
        <Brand />
        <div className="desktop-auth-status">✓</div>
        <p className="section-kicker">ВХОД В ПРИЛОЖЕНИЕ</p>
        <h1>Готово, {profile.name.split(" ")[0]}.</h1>
        <p>Аккаунт подтверждён. Сейчас мы вернём вас в приложение OfficeGhost.</p>
        <div className="desktop-auth-user">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={profile.imageUrl} alt="" />
          <span><strong>{profile.name}</strong><small>{profile.email}</small></span>
        </div>
        <DesktopAuthBridge deepLink={deepLink} />
        <small className="desktop-auth-hint">Если приложение не открылось автоматически, нажмите кнопку.</small>
      </section>
    </main>
  );
}
