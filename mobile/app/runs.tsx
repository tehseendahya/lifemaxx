import { Placeholder } from "@/lib/placeholder";
// INTEGRATION: replace the import above with
//   import RunsScreen from "@/features/runs";
// and the element below with <RunsScreen />.

/**
 * Pushed from the Today card, so it lives inside the Today tab: the back
 * gesture works and the tab bar stays where it is.
 */
export default function Runs() {
  return (
    <Placeholder
      title="Runs"
      note="The week's mileage, pace trend and interference. Read-only — runs sync from Strava and Health Auto Export. Owned by the today workstream."
    />
  );
}
