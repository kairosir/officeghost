import { SignIn } from "@clerk/nextjs";
import { AuthNotConfigured } from "@/components/auth-not-configured";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { isClerkConfigured } from "@/lib/auth-config";

export const metadata = { title: "Войти — OfficeGhost" };

export default function SignInPage() {
  if (!isClerkConfigured()) return <AuthNotConfigured />;

  return (
    <SignIn
      appearance={clerkAppearance}
      path="/sign-in"
      routing="path"
      signUpUrl="/sign-up"
      fallbackRedirectUrl="/account"
    />
  );
}
