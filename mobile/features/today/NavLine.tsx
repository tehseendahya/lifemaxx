import { Pressable, StyleSheet, Text } from "react-native";

import { color, hit, space } from "@/components/ui";
import { tapSelect } from "@/lib/haptics";

const styles = StyleSheet.create({
  press: {
    // The web renders these as a plain text link. A 20pt line of text is not a
    // tap target on a phone, so the row is padded out to the 44pt floor while
    // the text itself stays the same size — the affordance grows, the design
    // does not change.
    minHeight: hit.min,
    justifyContent: "center",
    marginTop: space.sm,
    marginBottom: -space.sm,
  },
  pressed: { opacity: 0.6 },
  text: { color: color.accent, fontSize: 14 },
});

/**
 * The "Log your first meal →" line at the foot of a card.
 *
 * Four of these are what make Today a hub rather than a readout, and they are
 * the cheapest tap-count win on the screen: the number you just read is the
 * reason you are about to go somewhere, so the route out sits directly under it.
 */
export function NavLine({ children, onPress }: { children: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => { tapSelect(); onPress(); }}
      style={({ pressed }) => [styles.press, pressed && styles.pressed]}
    >
      <Text style={styles.text}>{children}</Text>
    </Pressable>
  );
}
