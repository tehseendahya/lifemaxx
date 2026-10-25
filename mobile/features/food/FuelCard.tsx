import { StyleSheet, Text, View } from "react-native";

import { Card, Label, MacroBar, color, radius, space, tnum } from "@/components/ui";
import type { TdeeResult } from "@/lib/shared/tdee";
import type { MacroTotals, TargetDto } from "@/lib/types";

import { buildFuelView, type MacroReadout } from "./calibration";

const styles = StyleSheet.create({
  figureRow: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  figure: { ...tnum, color: color.ink, fontSize: 30, fontWeight: "600" },
  figureTail: { ...tnum, color: color.muted, fontSize: 14, flexShrink: 1 },

  macros: { marginTop: space.md, gap: 10 },

  /*
   * A logged-but-untargeted macro. Deliberately NOT a bar with an empty track:
   * that is the bug this card exists to fix. The row is the same height as a
   * `MacroBar` so the three macros stay on one rhythm — the 6pt track plus its
   * 6pt top margin is replaced by 12pt of nothing.
   */
  loggedRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  loggedLabel: { color: color.muted, fontSize: 14 },
  loggedValue: { ...tnum, color: color.ink, fontSize: 14, fontWeight: "500" },
  /** "no target yet", muted and small, where the "/ 300g" would have been. */
  loggedTail: { color: color.muted, fontSize: 12, fontWeight: "400" },

  note: {
    marginTop: space.lg,
    paddingTop: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  noteBody: { color: color.muted, fontSize: 12, lineHeight: 18 },
  /*
   * The one line that tells the user what to do, in ink rather than muted.
   * `accentSoft` with no border: an instruction, not a button — there is
   * nothing here to press, and anything that looks pressable and is not costs
   * the user a tap to find out.
   */
  action: {
    marginTop: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: color.accentSoft,
  },
  actionText: { color: color.accentInk, fontSize: 13, lineHeight: 19 },
  progress: { marginTop: space.md },
});

/**
 * The day's totals, and an honest account of which of them have a target.
 *
 * Replaces the three unconditional `MacroBar`s this card used to be. Protein
 * keeps its bar because protein genuinely has a target from day one; carbs,
 * fat and kcal get one during the 21-day calibration (§5.5 of SPEC.md) and not
 * before, and before then they are figures with no track behind them.
 *
 * Every decision about *which* of those applies lives in `calibration.ts` and
 * is unit-tested there. This file only draws. That split is the only way any of
 * it is verifiable in a container with no simulator.
 */
export function FuelCard({ label, totals, target, tdee }: {
  /** "today", "yesterday", "4d ago" — the same word the stepper shows. */
  label: string;
  totals: MacroTotals;
  target: TargetDto;
  /**
   * From the cached `bootstrap` payload, or `null` when there is none. Only
   * ever used to say how far through calibration the user is, so `null` costs
   * the count and nothing else.
   */
  tdee: TdeeResult | null;
}) {
  const view = buildFuelView(totals, target, tdee);

  return (
    <Card>
      <Label>{label}</Label>

      <View style={styles.figureRow}>
        <Text style={styles.figure}>{view.kcal.value}</Text>
        <Text style={styles.figureTail}>{view.kcal.tail}</Text>
      </View>

      <View style={styles.macros}>
        {view.macros.map((macro) => <MacroRow key={macro.label} macro={macro} />)}
      </View>

      {view.calibration !== null && (
        <View style={styles.note}>
          <Label>{view.calibration.badge}</Label>
          <Text style={styles.noteBody}>{view.calibration.body}</Text>

          {view.calibration.progress !== null && (
            <View style={styles.progress}>
              {/*
                `MacroBar` rather than a second progress primitive. It is
                already a labelled figure over a filled track with the right
                track height, radius and tabular numerals — which is exactly
                what a "6 of 8" reads as — and the unit is blank so it renders
                "6 / 8" rather than "6g / 8g". `calibration.ts` guarantees
                `have < needed` whenever this is non-null, so the fill cannot
                cross the 105% line where MacroBar turns `warn` for being over.
              */}
              <MacroBar
                label="Weigh-ins"
                value={view.calibration.progress.have}
                target={view.calibration.progress.needed}
                unit=""
              />
            </View>
          )}

          {view.calibration.action !== null && (
            <View style={styles.action}>
              <Text style={styles.actionText}>{view.calibration.action}</Text>
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

function MacroRow({ macro }: { macro: MacroReadout }) {
  if (macro.kind === "targeted") {
    return (
      <MacroBar label={macro.label} value={macro.value} target={macro.target} tone={macro.tone} />
    );
  }

  return (
    <View style={styles.loggedRow}>
      <Text style={styles.loggedLabel}>{macro.label}</Text>
      <Text style={styles.loggedValue}>
        {Math.round(macro.value)}g
        <Text style={styles.loggedTail}>{"  no target yet"}</Text>
      </Text>
    </View>
  );
}
