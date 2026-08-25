import { db, withUser } from "@/db";
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
 *
 * Every network call in this file sits outside a database transaction. The RLS
 * scopes are opened around the reads and the writes separately, because holding
 * one across an HTTP round trip pins a pooler connection for its duration.
 */

/** Holds the OAuth nonce for the length of the round trip. */
export const STRAVA_STATE_COOKIE = "strava_oauth_state";

const API = "https://www.strava.com/api/v3";
const OAUTH = "https://www.strava.com/oauth";

/** Strava's maximum. Anything above is silently clamped by them, not by us. */
const PAGE_SIZE = 100;

/** Enough to cover a first sync without walking someone's entire history. */
const MAX_PAGES = 10;

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
  if (!res.ok) throw new Error(`Strava token request failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export const exchangeCode = (code: string) =>
  tokenRequest({ code, grant_type: "authorization_code" });

interface Account {
  accessToken: string;
  lastSyncedAt: Date | null;
}

/** Refreshes in place when the stored token is within five minutes of expiry. */
async function freshToken(userId: string): Promise<Account | null> {
  const stored = await withUser(userId, async () => {
    const [account] = await db.select().from(stravaAccounts)
      .where(eq(stravaAccounts.userId, userId)).limit(1);
    return account ?? null;
  });
  if (!stored) return null;

  if (stored.expiresAt.getTime() > Date.now() + 300_000) {
    return { accessToken: stored.accessToken, lastSyncedAt: stored.lastSyncedAt };
  }

  const refreshed = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: stored.refreshToken,
  });

  await withUser(userId, () => db.update(stravaAccounts).set({
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token,
    expiresAt: new Date(refreshed.expires_at * 1000),
  }).where(eq(stravaAccounts.userId, userId)));

  return { accessToken: refreshed.access_token, lastSyncedAt: stored.lastSyncedAt };
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

/** Base URL override, for the idempotency test's stand-in. */
export interface SyncOptions { apiBase?: string }

/**
 * Pulls activities since the last sync and upserts them.
 *
 * Idempotent by construction: the unique index on
 * (user_id, provider, external_id) is the arbiter, so an overlapping window, a
 * double-fired cron or a manual re-run all converge on the same rows.
 *
 * Upsert rather than insert-and-ignore, deliberately. Strava activities are
 * editable after upload — people rename a run, or a watch re-syncs a corrected
 * distance — and "do nothing on conflict" would pin the first version we ever
 * saw and never take a correction.
 */
export async function syncActivities(
  userId: string,
  tz: string,
  options: SyncOptions = {},
): Promise<number> {
  const account = await freshToken(userId);
  if (!account) return 0;

  const base = options.apiBase ?? API;

  // Overlap the window by a day — Strava backfills late uploads.
  const after = account.lastSyncedAt
    ? Math.floor(account.lastSyncedAt.getTime() / 1000) - 86_400
    : Math.floor(Date.now() / 1000) - 30 * 86_400;

  // Paginated: a first sync of an active runner easily exceeds one page, and
  // the previous single-page fetch dropped everything past the hundredth
  // activity without saying so.
  const list: StravaActivity[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(
      `${base}/athlete/activities?after=${after}&per_page=${PAGE_SIZE}&page=${page}`,
      { headers: { Authorization: `Bearer ${account.accessToken}` } },
    );
    if (!res.ok) throw new Error(`Strava activities failed: ${res.status} ${await res.text()}`);

    const batch = (await res.json()) as StravaActivity[];
    list.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  await withUser(userId, async () => {
    for (const a of list) {
      const startedAt = new Date(a.start_date);
      const row = {
        userId,
        provider: "strava" as const,
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
      };

      await db.insert(activities).values(row).onConflictDoUpdate({
        target: [activities.userId, activities.provider, activities.externalId],
        // The verdict is deliberately not in this set: re-syncing a run must
        // not wipe the sentence already written about it.
        set: {
          type: row.type, name: row.name, startedAt: row.startedAt, localDate: row.localDate,
          durationS: row.durationS, distanceM: row.distanceM, elevationM: row.elevationM,
          avgHr: row.avgHr, kcal: row.kcal, sufferScore: row.sufferScore,
        },
      });
    }

    // Only after the rows have landed. Stamping it earlier would advance the
    // window past activities a failed write never stored.
    await db.update(stravaAccounts).set({ lastSyncedAt: new Date() })
      .where(eq(stravaAccounts.userId, userId));
  });

  return list.length;
}
