import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  BarSeries, Button, Card, Chart, Empty, Label, RangeBar, Screen, Sparkline, Spinner,
  Stat, color, hit, microLabel, space, tnum,
} from "@/components/ui";
import { tapSelect } from "@/lib/haptics";

import { NavLine } from "./NavLine";
import { buildTodayModel } from "./model";
import type { IntakePanel, StrengthRow, TargetRow, WeightPanel } from "./model";
import { useBootstrap } from "./useBootstrap";
import { verdict } from "./verdict";
import { volumeBlock } from "./volume";
import type { LiftDayCell, LiftDayGrid, VolumeBlock, VolumeRow } from "./volume";

/** Panel heights. Fixed; only the widths are measured. */
const WEIGHT_H = 76;
const INTAKE_H = 56;
const SPARK_H = 32;
const MILES_H = 20;

/**
 * The sets-per-muscle row's two fixed columns. The label column's width is also
 * the axis row's left inset, so the `0 / 10 / 20` sit under the track they
 * describe rather than under the muscle names.
 */
const LABEL_W = 96;
const VALUE_W = 36;

/** One cell of the lift-day grid. 10pt is legible and 56 of them fit a card. */
const CELL_H = 10;

/**
 * How many tracked targets the dashboard shows.
 *
 * Three, because this is a glance and the full list — with each target's own
 * sentence under it as provenance — is one tap away on You. The NavLine says
 * which of the two it is going to.
 */
const TODAY_GOAL_ROWS = 3;

/** React Native takes a percentage string verbatim. */
const leftPct = (fraction: number): `${number}%` =>
  `${Math.max(0, Math.min(1, fraction)) * 100}%`;

const CELL_FILL: Record<LiftDayCell["state"], string> = {
  lifted: color.accent,
  past: color.line,
  // A day that has not happened yet draws nothing at all. Grey would read as a
  // day the owner failed to train, which is the one thing it is not.
  future: "transparent",
};

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

  /* ---------------------------------------- sets per muscle, and lift days */

  /*
   * The two sentences that answer "what's the y axis". 12pt muted rather than
   * a `Label`, because it is a sentence and not a micro-label, and it is always
   * rendered — including in both empty states, where the owner is most likely
   * to be reading the card for the first time.
   */
  explain: { color: color.muted, fontSize: 12, lineHeight: 18, marginBottom: space.md },

  /*
   * ONE axis row per card, inset to the track. Eighteen copies of "0 10 20" is
   * precisely the noise the chart this replaced had.
   */
  axisRow: {
    height: 14,
    marginLeft: LABEL_W + space.sm,
    marginRight: VALUE_W + space.sm,
    marginBottom: space.xs,
  },
  /*
   * Each tick label is a 24pt box centred on its fraction, rather than
   * left-aligned at it. At `100%` a left-aligned label would start past the
   * track's right edge; centred, it sits over the edge it names. The 12pt of
   * overhang at either end falls inside the label column and the value column,
   * both of which are wider than that.
   */
  axisTick: {
    ...microLabel,
    ...tnum,
    position: "absolute",
    width: 24,
    marginLeft: -12,
    textAlign: "center",
  },

  volumeRow: { height: 28, flexDirection: "row", alignItems: "center" },
  volumeLabel: { width: LABEL_W, color: color.ink, fontSize: 13 },
  volumeTrack: {
    flex: 1,
    marginHorizontal: space.sm,
    flexDirection: "row",
    alignItems: "center",
  },
  /*
   * Always one decimal, always tabular. A column of `7`, `3.5`, `17.5` with
   * proportional digits does not line up, and the comparison between rows is
   * the entire content of this panel.
   */
  volumeValue: {
    width: VALUE_W,
    ...tnum,
    color: color.ink,
    fontSize: 13,
    textAlign: "right",
  },
  volumeFooter: { color: color.muted, fontSize: 13, lineHeight: 19, marginTop: space.sm },

  panelHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.md,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  panelEnd: { ...microLabel, ...tnum },

  gridHead: { flexDirection: "row", marginBottom: space.xs },
  gridHeadCell: { ...microLabel, flex: 1, textAlign: "center" },
  gridRow: { flexDirection: "row", marginBottom: 4 },
  gridCell: { flex: 1, height: CELL_H, borderRadius: 2, marginHorizontal: 2 },

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
 *   VOLUME      where this week's sets landed per muscle, against the range —
 *               and eight weeks of lift days beneath it.
 *   RUN MILES   eight weeks of mileage, in its own card and its own unit.
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
  /*
   * Called here rather than folded into `buildTodayModel`, for the same reason
   * `verdict()` is: `volume.ts` imports the date helpers and `LOAD_WEEKS` from
   * `model.ts`, so calling it from there would make the two mutually dependent.
   */
  const vol = volumeBlock(data);

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

        {/*
          Targets only, three at most. The aims and the split/schedule context
          that `goalsBlock` also carries are deliberately not here: Today is the
          dashboard and wants the tracked numbers, and the three-tier reading
          view — targets, what else they are working on, what the coach knows —
          lives on You, where the text is also edited. Two screens rendering the
          same prose two ways is how they come to disagree about it.
        */}
        {m.goals.targets.slice(0, TODAY_GOAL_ROWS).map((row, i) => (
          <GoalLine key={row.key} row={row} divided={i > 0} />
        ))}

        {m.goals.note !== null && <Text style={styles.muted}>{m.goals.note}</Text>}

        <NavLine onPress={goYou}>
          {m.goals.targets.length > TODAY_GOAL_ROWS ? "All your goals →" : "Edit goals →"}
        </NavLine>
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

      {/*
        What used to be here was labelled "Weekly hard sets" and drew eight
        weekly buckets of whole working sets, muscle-blind, with no y number
        anywhere on the card. The owner's complaint was exact — "I don't get
        this weekly hard sets thing. What's the y axis." Two panels replace it:
        sets per muscle against the productive range, which is the shape the
        ranking the whole app runs on already uses, and a calendar of lift days,
        which has no y axis to misread. Run miles moved to a card of their own,
        because one unit per card is the whole reason either can be read.
      */}
      <Card>
        <Label>Sets per muscle · last 7 days</Label>
        <Text style={styles.explain}>{vol.explainer}</Text>

        {vol.note !== null ? (
          <Text style={styles.muted}>{vol.note}</Text>
        ) : (
          <>
            <View style={styles.axisRow}>
              {/* Keyed by index: three fixed ticks, and a band whose lower edge
                  sat at zero would give two of them the same label. */}
              {vol.ticks.map((tick, i) => (
                <Text
                  key={i}
                  style={[styles.axisTick, { left: leftPct(tick.fraction) }]}
                >
                  {tick.label}
                </Text>
              ))}
            </View>

            {vol.rows.map((row) => (
              <MuscleRow key={row.muscle} row={row} block={vol} />
            ))}

            {vol.footer !== null && (
              <Text style={styles.volumeFooter}>{vol.footer}</Text>
            )}
          </>
        )}

        {vol.grid !== null && <LiftDays grid={vol.grid} />}

        <NavLine onPress={goLift}>{vol.navLabel}</NavLine>
      </Card>

      <Card>
        <Label>Run miles · 8 weeks</Label>
        {m.load.empty ? (
          <Text style={styles.muted}>No runs logged in eight weeks.</Text>
        ) : (
          <Chart
            height={MILES_H}
            left={m.load.xLabels.left}
            right={m.load.xLabels.right}
          >
            {(width, height) => (
              <BarSeries
                values={m.load.runMiles}
                tone="muted"
                partialIndex={m.load.partialIndex}
                width={width}
                height={height}
              />
            )}
          </Chart>
        )}
        {/*
          `BarSeries` draws the incomplete bucket at 70% and leaves the caller
          to say why. The current week is a Tuesday being compared against seven
          complete weeks, which is the easiest false signal on this screen.
        */}
        {!m.load.empty && <Text style={styles.soFar}>So far</Text>}
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

