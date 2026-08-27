"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { TABS, isBare, isActive } from "./nav-routes";

/**
 * Bottom bar on a phone, left rail on a laptop.
 *
 * A thumb reaches the bottom of a phone and nothing else; a mouse has the whole
 * screen and a bottom bar just wastes vertical space and looks like a shrunken
 * phone app. Same links, same active state, two shapes — rather than a second
 * navigation component that drifts out of sync with this one.
 */
export function TabBar() {
  const path = usePathname();
  if (isBare(path)) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-lg">
        {TABS.map((tab) => {
          const active = isActive(path, tab.href);
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

export function SideNav() {
  const path = usePathname();
  if (isBare(path)) return null;

  return (
    <nav className="fixed inset-y-0 left-0 z-50 hidden w-60 flex-col border-r border-line bg-surface px-4 py-8 lg:flex">
      <div className="px-3">
        <span className="text-lg font-semibold tracking-tight">Lifemaxx</span>
      </div>

      <div className="mt-8 flex flex-col gap-1">
        {TABS.map((tab) => {
          const active = isActive(path, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <span className="w-4 text-center text-base leading-none" aria-hidden>{tab.icon}</span>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
