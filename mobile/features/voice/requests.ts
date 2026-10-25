import { apiPost, apiUpload } from "@/lib/api";
import type { ParseResponse, TranscribeResponse } from "@/lib/types";

/**
 * The three calls this feature makes, and the reason none of them write a set.
 *
 * Parsing and resolution are reads. The write happens later, through
 * `@/lib/outbox`, so a confirmed set survives a dead phone and a dead signal —
 * posting straight to `/api/sets` from here would lose the one thing the outbox
 * exists for at the one moment it matters.
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
