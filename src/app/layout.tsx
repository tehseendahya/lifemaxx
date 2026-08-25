import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TabBar } from "@/components/TabBar";
import { ServiceWorker } from "@/components/ServiceWorker";

export const metadata: Metadata = {
  title: "Lifemaxx",
  description: "Meals, lifts and cardio in one tracker, with a coach that reads your own data.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Lifemaxx" },
};

export const viewport: Viewport = {
  themeColor: "#0d1013",
  width: "device-width",
  initialScale: 1,
  // The app is a set of full-screen panels; pinch-zoom just gets in the way.
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto max-w-lg px-4">{children}</main>
        <TabBar />
        <ServiceWorker />
      </body>
    </html>
  );
}
