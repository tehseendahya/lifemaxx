import { ApiError, apiDelete, apiPost } from "@/lib/api";

/**
 * The two server contracts the screenshot import talks to.
 *
 * Split from the components for the same reason `features/food/requests.ts`
 * is: nothing that renders should be building a URL or deciding what a failure
 * means.
 */

/** What `POST /api/runs/analyze` answers when it could not read the picture. */
export interface UnreadableShot {
  readable: false;
  note: string;
}

/** What it answers when it could. Every figure is still unconfirmed. */
export interface ReadShot {
  readable: true;
  type: string;
  title: string;
  durationS: number;
  distanceM: number | null;
  paceSecPerMile: number | null;
  printedPaceSecPerMile: number | null;
  /** Set when the distance and time do not agree with the printed pace. */
  warning: string | null;
  /** Verbatim, for this device to interpret. See `import.ts`. */
  startedAtText: string | null;
  elevationM: number | null;
  avgHr: number | null;
  kcal: number | null;
  note: string;
}

export type ShotReading = ReadShot | UnreadableShot;

/**
 * 45s rather than the client's default.
 *
 * A vision call on a cold serverless start over cell data genuinely takes
 * longer than the default allows, and timing out a request the server was
 * going to answer is the worst of both outcomes — the person is told it failed
 * and the model is paid for anyway. The meal path made the same call at 30s;
 * this one reads smaller type at `detail: "high"` and is slower for it.
 */
export function analyzeRunScreenshot(imageDataUrl: string): Promise<ShotReading> {
  return apiPost<ShotReading>("/api/runs/analyze", { imageDataUrl }, 45_000);
}

export interface SaveRunInput {
  startedAt: string;
  durationS: number;
  distanceM: number | null;
  type: string;
  title: string;
  elevationM: number | null;
  avgHr: number | null;
  kcal: number | null;
}

export function saveRun(input: SaveRunInput): Promise<{ activity: { id: string } }> {
  return apiPost("/api/mobile/run", input);
}

export function deleteImportedRun(id: string): Promise<{ ok: boolean }> {
  return apiDelete("/api/mobile/run", { id });
}

/** A failure the person can act on, rather than a stack trace. */
export function describeFailure(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && /abort|timeout/i.test(err.message)) {
    return "That took too long. Try again on a better connection.";
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
