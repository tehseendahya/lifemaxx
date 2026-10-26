import { StyleSheet, Text, View } from "react-native";

import { color, microLabel, radius, space, tnum } from "@/components/ui";

import type { GoalRowView } from "./goal-meter";

/**
 * One goal: the thing, the countdown, a meter, and the line under it.
 *
 *     Barbell Bench Press                        9 WEEKS LEFT
 *     185 ████████████████████████░░░░  205 lb
 *     e1RM 185 · 20 lb to go · needs 2.2 lb/wk
 *
 * Shared by Today's Goals card (glance: no sentence) and You (the reading view:
 * the owner's own sentence under every derived line, as provenance). Every
 * figure comes from `goal-meter.ts`; this file only draws it.
 *
 * The meter is a plain filled track rather than `RangeBar`: there is no band
 * here, only distance to one number, and a band drawn around a single target
 * would invent a range nobody set.
 */

const TRACK_H = 6;

const styles = StyleSheet.create({
  row: { paddingVertical: space.md },
  divided: { borderTopWidth: 1, borderTopColor: color.line },
  head: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.md,
  },
  title: { color: color.ink, fontSize: 15, fontWeight: "500", flexShrink: 1 },
  deadline: { ...microLabel, ...tnum },

  meterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginTop: space.sm,
  },
  end: { ...tnum, color: color.ink, fontSize: 13 },
  endMuted: { ...tnum, color: color.muted, fontSize: 13 },
  track: {
    flex: 1,
    height: TRACK_H,
    borderRadius: radius.pill,
    backgroundColor: color.surface2,
    overflow: "hidden",
  },
  fill: { height: TRACK_H, borderRadius: radius.pill },

  line: { ...tnum, fontSize: 13, lineHeight: 18, marginTop: space.xs },
  since: { ...tnum, color: color.muted, fontSize: 11, marginTop: 2 },
  pace: { ...tnum, fontSize: 12, lineHeight: 17, marginTop: 2 },
  sentence: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: space.xs },
});

const toneColour = (tone: "good" | "ink" | "muted"): string =>
  tone === "good" ? color.good : tone === "muted" ? color.muted : color.ink;

/** React Native takes a percentage string verbatim. */
const pct = (fraction: number): `${number}%` => `${Math.max(0, Math.min(1, fraction)) * 100}%`;

export function GoalRow({ row, divided, showSentence = false }: {
  row: GoalRowView;
  divided: boolean;
  /** You prints the owner's sentence and the pace line; Today does not. */
  showSentence?: boolean;
}) {
  return (
    <View style={[styles.row, divided && styles.divided]}>
      <View style={styles.head}>
        <Text style={styles.title} numberOfLines={1}>{row.title}</Text>
        {row.deadline !== null && (
          <Text
            style={[
              styles.deadline,
              { color: row.deadline.tone === "warn" ? color.warn : color.muted },
            ]}
          >
            {row.deadline.label}
          </Text>
        )}
      </View>

      {row.meter !== null && (
        <View
          style={styles.meterRow}
          accessible
          accessibilityLabel={`${row.meter.nowLabel} of ${row.meter.targetLabel}`}
        >
          <Text style={styles.end}>{row.meter.nowLabel}</Text>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                {
                  width: pct(row.meter.fraction),
                  backgroundColor: row.meter.met ? color.good : color.accent,
                },
              ]}
            />
          </View>
          <Text style={styles.endMuted}>{row.meter.targetLabel}</Text>
        </View>
      )}

      <Text style={[styles.line, { color: toneColour(row.line.tone) }]}>{row.line.text}</Text>
      {row.since !== null && <Text style={styles.since}>{row.since}</Text>}

      {showSentence && row.pace !== null && (
        <Text style={[styles.pace, { color: row.pace.tone === "warn" ? color.warn : color.muted }]}>
          {row.pace.text}
        </Text>
      )}
      {/*
        The owner's own sentence, verbatim, under every derived line above it.
        It is the only reason those lines can be trusted — and it is where the
        half of a sentence this app did not track stays visible.
      */}
      {showSentence && <Text style={styles.sentence} numberOfLines={2}>{row.sentence}</Text>}
    </View>
  );
}
