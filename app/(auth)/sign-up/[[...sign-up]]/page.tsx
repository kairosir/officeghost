import { SignUp } from "@clerk/nextjs";
import { AuthNotConfigured } from "@/components/auth-not-configured";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { isClerkConfigured } from "@/lib/auth-config";

export const metadata = { title: "Регистрация — OfficeGhost" };

export default function SignUpPage() {
  if (!isClerkConfigured()) return <AuthNotConfigured />;

  return (
    <SignUp
      appearance={clerkAppearance}
      path="/sign-up"
      routing="path"
      signInUrl="/sign-in"
      fallbackRedirectUrl="/account"
    />
  );
}
