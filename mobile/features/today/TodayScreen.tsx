import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  BarSeries, Button, Card, Chart, Empty, Label, Screen, Sparkline, Spinner, Stat,
  color, hit, microLabel, space, tnum,
} from "@/components/ui";
import { tapSelect } from "@/lib/haptics";

import { NavLine } from "./NavLine";
import { buildTodayModel } from "./model";
import type { GoalRow, IntakePanel, LoadBlock, StrengthRow, WeightPanel } from "./model";
import { useBootstrap } from "./useBootstrap";
import { verdict } from "./verdict";

/** Panel heights. Fixed; only the widths are measured. */
const WEIGHT_H = 76;
const INTAKE_H = 56;
const SPARK_H = 32;
const SETS_H = 60;
const MILES_H = 20;

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  arrow: { color: color.accent, fontSize: 16 },
  body: { color: color.ink, fontSize: 14, lineHeight: 20 },
  muted: { color: color.muted, fontSize: 13, lineHeight: 19 },

  /*
   * The verdict is a bare block rather than a `Card`. It is the answer, not a
   * readout: putting it on the same surface as the five cards below would make
   * it the first of six equal things instead of the one the other five are
   * evidence for. The 2pt accent rule is the whole chrome it gets.
   */
  verdictPress: { minHeight: hit.min, marginBottom: space.lg },
  verdictBlock: {
    borderLeftWidth: 2,
    borderLeftColor: color.accent,
    paddingLeft: space.lg,
  },
  verdictText: { ...tnum, fontSize: 17, lineHeight: 24 },

  statRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.lg,
    marginBottom: space.md,
  },
  statCol: { flexShrink: 1 },

  /** The shared x axis under the trajectory card's two panels. */
  axis: {
    height: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.xs,
  },
  axisLabel: { ...microLabel, ...tnum },

  /*
   * The raw weigh-ins are drawn in a second SVG stacked on the first, rather
   * than as dots on the fitted line's own series. They are two different things
   * — one is a measurement, one is a model — and they do not share x positions:
   * the fit has two endpoints and the observations have as many as there are
   * weigh-ins.
   */
  overlay: { position: "absolute", left: 0, top: 0 },

  goalRow: { paddingVertical: space.sm },
  divided: { borderTopWidth: 1, borderTopColor: color.line },
  goalHead: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  goalSentence: { color: color.ink, fontSize: 14, flexShrink: 1 },
  goalGap: { ...tnum, fontSize: 12, marginTop: 2 },
  deadline: { ...microLabel, ...tnum },
  restLine: { color: color.muted, fontSize: 13, lineHeight: 19, paddingVertical: 2 },

  strengthRow: { minHeight: hit.min, paddingVertical: space.sm },
  strengthHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.md,
  },
  strengthName: { color: color.ink, fontSize: 14, flexShrink: 1 },
  strengthDelta: { ...tnum, fontSize: 14, fontWeight: "500" },

  /*
   * The "SO FAR" marker under the current week's bar. Positioned from the right
   * because that is where the partial bucket always is — the alternative is
   * computing a bar width in the screen, which is exactly what `BarSeries`
   * exists to keep out of feature code.
   */
  soFar: { ...microLabel, textAlign: "right" },

  consistency: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: space.md,
  },
  note: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: space.md },

  coachAction: { width: hit.min, height: hit.min, alignItems: "center", justifyContent: "center" },
  coachGlyph: { color: color.accent, fontSize: 18 },
  centre: { paddingTop: space.xxl * 2, alignItems: "center" },
});

/**
 * Today — a dashboard rather than a digest.
 *
 * What this screen used to do was restate the Food tab's macros, the Lift tab's
 * owed-muscle rows and the Runs tab's weekly mileage, three taps away from all
 * three. The owner's words were "it just repeats things". Nothing on this screen
 * now prints today's kcal, today's protein, or a per-muscle `n/10 sets` row.
 *
 * What is here instead is the four things that only exist because this app holds
 * every half of the data at once, composed into one screen rather than four:
 *
 *   TRAJECTORY  where the body is going — bodyweight against measured intake,
 *               the one measurement no other tab shows at all.
 *   GOALS       what the owner wrote down, and the arithmetic distance to it.
 *   STRENGTH    whether the lifts are actually moving.
 *   LOAD        whether the work is going in, week over week.
 *
 * And above all of them, one sentence that says what to do in the next hour,
 * because four concepts of equal weight is soup: one has to be the headline.
 *
 * Every figure on this screen comes out of `model.ts`, `verdict.ts` or
 * `goals.ts`, all three of which are pure and unit-tested. There is no
 * simulator in this container, so that is deliberate: the layout below is the
 * only part nobody has watched run.
 */
