import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card, Label, color, hit, microLabel, space, tnum } from "@/components/ui";
import { ProgressDots } from "@/components/ui/ProgressDots";
import { tapSelect } from "@/lib/haptics";

import { CalibrationRows } from "./CalibrationRows";
import type { CalibrationView, UnlockAction, UnlockCard as UnlockCardModel } from "./unlock";

/**
 * Everything Today will show once there is data, as one card of counts.
 *
 * This is what replaced the empty chart frames. Each row is a locked card,
 * its progress, and the tap that moves it; a row disappears the day its card
 * can render, and the whole card disappears when all four have. Nothing in it
 * is greyed out or drawn at zero — a locked thing is a sentence and a few
 * dots, never a chart with nothing on it.
 */

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: space.xs,
  },
  ready: { ...microLabel, ...tnum },
  row: { minHeight: hit.min, paddingVertical: space.md },
  divided: { borderTopWidth: 1, borderTopColor: color.line },
  pressed: { opacity: 0.7 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: color.ink, fontSize: 15, fontWeight: "500", flexShrink: 1 },
  chevron: { color: color.muted, fontSize: 16 },
  progress: { ...tnum, color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  dots: { marginTop: space.sm },
  footer: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: space.xs },
});

export function UnlockCard({ card, calibration, onAction }: {
  card: UnlockCardModel;
  /** The Maintenance row's two tracks. Null once maintenance is measured. */
  calibration: CalibrationView | null;
  onAction: (action: UnlockAction) => void;
}) {
  return (
    <Card>
      <View style={styles.head}>
        <Label style={{ marginBottom: 0 }}>Unlocking</Label>
        <Text style={styles.ready}>{card.readyLabel}</Text>
      </View>

      {card.rows.map((row, i) => (
        <Pressable
          key={row.key}
          accessibilityRole="button"
          accessibilityLabel={`${row.title}. ${row.progress}`}
          onPress={() => { tapSelect(); onAction(row.action); }}
          style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}
        >
          <View style={styles.titleRow}>
            <Text style={styles.title}>{row.title}</Text>
            <Text style={styles.chevron}>›</Text>
          </View>

          {row.key === "maintenance" && calibration !== null ? (
            // Two tracks with their own counts; the footer prints once below.
            <CalibrationRows view={calibration} footer={false} />
          ) : (
            <>
              <Text style={styles.progress}>{row.progress}</Text>
              <View style={styles.dots}>
                <ProgressDots filled={row.tracks[0].have} total={row.tracks[0].need} />
              </View>
            </>
          )}
        </Pressable>
      ))}

      {card.footer !== null && <Text style={styles.footer}>{card.footer}</Text>}
    </Card>
  );
}
