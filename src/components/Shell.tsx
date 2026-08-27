"use client";
import { usePathname } from "next/navigation";
import { isBare } from "./nav-routes";

/** Reserves the sidebar's width — but only on the screens that have one. */
export function Shell({ children }: { children: React.ReactNode }) {
  const bare = isBare(usePathname());
  return (
    <div className={bare ? "" : "lg:pl-60"}>
      <main
        className={
          bare
            ? "mx-auto w-full max-w-lg px-4"
            : "mx-auto w-full max-w-lg px-4 lg:max-w-6xl lg:px-10"
        }
      >
        {children}
      </main>
    </div>
  );
}
