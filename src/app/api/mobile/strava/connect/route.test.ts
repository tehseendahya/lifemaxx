import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Strava connect for a bearer client, both ends.
 *
 * `POST /api/mobile/strava/connect` must refuse the signed-out and refuse to
 * sign with no secret; the callback must take the user from the signed state
 * and from nothing else. The token exchange and the database are mocked — the
 * point here is which requests ever get as far as them.
 */

let currentUser: string | null = null;
vi.mock("@/lib/supabase/server", () => ({
  currentUserId: async () => currentUser,
}));

const exchangeCode = vi.fn();
const syncActivities = vi.fn();
vi.mock("@/lib/strava", async () => {
  const actual = await vi.importActual<typeof import("@/lib/strava")>("@/lib/strava");
  return { authorizeUrl: actual.authorizeUrl, exchangeCode, syncActivities };
});

const withUser = vi.fn();
vi.mock("@/db", () => ({ db: {}, withUser }));
vi.mock("@/lib/queries", () => ({ getProfile: async () => null }));

const { POST } = await import("./route");
const { GET } = await import("../../../strava/callback/route");
const { createStravaState } = await import("@/lib/strava-state");

const USER = "6f1c2b9e-3a4d-4e5f-8a7b-0c1d2e3f4a5b";
const ORIGIN = "https://lifemaxx.example";

function connect() {
  return POST(new Request(`${ORIGIN}/api/mobile/strava/connect`, {
    method: "POST",
    headers: { authorization: "Bearer t" },
  }));
}

function callback(params: Record<string, string>) {
  return GET(new Request(`${ORIGIN}/api/strava/callback?${new URLSearchParams(params)}`));
}

beforeEach(() => {
  currentUser = USER;
  vi.stubEnv("STRAVA_CLIENT_ID", "12345");
  vi.stubEnv("STRAVA_STATE_SECRET", "");
  vi.stubEnv("CRON_SECRET", "cron-secret");
  exchangeCode.mockReset();
  syncActivities.mockReset();
  withUser.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/mobile/strava/connect", () => {
  it("401s when signed out", async () => {
    currentUser = null;
    expect((await connect()).status).toBe(401);
  });

  it("503s rather than sign with no secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await connect();
    expect(res.status).toBe(503);
  });

  it("503s when Strava itself is not configured", async () => {
    vi.stubEnv("STRAVA_CLIENT_ID", "");
    expect((await connect()).status).toBe(503);
  });

  it("returns an authorize URL whose state names the caller and returns to this origin", async () => {
    const res = await connect();
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://www.strava.com");
    expect(parsed.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/strava/callback`);

    const { verifyStravaState } = await import("@/lib/strava-state");
    expect(verifyStravaState(parsed.searchParams.get("state"), "cron-secret")).toBe(USER);
  });
});

describe("GET /api/strava/callback", () => {
  it("connects the user named in a valid state, with no session at all", async () => {
    currentUser = null; // Safari on the phone: no cookie, no bearer.
    exchangeCode.mockResolvedValue({ access_token: "a", refresh_token: "r", expires_at: 1, athlete: { id: 9 } });
    withUser.mockResolvedValue(null);

    const res = await callback({ code: "c", state: createStravaState(USER, "cron-secret") });
    expect(res.headers.get("location")).toBe(`${ORIGIN}/you?strava=connected`);
    expect(withUser.mock.calls[0][0]).toBe(USER);
    expect(syncActivities).toHaveBeenCalledWith(USER, "America/New_York");
  });

  it("refuses a state signed with another secret, before touching Strava", async () => {
    const res = await callback({ code: "c", state: createStravaState(USER, "not-the-secret") });
    expect(res.headers.get("location")).toBe(`${ORIGIN}/you?strava=error`);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("refuses a missing state, and a missing code (the user pressed Cancel)", async () => {
    expect((await callback({ code: "c" })).headers.get("location")).toBe(`${ORIGIN}/you?strava=error`);
    expect((await callback({ error: "access_denied", state: createStravaState(USER, "cron-secret") }))
      .headers.get("location")).toBe(`${ORIGIN}/you?strava=error`);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("reports an error when the exchange fails", async () => {
    exchangeCode.mockRejectedValue(new Error("strava down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await callback({ code: "c", state: createStravaState(USER, "cron-secret") });
    expect(res.headers.get("location")).toBe(`${ORIGIN}/you?strava=error`);
  });
});
