import { Placeholder } from "@/lib/placeholder";
// INTEGRATION: replace the import above with
//   import ExerciseScreen from "@/features/exercise";
// and the element below with <ExerciseScreen />.

/**
 * `?id=<uuid>` rather than a dynamic segment, matching
 * `GET /api/mobile/exercise?id=` — the route() helper never receives Next's
 * `params`, so the whole stack stays on one convention.
 */
export default function Exercise() {
  return (
    <Placeholder
      title="Exercise"
      note="History and the e1RM trend for one exercise. Owned by the lift workstream."
    />
  );
}
