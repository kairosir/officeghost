export const clerkAppearance = {
  variables: {
    colorPrimary: "#11120f",
    colorBackground: "#ffffff",
    colorForeground: "#11120f",
    colorMutedForeground: "#74766d",
    colorNeutral: "#11120f",
    borderRadius: "0.5rem",
    fontFamily: "var(--font-geist-sans), Arial, sans-serif",
  },
  elements: {
    rootBox: "clerk-root",
    cardBox: "clerk-card-box",
    card: "clerk-card",
    headerTitle: "clerk-title",
    headerSubtitle: "clerk-subtitle",
    socialButtonsBlockButton: "clerk-social-button",
    formButtonPrimary: "clerk-primary-button",
    formFieldInput: "clerk-input",
    footerActionLink: "clerk-link",
    userButtonAvatarBox: "clerk-avatar",
  },
} as const;
