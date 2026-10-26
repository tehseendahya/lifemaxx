import { Platform, useWindowDimensions } from "react-native";

import { isWideLayout } from "./layout-rules";

export {
  CONTENT_MAX_WIDTH, DIALOG_MAX_WIDTH, NAV_ITEMS, PANEL_MAX_WIDTH, SIDEBAR_WIDTH, WIDE_MIN_WIDTH,
  activeNav, isWideLayout, navMove,
  type NavItem, type NavKey,
} from "./layout-rules";

/**
 * True for a laptop browser window: the sidebar, the centred column, dialogs
 * instead of sheets, and typed number fields.
 *
 * A hook rather than a constant because a browser window is resized while the
 * app is open, and the layout has to follow it across the breakpoint. On the
 * phone `Platform.OS` is never "web", so this is false on every render and
 * nothing it gates can reach the native app. The decision itself is
 * `isWideLayout`, which is tested.
 */
export function useIsWide(): boolean {
  const { width } = useWindowDimensions();
  return isWideLayout(Platform.OS, width);
}
