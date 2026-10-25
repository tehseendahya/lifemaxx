/**
 * `app/(tabs)/index.tsx` renders this. The route file owns navigation options;
 * everything the screen is lives here.
 */
export { default } from "./TodayScreen";

// The Runs screen reads the same cached `bootstrap` payload, so the hook is
// exported rather than duplicated. See the comment at the top of useBootstrap.
export { useBootstrap } from "./useBootstrap";
export type { BootstrapView } from "./useBootstrap";
