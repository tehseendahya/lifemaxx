import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  Button, Card, Empty, Label, MacroBar, Screen, Spinner, Stat,
  color, space, tnum,
} from "@/components/ui";
import { tapSelect } from "@/lib/haptics";

import { NavLine } from "./NavLine";
import { buildTodayModel } from "./model";
import { useBootstrap } from "./useBootstrap";

const styles = StyleSheet.create({
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  pressed: { opacity: 0.7 },

  body: { color: color.ink, fontSize: 14, lineHeight: 20 },
  muted: { color: color.muted, fontSize: 14, lineHeight: 20 },
  warn: { color: color.warn, fontSize: 14, lineHeight: 20 },
  arrow: { color: color.accent, fontSize: 16 },

  /** The card's headline figure — kcal, weekly miles. The web's `text-3xl`. */
  figureRow: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  figure: { ...tnum, color: color.ink, fontSize: 30, fontWeight: "600" },
  figureTail: { ...tnum, color: color.muted, fontSize: 14, flexShrink: 1 },

  macros: { marginTop: space.md, gap: 10 },

  muscleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.md,
    paddingTop: space.sm,
  },
  /** The web's `border-t border-line pt-2`, suppressed on the first row. */
  divided: { borderTopWidth: 1, borderTopColor: color.line, marginTop: space.sm },
  muscleLabel: { color: color.ink, fontSize: 14, fontWeight: "500", flexShrink: 1 },
  muscleFigure: { ...tnum, color: color.muted, fontSize: 12 },

  sentence: { marginTop: space.sm },
  summary: { color: color.ink, fontSize: 14, lineHeight: 20, marginBottom: space.sm },

  stats: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: space.lg },

  coachAction: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  coachGlyph: { color: color.accent, fontSize: 18 },

  centre: { paddingTop: space.xxl * 2, alignItems: "center" },
});

/**
 * Today — the landing surface, ported card-for-card from `src/app/page.tsx`.
 *
 * Same cards in the same order, because the order is an argument: the live
 * session is time-sensitive and goes above everything; fuel is what the user
 * opened the app to check; train-next is the feature that replaces a split;
 * running sits above maintenance because the half marathon is the only goal
 * with a date on it; and maintenance is last because it changes weekly, not
 * hourly.
 *
 * What is different from the web is only the plumbing: one cached `bootstrap`
 * read instead of six server-component queries, four tap targets out to the
 * tabs instead of links, and pull-to-refresh instead of a page load.
 */
export default function TodayScreen() {
  const router = useRouter();
  const { data, loading, error, refreshing, onRefresh, retry } = useBootstrap();

  const goLift = () => router.navigate("/lift");
  const goFood = () => router.navigate("/food");
  const goYou = () => router.navigate("/you");
  const goRuns = () => router.push("/runs");

  const coachButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ask the coach"
      onPress={() => { tapSelect(); router.push("/coach"); }}
      style={({ pressed }) => [styles.coachAction, pressed && styles.pressed]}
    >
      <Text style={styles.coachGlyph}>◆</Text>
    </Pressable>
  );

  /*
   * Nothing cached yet is the only state that cannot render the dashboard. Once
   * there is a payload it is rendered unconditionally, even while a refetch is
   * failing: a stale dashboard is the correct answer in a basement, and an
   * error screen over data the phone is already holding would be a regression
   * from the web app rather than an improvement on it.
   */
  if (!data) {
    return (
      <Screen title="Today" action={coachButton}>
        {loading ? (
          <View style={styles.centre}><Spinner size="large" /></View>
        ) : (
          <>
            <Empty>{error ?? "Could not load your dashboard."}</Empty>
            <Button variant="secondary" size="lg" onPress={() => { tapSelect(); retry(); }}>
              Try again
            </Button>
          </>
        )}
      </Screen>
    );
  }

  const m = buildTodayModel(data);
  const [protein, carbs, fat] = m.fuel.macros;

  return (
    <Screen
      title="Today"
      subtitle={m.dateLine}
      action={coachButton}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {m.sessionInProgress && (
        <Pressable
          accessibilityRole="button"
          onPress={() => { tapSelect(); goLift(); }}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Card tone="accent">
            <View style={styles.rowBetween}>
              <View style={{ flexShrink: 1 }}>
                <Label>Session in progress</Label>
                <Text style={styles.body}>Tap to resume logging</Text>
              </View>
              <Text style={styles.arrow}>→</Text>
            </View>
          </Card>
        </Pressable>
      )}

      <Card>
        <Label>Fuel</Label>
        <View style={styles.figureRow}>
          <Text style={styles.figure}>{m.fuel.kcal}</Text>
          <Text style={styles.figureTail}>{m.fuel.targetLine}</Text>
        </View>
        <View style={styles.macros}>
          {/*
            Protein is `good` and the other two are not: it is the only macro
            with a floor rather than a ceiling, so being at or over it is the
            thing to show as healthy. `MacroBar` turns `warn` past 105% of
            target by itself, which is what covers carbs and fat.
          */}
          <MacroBar label={protein.label} value={protein.value} target={protein.target} tone="good" />
          <MacroBar label={carbs.label} value={carbs.value} target={carbs.target} />
          <MacroBar label={fat.label} value={fat.value} target={fat.target} />
        </View>
        <NavLine onPress={goFood}>{m.fuel.mealLine}</NavLine>
      </Card>

      {/*
        This is what replaces a split. Ranked by volume debt gated on recovery,
        computed from what was actually logged — so improvising never puts it
        out of sync the way a fixed program does.
      */}
      <Card>
        <Label>Train next</Label>
        <Text style={styles.summary}>{m.trainNext.summary}</Text>
        {m.trainNext.emptyNote !== null && (
          <Text style={styles.muted}>{m.trainNext.emptyNote}</Text>
        )}
        {m.trainNext.rows.map((row, i) => (
          <View key={row.muscle} style={[styles.muscleRow, i > 0 && styles.divided]}>
            <Text style={styles.muscleLabel}>{row.label}</Text>
            <Text style={styles.muscleFigure}>{row.figure}</Text>
          </View>
        ))}
        <NavLine onPress={goLift}>{m.trainNext.liftLine}</NavLine>
      </Card>

      {m.running !== null && (
        <Pressable
          accessibilityRole="button"
          onPress={() => { tapSelect(); goRuns(); }}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Card>
            <Label>Running this week</Label>
            <View style={styles.figureRow}>
              <Text style={styles.figure}>{m.running.distanceMi}</Text>
              <Text style={styles.figureTail}>{m.running.detail}</Text>
            </View>
            {m.running.warning !== null ? (
              <Text style={[styles.warn, styles.sentence]}>{m.running.warning}</Text>
            ) : (
              <Text style={[styles.muted, styles.sentence]}>{m.running.note}</Text>
            )}
            <NavLine onPress={goRuns}>See the week →</NavLine>
          </Card>
        </Pressable>
      )}

      <Card>
        <Label>Measured maintenance</Label>
        {m.maintenance.status === "ok" ? (
          <View style={styles.stats}>
            <Stat label="TDEE" value={m.maintenance.tdee} hint={m.maintenance.hint} />
            <Stat label="Trend" value={m.maintenance.trend} />
          </View>
        ) : (
          <Text style={styles.muted}>{m.maintenance.note}</Text>
        )}
        <NavLine onPress={goYou}>Log weight →</NavLine>
      </Card>
    </Screen>
  );
}