export default function TodayScreen() {
  const router = useRouter();
  const { data, loading, error, refreshing, onRefresh, retry } = useBootstrap();

  const goLift = () => router.navigate("/lift");
  const goYou = () => router.navigate("/you");
  const goRuns = () => router.push("/runs");
  const goCoach = () => router.push("/coach");

  const coachButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ask the coach"
      onPress={() => { tapSelect(); goCoach(); }}
      style={({ pressed }) => [styles.coachAction, pressed && styles.pressed]}
    >
      <Text style={styles.coachGlyph}>◆</Text>
    </Pressable>
  );

  /*
   * Nothing cached yet is the only state that cannot render the dashboard. Once
   * there is a payload it renders unconditionally, even while a refetch is
   * failing: a stale dashboard is the correct answer in a basement, and an
   * error screen over data the phone is already holding would be a regression.
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
  const call = verdict(data);
  const t = m.trajectory;

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

      {/*
        The sentence is the opening of a conversation, not a readout, so the
        whole block is the door to the coach rather than carrying a button.
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ask the coach about this"
        onPress={() => { tapSelect(); goCoach(); }}
        style={({ pressed }) => [styles.verdictPress, pressed && styles.pressed]}
      >
        <View style={styles.verdictBlock}>
          <Label>Today</Label>
          <Text
            style={[
              styles.verdictText,
              { color: call.tone === "warn" ? color.warn : color.ink },
            ]}
          >
            {call.text}
          </Text>
        </View>
      </Pressable>

      <Card>
        <Label>Trajectory · 28 days</Label>

        <View style={styles.statRow}>
          <View style={styles.statCol}>
            <Stat label="TREND" value={t.trendLabel ?? "—"} />
          </View>
          <View style={styles.statCol}>
            {t.maintenance.kind === "ok" ? (
              <Stat
                label="MAINTENANCE"
                value={t.maintenance.value}
                hint={t.maintenance.hint}
              />
            ) : (
              <Text style={styles.muted}>{t.maintenance.note}</Text>
            )}
          </View>
        </View>

        {t.weight !== null ? (
          <WeightChart panel={t.weight} />
        ) : (
          <>
            <Text style={styles.muted}>{t.weightNote}</Text>
            <NavLine onPress={goYou}>Log weight →</NavLine>
          </>
        )}

        {t.intake !== null && <IntakeChart panel={t.intake} />}

        {(t.weight !== null || t.intake !== null) && (
          <View style={styles.axis}>
            <Text style={styles.axisLabel}>{t.xLabels.left}</Text>
            <Text style={styles.axisLabel}>{t.xLabels.right}</Text>
          </View>
        )}
      </Card>

      <Card>
        <Label>Goals</Label>

        {m.goals.empty !== null && <Text style={styles.muted}>{m.goals.empty}</Text>}

        {m.goals.rows.map((row, i) => (
          <GoalLine key={row.key} row={row} divided={i > 0} />
        ))}

        {m.goals.note !== null && <Text style={styles.muted}>{m.goals.note}</Text>}

        {m.goals.rest.length > 0 && (
          <View style={{ marginTop: space.md }}>
            <Label>Also in your goals</Label>
            {/*
              Verbatim, with no figure beside them. This is the honest half of
              the card: the app shows it has read the text without claiming it
              understood it.
            */}
            {m.goals.rest.map((line, i) => (
              <Text key={i} style={styles.restLine}>{line}</Text>
            ))}
          </View>
        )}

        <NavLine onPress={goYou}>Edit goals →</NavLine>
      </Card>

      <Card>
        <Label>Strength · 8 weeks</Label>
        {m.strength.length === 0 ? (
          <Text style={styles.muted}>
            Nothing with two logged sessions yet. Log the same lift twice and its trend
            appears here.
          </Text>
        ) : (
          m.strength.map((row, i) => (
            <StrengthLine
              key={row.exerciseId}
              row={row}
              divided={i > 0}
              onPress={() => {
                tapSelect();
                router.push({ pathname: "/exercise", params: { id: row.exerciseId } });
              }}
            />
          ))
        )}
      </Card>

      <Card>
        <Label>Weekly hard sets</Label>
        {m.load.empty ? (
          <Text style={styles.muted}>Nothing logged in eight weeks.</Text>
        ) : (
          <LoadCharts load={m.load} />
        )}
        <NavLine onPress={goRuns}>See the running week →</NavLine>
      </Card>

      <Card>
        <Label>Consistency</Label>
        <View style={styles.consistency}>
          {m.consistency.stats.map((s) => (
            <Stat key={s.label} label={s.label} value={s.value} hint={s.hint} />
          ))}
        </View>
        <Text style={styles.note}>{m.consistency.note}</Text>
      </Card>
    </Screen>
  );
}

/**
 * Bodyweight: the OLS fit as the only continuous mark, raw weigh-ins as marks.
 *
 * Two SVGs rather than one series with dots, because they are not one series.
 * The line is `weightTrend()`'s model evaluated at two points; the circles are
 * the measurements it was fitted to. Joining the circles would draw a second,
 * worse model on top of the first and imply a weight for every day between two
 * weigh-ins eight days apart.
 */
