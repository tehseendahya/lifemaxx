import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * The layout for the only two pages Next still renders.
 *
 * The app itself is the Expo web export in `public/` (see
 * scripts/build-client.mjs); Next is the API plus `/reset-password`, which a
 * password-reset email lands on and which needs a server-side code exchange in
 * `/auth/callback` first. So there is no navigation here and nothing to share
 * with the client beyond the colours in globals.css — which also stay because
 * `mobile/components/ui/tokens.test.ts` reads them as the source of truth.
 */
export const metadata: Metadata = {
  title: "Lifemaxx",
  description: "Meals, lifts and cardio in one tracker, with a coach that reads your own data.",
};

export const viewport: Viewport = {
  themeColor: "#0d1013",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
