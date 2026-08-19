"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Today", icon: "◎" },
  { href: "/food", label: "Food", icon: "◍" },
  { href: "/lift", label: "Lift", icon: "▮" },
  { href: "/coach", label: "Coach", icon: "◆" },
  { href: "/settings", label: "You", icon: "○" },
] as const;

export function TabBar() {
  const path = usePathname();
  if (path === "/login") return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-lg">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? path === "/" : path.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] tracking-wide uppercase transition-colors ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              <span className="text-lg leading-none" aria-hidden>{tab.icon}</span>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
