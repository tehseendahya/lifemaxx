/**
 * Two screens live here, because they are the same subject: the You tab is
 * where you change how the app talks to the server, and the sign-in screen is
 * where you first have to.
 *
 * `app/(tabs)/you.tsx` renders the default export; `app/sign-in.tsx` renders
 * `SignInScreen`.
 */
export { default } from "./SettingsScreen";
export { default as SignInScreen } from "./SignInScreen";

// Exported for the sign-in route and for anything else that needs to show which
// server the phone is pointed at.
export { ConnectionCard, useReachability } from "./ConnectionCard";
export {
  MAX_WEIGHT_LB, MIN_WEIGHT_LB, buildMaintenance, buildWeighIn,
  describeReachability, weightFromPad,
} from "./model";
export type {
  MaintenanceView, ProposalChip, ProposalKey, Reachability, TargetProposal,
  WeighInView, WeightEntry,
} from "./model";
