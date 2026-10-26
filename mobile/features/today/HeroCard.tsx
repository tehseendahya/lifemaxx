import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button, Card, Label, Pill, color, hit, space, tnum } from "@/components/ui";
import { tapSelect } from "@/lib/haptics";

import { NavLine } from "./NavLine";
import type { CheckKey, DailyCheck, HeroAction } from "./hero";
import type { Verdict } from "./verdict";

/**
 * The top of Today: what to do, one button to do it, and today's three marks.
 *
 * It replaces two things the owner found "weirdly placed": a bare verdict
 * block with a left rule floating above the cards, and a separate "Session in
 * progress" banner above that. Both are now this one accent card — the only
 * accent surface on the screen, so there is exactly one thing to look at first
 * and everything below it reads as evidence.
 */

const styles = StyleSheet.create({
  verdict: { ...tnum, fontSize: 17, lineHeight: 24 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md },
  button: { marginTop: space.lg },

  checks: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: space.xs,
    marginTop: space.lg,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  check: {
    minHeight: hit.min,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs + 2,
    flexShrink: 1,
  },
  pressed: { opacity: 0.6 },
  ring: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
  ringOff: { borderColor: color.muted, backgroundColor: "transparent" },
  ringOn: { borderColor: color.accent, backgroundColor: color.accent },
  checkText: { ...tnum, fontSize: 13, flexShrink: 1 },
  error: { color: color.bad, fontSize: 12, lineHeight: 17, marginTop: space.xs },
});

const CHECK_HINT: Record<CheckKey, string> = {
  weigh: "Opens the weight pad",
  food: "Opens Food",
  train: "Opens Lift",
};

export function HeroCard({
  call, chips, action, checks, error, onAction, onCheck, onCoach,
}: {
  call: Verdict;
  chips: string[];
  action: HeroAction;
  checks: DailyCheck[];
  /** A failed weigh-in from the pad, shown under the marks. */
  error: string | null;
  onAction: () => void;
  onCheck: (key: CheckKey) => void;
  onCoach: () => void;
}) {
  return (
    <Card tone="accent">
      <Label>Today</Label>
      <Text style={[styles.verdict, { color: call.tone === "warn" ? color.warn : color.ink }]}>
        {call.text}
      </Text>

      {chips.length > 0 && (
        <View style={styles.chips}>
          {chips.map((chip) => <Pill key={chip}>{chip}</Pill>)}
        </View>
      )}

      <Button
        size="lg"
        variant={action.variant}
        onPress={() => { tapSelect(); onAction(); }}
        style={styles.button}
      >
        {action.label}
      </Button>

      <View style={styles.checks}>
        {checks.map((c) => (
          <Pressable
            key={c.key}
            accessibilityRole="button"
            accessibilityLabel={`${c.text}${c.done ? ", done" : ""}`}
            accessibilityHint={CHECK_HINT[c.key]}
            onPress={() => { tapSelect(); onCheck(c.key); }}
            style={({ pressed }) => [styles.check, pressed && styles.pressed]}
          >
            <View style={[styles.ring, c.done ? styles.ringOn : styles.ringOff]} />
            <Text
              style={[styles.checkText, { color: c.done ? color.ink : color.muted }]}
              numberOfLines={1}
            >
              {c.text}
            </Text>
          </Pressable>
        ))}
      </View>
      {error !== null && <Text style={styles.error}>{error}</Text>}

      <NavLine onPress={onCoach}>Ask the coach why →</NavLine>
    </Card>
  );
}
