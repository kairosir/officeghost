import { Show, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { isClerkConfigured } from "@/lib/auth-config";

export function AuthControls() {
  if (!isClerkConfigured()) {
    return (
      <div className="header-auth">
        <Link className="auth-link" href="/sign-in">Войти</Link>
        <Link className="auth-button" href="/sign-up">Регистрация</Link>
      </div>
    );
  }

  return (
    <div className="header-auth">
      <Show when="signed-out">
        <Link className="auth-link" href="/sign-in">Войти</Link>
        <Link className="auth-button" href="/sign-up">Регистрация</Link>
      </Show>
      <Show when="signed-in">
        <Link className="auth-button" href="/account">Личный кабинет</Link>
        <UserButton
          appearance={{ elements: { avatarBox: "clerk-avatar" } }}
          userProfileUrl="/account/profile"
        />
      </Show>
    </div>
  );
}
