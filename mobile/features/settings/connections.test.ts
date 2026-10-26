import { describe, expect, it } from "vitest";

import {
  connectUrl, pushDetail, pushPrecheck, pushRow, stravaDetail, stravaNotice, stravaRow,
  subscriptionBody, urlBase64ToUint8Array, type PushEnvironment, type PushState,
} from "./connections";
import { passwordResetRedirect } from "./model";

describe("the Strava row", () => {
  it("is a settled state once connected, with nothing to tap", () => {
    expect(stravaRow(true, false)).toEqual({ value: "Connected", tone: "good", actionable: false });
    expect(stravaDetail(true)).toMatch(/nightly/);
  });

  it("offers Connect when not connected, and when an older server sends no flag", () => {
    expect(stravaRow(false, false).actionable).toBe(true);
    expect(stravaRow(undefined, false).actionable).toBe(true);
    // Unknown is not claimed to be "not connected".
    expect(stravaDetail(undefined)).not.toMatch(/Not connected/);
    expect(stravaDetail(false)).toMatch(/Not connected/);
  });

  it("cannot be tapped twice while the authorise URL is being fetched", () => {
    expect(stravaRow(false, true).actionable).toBe(false);
  });
});

describe("stravaNotice (?strava= on /you)", () => {
  it("says what the OAuth round trip did", () => {
    expect(stravaNotice("connected")?.tone).toBe("good");
    expect(stravaNotice("error")?.tone).toBe("bad");
    expect(stravaNotice(["connected", "error"])?.tone).toBe("good");
  });

  it("says nothing for anything else", () => {
    expect(stravaNotice(undefined)).toBeNull();
    expect(stravaNotice("")).toBeNull();
    expect(stravaNotice("hello")).toBeNull();
  });
});

describe("connectUrl", () => {
  it("takes an https URL from the route's answer", () => {
    expect(connectUrl({ url: "https://www.strava.com/oauth/authorize?x=1" }))
      .toBe("https://www.strava.com/oauth/authorize?x=1");
  });

  it("refuses anything that is not one", () => {
    expect(connectUrl({ url: "javascript:alert(1)" })).toBeNull();
    expect(connectUrl({ url: "http://strava.com" })).toBeNull();
    expect(connectUrl({})).toBeNull();
    expect(connectUrl(null)).toBeNull();
    expect(connectUrl("https://x")).toBeNull();
  });
});

const env = (over: Partial<PushEnvironment> = {}): PushEnvironment => ({
  hasServiceWorker: true,
  hasPushManager: true,
  vapidKey: "BKey",
  permission: "default",
  isIos: false,
  standalone: false,
  ...over,
});

describe("pushPrecheck", () => {
  it("asks the service worker when push is possible", () => {
    expect(pushPrecheck(env())).toBeNull();
    expect(pushPrecheck(env({ permission: "granted" }))).toBeNull();
    expect(pushPrecheck(env({ isIos: true, standalone: true }))).toBeNull();
  });

  it("is unsupported without a service worker or a PushManager", () => {
    expect(pushPrecheck(env({ hasServiceWorker: false }))).toBe("unsupported");
    expect(pushPrecheck(env({ hasPushManager: false }))).toBe("unsupported");
  });

  it("asks iOS Safari to install the page first", () => {
    expect(pushPrecheck(env({ isIos: true }))).toBe("install");
  });

  it("says the build is not set up when there is no VAPID key", () => {
    expect(pushPrecheck(env({ vapidKey: "" }))).toBe("unconfigured");
    expect(pushPrecheck(env({ vapidKey: "  " }))).toBe("unconfigured");
  });

  it("is blocked once the user has said no", () => {
    expect(pushPrecheck(env({ permission: "denied" }))).toBe("blocked");
  });
});

describe("pushRow", () => {
  const states: PushState[] = [
    "checking", "unsupported", "install", "unconfigured", "blocked", "off", "on",
  ];

  it("is only actionable when it is off", () => {
    for (const state of states) {
      expect(pushRow(state, false).actionable, state).toBe(state === "off");
    }
  });

  it("is not actionable while turning on", () => {
    expect(pushRow("off", true).actionable).toBe(false);
  });

  it("explains every state that needs explaining", () => {
    for (const state of states.filter((s) => s !== "checking")) {
      expect(pushDetail(state), state).not.toBe("");
    }
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url, padding included", () => {
    // "hello?" is aGVsbG8_ in base64url (with `_` for `/`).
    expect([...urlBase64ToUint8Array("aGVsbG8_")]).toEqual([...Buffer.from("hello?")]);
    expect([...urlBase64ToUint8Array("aGk")]).toEqual([...Buffer.from("hi")]);
  });
});

describe("subscriptionBody", () => {
  const good = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };

  it("passes a browser subscription through, dropping extra fields", () => {
    expect(subscriptionBody({ ...good, expirationTime: null })).toEqual(good);
  });

  it("refuses what the route would refuse", () => {
    expect(subscriptionBody(null)).toBeNull();
    expect(subscriptionBody({ endpoint: "", keys: good.keys })).toBeNull();
    expect(subscriptionBody({ endpoint: good.endpoint })).toBeNull();
    expect(subscriptionBody({ endpoint: good.endpoint, keys: { auth: "a" } })).toBeNull();
    expect(subscriptionBody({ endpoint: good.endpoint, keys: { p256dh: "p" } })).toBeNull();
  });
});

describe("passwordResetRedirect", () => {
  it("lands on the server's callback, then the reset page", () => {
    expect(passwordResetRedirect("https://lifemaxx.vercel.app"))
      .toBe("https://lifemaxx.vercel.app/auth/callback?next=/reset-password");
    expect(passwordResetRedirect("http://192.168.1.4:3000/"))
      .toBe("http://192.168.1.4:3000/auth/callback?next=/reset-password");
  });

  it("is null without a usable origin", () => {
    expect(passwordResetRedirect("")).toBeNull();
    expect(passwordResetRedirect("lifemaxx.app")).toBeNull();
  });
});
