import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createStravaState, verifyStravaState, stravaStateSecret, STRAVA_STATE_TTL_S,
} from "./strava-state";

const USER = "6f1c2b9e-3a4d-4e5f-8a7b-0c1d2e3f4a5b";
const OTHER = "11111111-2222-4333-8444-555555555555";
const SECRET = "test-secret-not-a-real-one";
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);

/** Sign an arbitrary payload exactly as the module does, to test what happens AFTER the signature passes. */
function forge(payload: unknown, secret = SECRET): string {
  const key = createHmac("sha256", secret).update("lifemaxx:strava-oauth-state:v1").digest();
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", key).update(encoded).digest("base64url")}`;
}

function decode(state: string) {
  return JSON.parse(Buffer.from(state.split(".")[0], "base64url").toString("utf8"));
}

describe("createStravaState / verifyStravaState", () => {
  it("round-trips the user id", () => {
    const state = createStravaState(USER, SECRET, NOW);
    expect(verifyStravaState(state, SECRET, NOW)).toBe(USER);
  });

  it("is URL-safe, so it survives Strava's redirect untouched", () => {
    expect(createStravaState(USER, SECRET, NOW)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("mints a different token every time", () => {
    expect(createStravaState(USER, SECRET, NOW)).not.toBe(createStravaState(USER, SECRET, NOW));
  });

  it("rejects a payload swapped for another user's, keeping the old signature", () => {
    const state = createStravaState(USER, SECRET, NOW);
    const [, signature] = state.split(".");
    const swapped = Buffer.from(JSON.stringify({ ...decode(state), u: OTHER })).toString("base64url");
    expect(verifyStravaState(`${swapped}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it("rejects an extended expiry, keeping the old signature", () => {
    const state = createStravaState(USER, SECRET, NOW);
    const [, signature] = state.split(".");
    const extended = Buffer.from(JSON.stringify({ ...decode(state), e: decode(state).e + 86400 })).toString("base64url");
    expect(verifyStravaState(`${extended}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const state = createStravaState(USER, SECRET, NOW);
    const last = state.at(-1) === "A" ? "B" : "A";
    expect(verifyStravaState(state.slice(0, -1) + last, SECRET, NOW)).toBeNull();
    // Truncated: a different length must fail before the constant-time compare.
    expect(verifyStravaState(state.slice(0, -2), SECRET, NOW)).toBeNull();
  });

  it("rejects a state signed with a different secret", () => {
    const state = createStravaState(USER, "some-other-secret", NOW);
    expect(verifyStravaState(state, SECRET, NOW)).toBeNull();
  });

  it("expires after the TTL, and not before", () => {
    const state = createStravaState(USER, SECRET, NOW);
    const ttlMs = STRAVA_STATE_TTL_S * 1000;
    expect(verifyStravaState(state, SECRET, NOW + ttlMs - 1000)).toBe(USER);
    expect(verifyStravaState(state, SECRET, NOW + ttlMs)).toBeNull();
    expect(verifyStravaState(state, SECRET, NOW + ttlMs + 1000)).toBeNull();
  });

  it("refuses to verify with no secret at all", () => {
    const state = createStravaState(USER, SECRET, NOW);
    expect(verifyStravaState(state, null, NOW)).toBeNull();
    expect(verifyStravaState(state, "", NOW)).toBeNull();
  });

  it("refuses to sign with no secret", () => {
    expect(() => createStravaState(USER, "", NOW)).toThrow();
  });

  it("refuses to sign for something that is not a user id", () => {
    expect(() => createStravaState("", SECRET, NOW)).toThrow();
    expect(() => createStravaState("not-a-uuid", SECRET, NOW)).toThrow();
  });

  it("rejects malformed states", () => {
    for (const bad of [null, undefined, "", ".", "abc", "a.b.c", ".sig", "payload."]) {
      expect(verifyStravaState(bad, SECRET, NOW)).toBeNull();
    }
  });

  it("rejects a valid state with anything appended", () => {
    const state = createStravaState(USER, SECRET, NOW);
    expect(verifyStravaState(`${state}.extra`, SECRET, NOW)).toBeNull();
    expect(verifyStravaState(`${state}.`, SECRET, NOW)).toBeNull();
  });

  it("rejects a correctly signed payload that is not a valid state", () => {
    const exp = Math.floor(NOW / 1000) + 60;
    expect(verifyStravaState(forge({ u: USER, n: "x", e: exp }), SECRET, NOW)).toBe(USER); // the control
    expect(verifyStravaState(forge({ u: "not-a-uuid", n: "x", e: exp }), SECRET, NOW)).toBeNull();
    expect(verifyStravaState(forge({ n: "x", e: exp }), SECRET, NOW)).toBeNull();
    expect(verifyStravaState(forge({ u: USER, n: "x" }), SECRET, NOW)).toBeNull();
    expect(verifyStravaState(forge({ u: USER, n: "x", e: String(exp) }), SECRET, NOW)).toBeNull();
    expect(verifyStravaState(forge(null), SECRET, NOW)).toBeNull();
  });

  it("rejects a signed payload that is not JSON", () => {
    const key = createHmac("sha256", SECRET).update("lifemaxx:strava-oauth-state:v1").digest();
    const encoded = Buffer.from("not json").toString("base64url");
    const sig = createHmac("sha256", key).update(encoded).digest("base64url");
    expect(verifyStravaState(`${encoded}.${sig}`, SECRET, NOW)).toBeNull();
  });
});

describe("stravaStateSecret", () => {
  it("prefers STRAVA_STATE_SECRET", () => {
    expect(stravaStateSecret({ STRAVA_STATE_SECRET: "a", CRON_SECRET: "b" })).toBe("a");
  });

  it("falls back to CRON_SECRET", () => {
    expect(stravaStateSecret({ CRON_SECRET: "b" })).toBe("b");
    expect(stravaStateSecret({ STRAVA_STATE_SECRET: "  ", CRON_SECRET: "b" })).toBe("b");
  });

  it("is null when neither is set", () => {
    expect(stravaStateSecret({})).toBeNull();
    expect(stravaStateSecret({ STRAVA_STATE_SECRET: "", CRON_SECRET: " " })).toBeNull();
  });
});
