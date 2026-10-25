import { ActivityIndicator } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { color } from "./tokens";

/**
 * Use sparingly.
 *
 * The hero flow has no spinner anywhere in it: a logged set is drawn the moment
 * it is queued and reconciled later, so there is nothing to wait for. A spinner
 * in that path would be advertising latency the user does not have. This is for
 * a first cold load and for the coach thinking.
 */
export function Spinner({ size = "small", style }: {
  size?: "small" | "large";
  style?: StyleProp<ViewStyle>;
}) {
  return <ActivityIndicator size={size} color={color.muted} style={style} />;
}
