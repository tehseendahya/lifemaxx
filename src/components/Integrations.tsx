"use client";
import { useEffect, useState } from "react";
import { Card, Label, Button } from "./ui";

/**
 * Notifications and Strava.
 *
 * The iOS caveat is surfaced in the UI rather than buried in docs: web push
 * only reaches installed PWAs, so a Safari tab shows why it can't enable
 * instead of failing silently when you tap.
 */
export function Integrations({ stravaConnected }: { stravaConnected: boolean }) {
  const [pushState, setPushState] = useState<"unknown" | "unsupported" | "not-installed" | "off" | "on">("unknown");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushState("unsupported");
      return;
    }
    // iOS only delivers push to home-screen installs.
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIos && !installed) {
      setPushState("not-installed");
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setPushState(sub ? "on" : "off"))
      .catch(() => setPushState("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setBusy(false); return; }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setPushState("on");
    } catch (err) {
      console.error(err);
    }
    setBusy(false);
  }

  return (
    <Card className="mb-4">
      <Label>Notifications &amp; sync</Label>

      <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
        <div className="min-w-0">
          <div className="text-sm">Daily verdict &amp; weekly review</div>
          <div className="text-xs text-muted">
            {pushState === "on" && "On — 9pm nightly, 6pm Sundays."}
            {pushState === "off" && "Off."}
            {pushState === "not-installed" && "Add to Home Screen first — iOS only delivers push to installed apps."}
            {pushState === "unsupported" && "This browser doesn't support web push."}
            {pushState === "unknown" && "Checking…"}
          </div>
        </div>
        {pushState === "off" && (
          <Button onClick={enable} disabled={busy} variant="secondary">
            {busy ? "…" : "Enable"}
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 pt-3">
        <div>
          <div className="text-sm">Strava</div>
          <div className="text-xs text-muted">
            {stravaConnected ? "Connected — runs pull in nightly." : "Not connected."}
          </div>
        </div>
        {!stravaConnected && (
          <a
            href="/api/strava/connect"
            className="rounded-lg border border-line-strong bg-surface-2 px-4 py-2.5 text-sm"
          >Connect</a>
        )}
      </div>
    </Card>
  );
}

/**
 * VAPID keys are base64url; PushManager wants raw bytes.
 * Backed by an explicit ArrayBuffer so the result is a BufferSource.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