function WeightChart({ panel }: { panel: WeightPanel }) {
  return (
    <Chart
      label="Bodyweight"
      height={WEIGHT_H}
      left={panel.firstLabel}
      right={panel.lastLabel}
    >
      {(width, height) => (
        <View style={{ width, height }}>
          {panel.fit !== null && (
            <Sparkline
              values={panel.fit.values}
              xs={panel.fit.xs}
              domainX={panel.domainX}
              domain={panel.domainY}
              width={width}
              height={height}
              endDot={false}
            />
          )}
          <View style={styles.overlay}>
            <Sparkline
              mode="dots"
              values={panel.values}
              xs={panel.xs}
              domainX={panel.domainX}
              domain={panel.domainY}
              width={width}
              height={height}
            />
          </View>
        </View>
      )}
    </Chart>
  );
}

/**
 * Intake: a 7-day trailing mean against measured maintenance.
 *
 * No marker for today's partial intake. A live figure here would be restating
 * the Food tab, which is the complaint this screen exists to answer — and a
 * half-eaten day plotted against a full day's maintenance reads as a deficit
 * that is not there.
 */
function IntakeChart({ panel }: { panel: IntakePanel }) {
  return (
    <Chart
      label="Intake vs maintenance"
      height={INTAKE_H}
      right={panel.referenceLabel ?? undefined}
    >
      {(width, height) => (
        <Sparkline
          values={panel.values}
          xs={panel.xs}
          domainX={panel.domainX}
          domain={panel.domainY}
          reference={panel.reference}
          width={width}
          height={height}
        />
      )}
    </Chart>
  );
}

function GoalLine({ row, divided }: { row: GoalRow; divided: boolean }) {
  const tone = row.gap.tone === "good"
    ? color.good
    : row.gap.tone === "muted" ? color.muted : color.ink;

  return (
    <View style={[styles.goalRow, divided && styles.divided]}>
      <View style={styles.goalHead}>
        <Text style={styles.goalSentence} numberOfLines={1}>{row.sentence}</Text>
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
      <Text style={[styles.goalGap, { color: tone }]}>{row.gap.text}</Text>
    </View>
  );
}

/**
 * One lift's e1RM as a sparkline, and a door to the screen with the real axes.
 *
 * The sparkline carries no axis treatment and no tap-to-inspect layer on
 * purpose: there is no pointer on this device, and the screen one tap away
 * answers "what exactly" with numbers. A 32pt chart is for the shape.
 */
function StrengthLine(
  { row, divided, onPress }: { row: StrengthRow; divided: boolean; onPress: () => void },
) {
  const tone = row.tone === "good" ? color.good : row.tone === "warn" ? color.warn : color.muted;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.name} history`}
      onPress={onPress}
      style={({ pressed }) => [styles.strengthRow, divided && styles.divided, pressed && styles.pressed]}
    >
      <View style={styles.strengthHead}>
        <Text style={styles.strengthName} numberOfLines={1}>{row.name}</Text>
        {row.deltaLabel !== null
          ? <Text style={[styles.strengthDelta, { color: tone }]}>{row.deltaLabel}</Text>
          : <Label style={{ marginBottom: 0 }}>One session</Label>}
      </View>
      {/*
        One point draws the point and nothing else — `Sparkline` falls back to
        its terminal dot. A two-point line from a single session would be a
        fabrication, and the label beside it says so.
      */}
      <Chart height={SPARK_H}>
        {(width, height) => (
          <Sparkline values={row.values} width={width} height={height} />
        )}
      </Chart>
    </Pressable>
  );
}

/**
 * Eight weeks of working sets, and the same eight weeks of run mileage.
 *
 * Two panels, not two series on one. Sets and miles share no unit and no scale,
 * and the only thing a second y-axis would add is a crossing point that reads
 * as a finding.
 */
function LoadCharts({ load }: { load: LoadBlock }) {
  return (
    <>
      <Chart
        label="Sets"
        height={SETS_H}
        left={load.xLabels.left}
        right={load.medianLabel ?? undefined}
      >
        {(width, height) => (
          <BarSeries
            values={load.hardSets}
            reference={load.median > 0 ? load.median : null}
            partialIndex={load.partialIndex}
            width={width}
            height={height}
          />
        )}
      </Chart>
      {/*
        The current week is seven days of comparison against a Tuesday, which is
        the easiest false signal on this screen — hence the 70% bar and this.
      */}
      <Text style={styles.soFar}>So far</Text>

      <Chart label="Run miles" height={MILES_H} right={load.xLabels.right}>
        {(width, height) => (
          <BarSeries
            values={load.runMiles}
            tone="muted"
            partialIndex={load.partialIndex}
            width={width}
            height={height}
          />
        )}
      </Chart>
    </>
  );
}
