/**
 * `app/coach.tsx` (a modal) renders the default export.
 *
 * `useStreamingAsk` is exported for the Lift feature's in-session ASK control,
 * which posts to `/api/session/ask` — a different endpoint with session context
 * and a cached prompt prefix, but the same stream. Import it from
 * `@/features/coach/useStreamingAsk` directly rather than from here, so the
 * Lift bundle does not drag the coach modal in behind the hook.
 */
export { default } from "./CoachScreen";

export { useStreamingAsk } from "./useStreamingAsk";
export type { StreamingAsk } from "./useStreamingAsk";
export type { ChatMessage, ChatRole } from "./stream";
