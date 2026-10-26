import { Pressable, StyleSheet, Text, View } from "react-native";

import { microLabel } from "./Label";
import { color, hit, radius, space, tnum } from "./tokens";

/**
 * One question, every answer visible, one tap.
 *
 * This is what RPE and warmup/working/failure needed and did not have. The
 * three `<Toggle>` pills the confirmation sheet used to show read as three
 * unrelated switches — the owner said so — when warmup, working and to-failure
 * are one question with three answers and exactly one of them is true. And RPE
 * has six legal answers, which is a row of visible targets rather than three
 * taps on the number pad (open, digit, DONE).
 *
 * ── WHERE THIS LIVES ───────────────────────────────────────────────────────
 *
 * It started in `features/voice/`, with a note saying to move it here the
 * moment a second feature wanted one. That moment arrived: the live session
 * card had warmup and to-failure as two independent pill toggles, the owner
 * turned both on at once, and the fix is the same control the confirmation
 * sheet already had. Both now import it from the barrel.
 *
 * It follows the design system's rules rather than reinventing them: no colour
 * outside `tokens.ts`, 44pt targets, tabular numerals on anything numeric, and
 * no haptic of its own (the caller knows whether a press selected a value or
 * dismissed a sheet; this does not).
 */

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    // `hidden` so the selected segment's own background cannot paint over the
    // rounded corners of the track it sits in.
    overflow: "hidden",
  },
  segment: {
    flex: 1,
    minHeight: hit.min,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.xs,
  },
  divider: { borderLeftWidth: 1, borderLeftColor: color.line },
  pressed: { backgroundColor: color.surface2 },

  onAccent: { backgroundColor: color.accentSoft },
  onWarn: { backgroundColor: color.surface2 },
  onMuted: { backgroundColor: color.surface2 },

  text: { color: color.muted, fontSize: 14, fontWeight: "500" },
  textNum: { ...tnum, fontSize: 15 },
  textMicro: { ...microLabel, marginBottom: 0, color: color.muted },

  onAccentText: { color: color.accentInk },
  onWarnText: { color: color.warn },
  onMutedText: { color: color.ink },
});

/** The tone of the SELECTED segment. Unselected segments are always muted. */
export type SegmentTone = "accent" | "warn" | "muted";

export interface Segment<T> {
  value: T;
  label: string;
  /** Defaults to the control's `tone`; per-segment so one row can mean three things. */
  tone?: SegmentTone;
}

const selectedStyle: Record<SegmentTone, { view: object; text: object }> = {
  accent: { view: styles.onAccent, text: styles.onAccentText },
  warn: { view: styles.onWarn, text: styles.onWarnText },
  muted: { view: styles.onMuted, text: styles.onMutedText },
};

/**
 * `value` is compared with `===`, so the option type has to be a primitive —
 * which it is everywhere this is used (a number, `null`, or a kind string).
 *
 * Pressing the already-selected segment still calls `onSelect`. The RPE row
 * uses that to mean "clear it", and swallowing the press here would make that
 * impossible to express.
 */
export function Segmented<T extends string | number | null>({
  options,
  value,
  onSelect,
  tone = "accent",
  numeric = false,
  micro = false,
  accessibilityLabel,
}: {
  options: readonly Segment<T>[];
  value: T;
  onSelect: (value: T) => void;
  tone?: SegmentTone;
  /** Tabular numerals and a slightly larger figure — for RPE. */
  numeric?: boolean;
  /** Mono uppercase micro-label type — for WARMUP · WORKING · FAILURE. */
  micro?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <View style={styles.root} accessibilityLabel={accessibilityLabel}>
      {options.map((option, i) => {
        const on = option.value === value;
        const picked = selectedStyle[option.tone ?? tone];

        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onSelect(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={option.label}
            style={({ pressed }) => [
              styles.segment,
              i > 0 && styles.divider,
              on && picked.view,
              pressed && !on && styles.pressed,
            ]}
          >
            <Text
              style={[
                micro ? styles.textMicro : styles.text,
                numeric && styles.textNum,
                on && picked.text,
              ]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
