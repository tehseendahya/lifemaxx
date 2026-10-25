import { apiDelete, apiPost, apiUpload } from "@/lib/api";
import { enqueue } from "@/lib/outbox";
import type { CueResponse, CueWrite, ParseResponse, TranscribeResponse } from "@/lib/types";

import { cueQueueId } from "./model";

/**
 * The calls this feature makes, and the reason none of them write a set.
 *
 * Parsing and resolution are reads. The SET write happens later, through
 * `@/lib/outbox`, so a confirmed set survives a dead phone and a dead signal —
 * posting straight to `/api/sets` from here would lose the one thing the outbox
 * exists for at the one moment it matters.
 *
 * A cue is the one write that starts here, and it has two roads for the same
 * reason: `saveCue` posts directly because its response is the authoritative
 * normalised string, and `queueCue` puts it in the same outbox when there is no
 * signal to answer with one.
 */

/**
 * Free-text entry, and re-parsing a corrected sentence.
 *
 * `/api/sets/parse` is the route the web app has used since before this
 * project: shorthand parser first, model second, then `resolveExercise` per
 * entry. Nothing about transcription is involved, so this path works whether or
 * not `OPENAI_TRANSCRIBE_MODEL` is configured — which is why it is the primary
 * one.
 */
export function parseSets(text: string): Promise<ParseResponse> {
  return apiPost<ParseResponse>("/api/sets/parse", { text });
}

/**
 * Teach the server a wording after the user corrects a match.
 *
 * Deliberately fire-and-forget at the call site: the alias is an optimisation
 * for next time, and failing to learn it must never block the sets the user
 * just confirmed. The server de-duplicates, so a repeat is a no-op.
 */
export function learnAlias(exerciseId: string, alias: string): Promise<{ ok: true }> {
  return apiPost<{ ok: true }>("/api/mobile/exercise/alias", { exerciseId, alias });
}

/**
 * Hand back an exercise the parse created and nothing ended up pointing at.
 *
 * The server only honours this for a user-owned exercise with **zero** sets —
 * it 409s otherwise — so this cannot take history with it however wrong the
 * caller is. Every call site treats a failure as nothing: an unreferenced
 * exercise is invisible in every screen that ranks by volume, and a failed
 * clean-up is not news in the middle of logging a set.
 *
 * The route is `DELETE` with the id in the query string rather than in a body,
 * because a body on a DELETE is not reliably readable across proxies.
 */
export function deleteExercise(id: string): Promise<{ ok: true }> {
  return apiDelete<{ ok: true }>(`/api/mobile/exercise?id=${encodeURIComponent(id)}`);
}

/**
 * Pin, replace or clear this lift's carry-forward cue.
 *
 * One verb for all three. `cue: ""` — or anything that is only whitespace —
 * deletes the row and comes back as `cue: null`, because the absence of a row
 * is the only representation of "no cue" the server has. So the text field's
 * contents get sent whatever they are, and there is no DELETE to reach for.
 *
 * **Render the response's `cue`, never the string that was sent.** The server
 * normalises — CRLF to LF, trailing spaces off each line, any run of blank
 * lines down to a single one, the ends trimmed — so the two are not always
 * equal, and
 * painting the local draft would show something the next bootstrap disagrees
 * with. `normaliseCue` in `model.ts` mirrors that rule for the LENGTH check
 * only, so the phone measures what the server measures.
 *
 * Idempotent on (user, exercise), so a double-tapped save or a retry after a
 * lost response lands on one row with the last write winning.
 *
 * ── ONLINE THIS IS THE WHOLE STORY; OFFLINE SEE `queueCue` ─────────────────
 *
 * This posts directly, because when there is signal the response is worth
 * waiting for: it carries the cue as the server normalised it, which is the
 * string the next bootstrap will send. Only when this fails for a reason
 * retrying could fix does the caller fall back to `queueCue`.
 */
export function saveCue(exerciseId: string, cue: string): Promise<CueResponse> {
  const body: CueWrite = { exerciseId, cue };
  return apiPost<CueResponse>("/api/mobile/exercise/cue", body);
}

/**
 * The same write, queued, for a cue typed where there is no signal.
 *
 * Every SET in this feature goes through `@/lib/outbox` so it survives a
 * basement, and a cue is written on the same concrete — so it goes through the
 * outbox too. `OutboxKind` gained a `"cue"` member for this; the comment on it
 * in `src/lib/outbox/queue.ts` is where the reasoning about ordering lives,
 * since that queue is strictly ordered and a new kind in it is not free.
 *
 * Two things make it safe rather than merely possible. The item id is
 * `cueQueueId(exerciseId)`, so re-editing the same lift's cue replaces the
 * queued write instead of stacking a second one behind it. And the route is an
 * upsert on (user, exercise), so a replay after a response was lost on a dying
 * bar of signal cannot produce a duplicate.
 *
 * The caller renders its own `normaliseCue(draft)` in this path, which is the
 * one place the local draft is painted rather than the server's answer — there
 * is no answer yet. That is sound only because the phone's `normaliseCue` is a
 * byte-identical mirror of the server's, which
 * `src/app/api/mobile/exercise/cue/route.db.test.ts` asserts as text so the two
 * cannot drift apart unnoticed.
 */
export function queueCue(exerciseId: string, cue: string): Promise<string> {
  const body: CueWrite = { exerciseId, cue };
  return enqueue("cue", "/api/mobile/exercise/cue", {
    ...body,
    // `enqueue` takes the item id from `clientId`, which is how a second edit
    // of this lift lands on the same row of the queue. The route ignores the
    // field — it reads `exerciseId` and `cue` and nothing else.
    clientId: cueQueueId(exerciseId),
  });
}

/**
 * Upload a recording and get back the transcript plus the parse of it.
 *
 * `Content-Type` is never set here — `apiUpload` leaves it to React Native,
 * which writes the multipart boundary while serialising the FormData and can
 * only put that boundary in the header if it is writing the header.
 *
 * The `{ uri, name, type }` object is React Native's file part. It is not a
 * `Blob` and there is no `File` on the device; the cast is unavoidable and is
 * the documented shape.
 */
export function transcribeAudio(uri: string, hint?: string): Promise<TranscribeResponse> {
  const form = new FormData();
  form.append("audio", { uri, name: "set.m4a", type: "audio/m4a" } as unknown as Blob);
  if (hint && hint !== "") form.append("hint", hint);
  return apiUpload<TranscribeResponse>("/api/voice/transcribe", form);
}
