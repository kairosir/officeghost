import { UserProfile } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-appearance";

export const metadata = { title: "Профиль и безопасность — OfficeGhost" };

export default function ProfilePage() {
  return (
    <div className="account-content profile-content">
      <div className="profile-intro">
        <p className="section-kicker">Настройки</p>
        <h1>Профиль и безопасность</h1>
        <p>Измените имя, почту или пароль, настройте способы входа и проверьте активные устройства.</p>
      </div>
      <UserProfile
        path="/account/profile"
        routing="path"
        appearance={{
          ...clerkAppearance,
          elements: {
            ...clerkAppearance.elements,
            rootBox: "clerk-profile-root",
            cardBox: "clerk-profile-box",
            card: "clerk-profile-card",
          },
        }}
      />
    </div>
  );
}
