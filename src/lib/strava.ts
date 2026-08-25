import { db } from "@/db";
import { stravaAccounts, activities } from "@/db/schema";
import { eq } from "drizzle-orm";
import { localDate } from "./queries";

/**
 * Strava, over its REST API — not MCP.
 *
 * MCP exposes tools to a chat client; in this app's own request path it would
 * add a hop and buy nothing. A nightly pull is also simpler than webhooks: no
 * public callback to validate, no replay handling, and runs don't need to
 * appear the same minute you finish them.
 */

const API = "https://www.strava.com/api/v3";
const OAUTH = "https://www.strava.com/oauth";

export function authorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "activity:read_all",
    state,
  });
  return `${OAUTH}/authorize?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number };
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`Strava token request failed: ${res.status}`);
  return res.json();
}

export const exchangeCode = (code: string) =>
  tokenRequest({ code, grant_type: "authorization_code" });

/** Refreshes in place when the stored token is within five minutes of expiry. */
async function freshToken(userId: string): Promise<string | null> {
  const [account] = await db.select().from(stravaAccounts)
    .where(eq(stravaAccounts.userId, userId)).limit(1);
  if (!account) return null;

  if (account.expiresAt.getTime() > Date.now() + 300_000) return account.accessToken;

  const refreshed = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: account.refreshToken,
  });

  await db.update(stravaAccounts).set({
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token,
    expiresAt: new Date(refreshed.expires_at * 1000),
  }).where(eq(stravaAccounts.userId, userId));

  return refreshed.access_token;
}

interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  start_date: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  total_elevation_gain: number;
  average_heartrate?: number;
  calories?: number;
  suffer_score?: number;
}

/**
 * Pulls activities since the last sync and upserts them.
 *
 * The unique index on (provider, external_id) makes this idempotent, so an
 * overlapping window or a re-run costs nothing.
 */
export async function syncActivities(userId: string, tz: string): Promise<number> {
  const token = await freshToken(userId);
  if (!token) return 0;

  const [account] = await db.select().from(stravaAccounts)
    .where(eq(stravaAccounts.userId, userId)).limit(1);

  // Overlap the window by a day — Strava backfills late uploads.
  const after = account?.lastSyncedAt
    ? Math.floor(account.lastSyncedAt.getTime() / 1000) - 86_400
    : Math.floor(Date.now() / 1000) - 30 * 86_400;

  const res = await fetch(`${API}/athlete/activities?after=${after}&per_page=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Strava activities failed: ${res.status}`);

  const list = (await res.json()) as StravaActivity[];
  if (list.length === 0) {
    await db.update(stravaAccounts).set({ lastSyncedAt: new Date() })
      .where(eq(stravaAccounts.userId, userId));
    return 0;
  }

  for (const a of list) {
    const startedAt = new Date(a.start_date);
    await db.insert(activities).values({
      userId,
      provider: "strava",
      externalId: String(a.id),
      type: a.sport_type ?? a.type,
      name: a.name,
      startedAt,
      localDate: localDate(tz, startedAt),
      durationS: a.moving_time || a.elapsed_time,
      distanceM: a.distance,
      elevationM: a.total_elevation_gain,
      avgHr: a.average_heartrate ?? null,
      kcal: a.calories ? Math.round(a.calories) : null,
      sufferScore: a.suffer_score ?? null,
    }).onConflictDoNothing();
  }

  await db.update(stravaAccounts).set({ lastSyncedAt: new Date() })
    .where(eq(stravaAccounts.userId, userId));

  return list.length;
}
