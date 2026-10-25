import { HttpError, route } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { parseSetsText } from "@/lib/llm/parse-sets";
import { getTranscriber, isTranscriptionConfigured } from "@/lib/llm/transcribe";

/**
 * A spoken set: audio in, the transcript plus the parse of it out.
 *
 * Speech recognition is a native module and therefore cannot exist in Expo Go,
 * so the phone only holds the microphone. It records fifteen seconds at most
 * and posts it here; transcription and parsing both happen server-side, and the
 * response is deliberately the transcript plus the *exact* `/api/sets/parse`
 * body so that one confirmation UI serves spoken and typed entry alike.
 *
 * This route never writes a set. The user confirms the rows and the phone's
 * outbox posts them to `/api/sets`, which is the only thing that writes.
 */

/**
 * Smaller than this is a tap, not a sentence.
 *
 * An AAC container with no audio frames in it is a few hundred bytes, which is
 * what a recording that started and stopped inside the same gesture produces.
 * Transcribing it costs a round trip to learn nothing; "nothing recorded" is
 * both truer and faster.
 */
const MIN_BYTES = 1_000;

/**
 * Fifteen seconds of 24 kbps mono AAC is about 45 KB, so two megabytes is forty
 * times the designed maximum. Anything near it is a client bug — a wrong preset,
 * a stuck recorder — not a long sentence, and Vercel's own 4.5 MB request limit
 * would reject it later with a message that explains nothing.
 */
const MAX_BYTES = 2_000_000;

/** The transcription hint is an exercise name, not free text. */
const MAX_HINT = 80;

/**
 * `route()` tries `req.json()` on every non-GET and the body can only be read
 * once, so the multipart body has to be taken off the request BEFORE the
 * wrapper runs. Reading it here leaves `req.json()` to throw "body already
 * used", which `route()` already catches and turns into an empty body — which
 * is correct, because this route has no JSON body.
 *
 * Keyed on the request so nothing is shared between concurrent calls, and weak
 * so a request that never reaches the handler is not retained.
 */
const bodies = new WeakMap<Request, FormData>();

const handler = route(async ({ userId, req }) => {
  // Checked before the file is even looked at: an unconfigured deployment is
  // not the caller's fault and should not read as a bad upload. `route()` logs
  // 5xx, which is right — this one is a deployment that needs an env var.
  if (!isTranscriptionConfigured()) {
    throw new HttpError("Transcription is not configured.", 503);
  }

  const form = bodies.get(req);
  if (!form) throw new HttpError("Send the recording as multipart/form-data.", 415);

  const audio = form.get("audio");
  if (!(audio instanceof File)) throw new HttpError("An audio file is required.");
  if (audio.size < MIN_BYTES) throw new HttpError("Nothing recorded.");
  if (audio.size > MAX_BYTES) throw new HttpError("That recording is too long.", 413);

  // `audio/m4a` is what React Native sends for an iOS AAC recording and is not
  // a registered type, so the check is on the top-level type rather than an
  // allowlist of subtypes. An empty type is rejected too: the one caller always
  // sets it, and a part with no type is a sign the multipart body was built by
  // something else.
  if (!audio.type.startsWith("audio/")) {
    throw new HttpError(`Expected audio, got ${audio.type || "no content type"}.`, 415);
  }

  const rawHint = form.get("hint");
  const hint = typeof rawHint === "string" && rawHint.trim() !== ""
    ? rawHint.trim().slice(0, MAX_HINT)
    : undefined;

  const transcript = (await getTranscriber().transcribe({ file: audio, hint })).trim();
  // Not logged, here or anywhere: it is the user's voice and it has no value to
  // anyone once it has been parsed.
  if (transcript === "") throw new HttpError("Couldn’t make out any words.");

  // The same function `/api/sets/parse` calls. No second parser, no second
  // resolver, no second prompt — exercise matching has one implementation.
  const parsed = await parseSetsText(transcript, userId);

  return { transcript, ...parsed };
}, {
  // Two model calls happen in here — the transcription and, for prose, the sets
  // parse. Neither may run inside `withUser()`'s transaction: Supabase's pooler
  // is in transaction mode and a multi-second round trip would pin a server
  // connection for its duration. `parseSetsText` opens its own scope around the
  // database work only.
  scope: "manual",
});

export async function POST(req: Request) {
  try {
    bodies.set(req, await req.formData());
  } catch {
    // Not multipart, or a truncated upload. The handler answers 415 — doing it
    // here instead would mean this route authenticating before `route()` does,
    // and an unauthenticated caller learning the difference.
  }
  return handler(req);
}

export const OPTIONS = preflight;
