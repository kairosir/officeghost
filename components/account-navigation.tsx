"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/account", icon: "⌂", label: "Обзор", exact: true },
  { href: "/account/profile", icon: "◎", label: "Профиль и безопасность", exact: false },
] as const;

export function AccountNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="Личный кабинет">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
            <span>{item.icon}</span> {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
