import { Placeholder } from "@/lib/placeholder";
// INTEGRATION: replace the import above with
//   import ExercisePickerScreen from "@/features/lift/ExercisePickerScreen";
// and the element below with <ExercisePickerScreen />.

/**
 * Full-screen search, shared by manual logging and voice correction. One of the
 * only two places in the app where the system keyboard is correct.
 */
export default function ExercisePicker() {
  return (
    <Placeholder
      title="Pick an exercise"
      note="Search across the catalogue. Shared by the lift and voice workstreams."
    />
  );
}