function GoalLine({ row, divided }: { row: TargetRow; divided: boolean }) {
  const tone = row.gap.tone === "good"
    ? color.good
    : row.gap.tone === "muted" ? color.muted : color.ink;

  return (
    <View style={[styles.goalRow, divided && styles.divided]}>
      <View style={styles.goalHead}>
        {/*
          The derived headline rather than the owner's sentence. The sentence is
          the provenance line on the You card, where there is room for it under
          a four-line block; here one line has to carry the target itself.
        */}
        <Text style={styles.goalSentence} numberOfLines={1}>{row.headline}</Text>
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
 * One muscle's week against the productive range.
 *
 * A meter and not a bar chart, and the distinction is the whole fix. A bar
 * chart's height means something only once you know its axis, which is what the
 * owner could not find. Here the comparison is drawn into the mark itself: the
 * band IS the answer, the fill is where this muscle sits in it, and the figure
 * on the right is the number without having to read either.
 *
 * Non-interactive on purpose. The question "which lifts would fix this" is
 * answered on the Lift tab by the card that names and ranks what is owed, which
 * the NavLine at the foot of this card goes to — eighteen tappable rows each
 * leading somewhere slightly different is how a dashboard becomes a menu.
 */
function MuscleRow({ row, block }: { row: VolumeRow; block: VolumeBlock }) {
  return (
    <View style={styles.volumeRow}>
      <Text style={styles.volumeLabel} numberOfLines={1}>{row.label}</Text>
      <View style={styles.volumeTrack}>
        <RangeBar
          value={row.sets}
          min={block.min}
          max={block.max}
          domainMax={block.domainMax}
          status={row.status}
        />
      </View>
      <Text style={styles.volumeValue}>{row.value}</Text>
    </View>
  );
}

/**
 * Eight weeks of "did I lift", as a calendar.
 *
 * Deliberately not a `Chart`: it has no measured width, no SVG and no y axis to
 * misread, which is exactly why it is the right panel for an owner who could
 * not read the bar chart it replaced. A cell is a day. It is filled or it is
 * not.
 *
 * With one logged session this is one filled cell in fifty-six and the weekday
 * header says which day — legible, honest, and the one thing on the card that
 * visibly improves every week.
 */
function LiftDays({ grid }: { grid: LiftDayGrid }) {
  return (
    <>
      <View style={styles.panelHead}>
        <Label style={{ marginBottom: 0 }}>Lift days · 8 weeks</Label>
        <Text style={styles.panelEnd}>{grid.rightLabel}</Text>
      </View>

      <View style={styles.gridHead}>
        {grid.weekdays.map((d, i) => (
          // Keyed by index: three of the seven initials repeat.
          <Text key={i} style={styles.gridHeadCell}>{d}</Text>
        ))}
      </View>

      {grid.weeks.map((week) => (
        <View key={week[0].date} style={styles.gridRow}>
          {week.map((cell) => (
            <View
              key={cell.date}
              style={[styles.gridCell, { backgroundColor: CELL_FILL[cell.state] }]}
            />
          ))}
        </View>
      ))}
    </>
  );
}
