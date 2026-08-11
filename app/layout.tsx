import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin", "cyrillic"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin", "cyrillic"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://officeghost.com"),
  title: "OfficeGhost — ваши документы умеют отвечать",
  description: "Локальный AI-помощник для поиска, общения и работы с вашими документами.",
  icons: { icon: "/favicon.png", shortcut: "/favicon.png" },
  openGraph: {
    title: "OfficeGhost",
    description: "Ваши документы умеют отвечать.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "OfficeGhost — ваши документы умеют отвечать" }],
    locale: "ru_RU",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "OfficeGhost", description: "Ваши документы умеют отвечать.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
