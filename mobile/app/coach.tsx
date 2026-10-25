import { Placeholder } from "@/lib/placeholder";
// INTEGRATION: replace the import above with
//   import CoachScreen from "@/features/coach";
// and the element below with <CoachScreen />.

/**
 * A modal, opened from the ◆ in the Today header. Chat is a task, not a place.
 * The in-session ASK control is deliberately a different thing: it posts to
 * /api/session/ask, which carries session context and a cached prefix.
 */
export default function Coach() {
  return (
    <Placeholder
      title="Coach"
      note="The streaming chat transcript, read with expo/fetch. Owned by the coach workstream."
    />
  );
}
