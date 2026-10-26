import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  BarSeries, Button, Card, Chart, Columns, Empty, Label, Pill, RangeBar, Screen, Sparkline, Spinner,
  Stat, color, hit, microLabel, space, tnum,
} from "@/components/ui";
import { useIsWide } from "@/lib/layout";
import { tapSelect } from "@/lib/haptics";
/*
 * Read-only, and the plan's one cross-feature import on this screen: the Lift
 * tab's Main lifts card and Today's Big lifts are the same rows with the same
 * goal chip, and two copies of "which goal targets this lift" would disagree.
 */
import { mainLiftRows } from "@/features/lift/next";
import type { MainLiftRow } from "@/features/lift/next";

import { bodyCard } from "./body";
import type { BodyCard } from "./body";
import { goalMeter } from "./goal-meter";
import { GoalRow } from "./GoalRow";
import { HeroCard } from "./HeroCard";
import { dailyChecks, heroAction, owedChips } from "./hero";
import type { CheckKey } from "./hero";
import { buildTodayModel } from "./model";
import type { WeightPanel } from "./model";
import { NavLine } from "./NavLine";
import { UnlockCard } from "./UnlockCard";
import { calibrationView, cardVisibility, unlockCard } from "./unlock";
import type { UnlockAction } from "./unlock";
import { useBootstrap } from "./useBootstrap";
import { verdict } from "./verdict";
import { liftDayGrid, volumeBlock } from "./volume";
import type { LiftDayCell, LiftDayGrid, VolumeBlock, VolumeRow } from "./volume";
import { WeighInPad } from "./WeighInPad";

/** Panel heights. Fixed; only the widths are measured. */
const WEIGHT_H = 76;
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
 * How many tracked targets the dashboard shows. Three, because this is a
 * glance; the full list, each with the owner's own sentence under it, is one
 * tap away on You.
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
  muted: { color: color.muted, fontSize: 13, lineHeight: 19 },

  section: { marginTop: space.lg, marginBottom: space.sm },
  // Heads the right-hand column on a laptop, level with the top of the hero.
  sectionWide: { marginTop: 0 },

  statRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.lg,
    marginBottom: space.md,
  },
  statCol: { flexShrink: 1 },
  sentence: { fontSize: 13, lineHeight: 19 },

  /*
   * The raw weigh-ins are drawn in a second SVG stacked on the first, rather
   * than as dots on the fitted line's own series. They are two different things
   * — one is a measurement, one is a model — and they do not share x positions.
   */
  overlay: { position: "absolute", left: 0, top: 0 },

  strengthRow: { minHeight: hit.min, paddingVertical: space.sm },
  divided: { borderTopWidth: 1, borderTopColor: color.line },
  strengthHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.md,
  },
  strengthName: { color: color.ink, fontSize: 14, flexShrink: 1 },
  strengthRight: { flexDirection: "row", alignItems: "center", gap: space.sm },
  strengthFigure: { ...tnum, color: color.ink, fontSize: 14, fontWeight: "500" },
  strengthSingle: { ...tnum, color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },

  soFar: { ...microLabel, textAlign: "right" },

  /* ---------------------------------------- sets per muscle, and lift days */

  explainRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    marginBottom: space.sm,
  },
  explain: { color: color.muted, fontSize: 12, lineHeight: 18, flexShrink: 1 },
  howToggle: { minHeight: hit.min, justifyContent: "center" },
  howToggleText: { color: color.accent, fontSize: 12 },
  howText: { color: color.muted, fontSize: 12, lineHeight: 18, marginBottom: space.md },

  axisRow: {
    height: 14,
    marginLeft: LABEL_W + space.sm,
    marginRight: VALUE_W + space.sm,
    marginBottom: space.xs,
  },
  /*
   * Each tick label is a 24pt box centred on its fraction, rather than
   * left-aligned at it, so the label at `100%` sits over the edge it names.
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
    marginTop: space.lg,
  },

  coachAction: { width: hit.min, height: hit.min, alignItems: "center", justifyContent: "center" },
  coachGlyph: { color: color.accent, fontSize: 18 },
  centre: { paddingTop: space.xxl * 2, alignItems: "center" },
});

/**
 * Today — "what do I do today", then "how am I progressing".
 *
 * One hero card answers the first: the verdict sentence, the owed muscles as
 * chips, one button, and three daily marks (weigh in, food, train) that each
 * open the thing that fills them. Everything under the PROGRESS label answers
 * the second.
 *
 * The progress section follows one rule, which is the fix for the owner's
 * "odd empty graphs": a card appears when it has something true to say, and
 * not before. Until then its row sits in the Unlocking card with a count and
 * the tap that moves it. There is no empty chart frame anywhere on this
 * screen, and no "nothing logged" card — `cardVisibility` decides, and is
 * asserted in `unlock.test.ts` at day zero, day three and calibrated.
 *
 * Every figure comes out of a pure, tested module (`hero.ts`, `unlock.ts`,
 * `body.ts`, `goal-meter.ts`, `model.ts`, `volume.ts`, `verdict.ts`). This
 * file only lays them out.
 */
export default function TodayScreen() {
  const router = useRouter();
  const wide = useIsWide();
  const { data, loading, error, refreshing, onRefresh, retry } = useBootstrap();

  const [pad, setPad] = useState(false);
  /** A weigh-in typed here, shown on the mark until the refetch lands. */
  const [justLogged, setJustLogged] = useState<number | null>(null);
  const [weighError, setWeighError] = useState<string | null>(null);

  const goLift = () => router.navigate("/lift");
  const goFood = () => router.navigate("/food");
  const goYou = () => router.navigate("/you");
  const goRuns = () => router.push("/runs");
  const goCoach = () => router.push("/coach");

  const openPad = () => { setWeighError(null); setPad(true); };

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
   * failing: a stale dashboard is the correct answer in a basement.
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
  const show = cardVisibility(data);
  const unlock = unlockCard(data);
  const calibration = calibrationView(data);
  const body = bodyCard(data);
  /*
   * Called here rather than folded into `buildTodayModel`, for the same reason
   * `verdict()` is: `volume.ts` imports the date helpers from `model.ts`, so
   * calling it from there would make the two mutually dependent.
   */
  const vol = volumeBlock(data);
  const lifts = mainLiftRows(data);
  const goals = m.goals.targets.slice(0, TODAY_GOAL_ROWS).map((row) => goalMeter(row, data));

  /*
   * The optimistic weigh-in is dropped as soon as the payload has today's
   * reading — otherwise a later correction on the laptop would be hidden behind
   * the number typed here.
   */
  const todayLogged = data.history.days.some((d) => d.date === data.today && d.weightLb !== null);
  const checks = dailyChecks(data, todayLogged ? null : justLogged);

  const onCheck = (key: CheckKey) => {
    if (key === "weigh") openPad();
    else if (key === "food") goFood();
    else goLift();
  };

  const onUnlock = (action: UnlockAction) => {
    if (action === "weigh") openPad();
    else if (action === "food") goFood();
    else goLift();
  };

  return (
    <Screen
      title="Today"
      subtitle={m.dateLine}
      action={coachButton}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {/*
        On a laptop: the call and today's checks on the left, everything under
        Progress on the right. On the phone, the same cards in the same order.
      */}
      <Columns
        left={
          <HeroCard
            call={call}
            chips={owedChips(data)}
            action={heroAction(data, call)}
            checks={checks}
            error={weighError}
            onAction={goLift}
            onCheck={onCheck}
            onCoach={goCoach}
      />

        }
        right={
      <>
      <Label style={[styles.section, wide && styles.sectionWide]}>Progress</Label>

      {unlock !== null && (
        <UnlockCard card={unlock} calibration={calibration} onAction={onUnlock} />
      )}

      {show.body && body !== null && <BodySection card={body} />}

      <Card>
        <Label>Goals</Label>

        {m.goals.empty !== null && (
          <>
            <Text style={styles.muted}>{m.goals.empty}</Text>
            <NavLine onPress={goYou}>Write your goals →</NavLine>
          </>
        )}

        {/*
          Targets only, three at most, as meters. The aims and the coach's
          context live on You, where the text is also edited — two screens
          rendering the same prose two ways is how they come to disagree.
        */}
        {goals.map((row, i) => <GoalRow key={row.key} row={row} divided={i > 0} />)}

        {m.goals.note !== null && <Text style={styles.muted}>{m.goals.note}</Text>}

        {m.goals.empty === null && (
          <NavLine onPress={goYou}>
            {m.goals.targets.length > TODAY_GOAL_ROWS ? "All goals →" : "Edit goals →"}
          </NavLine>
        )}
      </Card>

      {show.bigLifts && lifts.length > 0 && (
        <Card>
          <Label>Big lifts</Label>
          {lifts.map((row, i) => (
            <LiftLine
              key={row.exerciseId}
              row={row}
              divided={i > 0}
              onPress={() => {
                tapSelect();
                router.push({ pathname: "/exercise", params: { id: row.exerciseId } });
              }}
            />
          ))}
        </Card>
      )}

      {show.setsPerMuscle && <VolumeSection block={vol} onLift={goLift} />}

      {show.thisMonth && (
        <Card>
          <Label>This month</Label>
          <LiftDays grid={liftDayGrid(data)} />
          <View style={styles.consistency}>
            {m.consistency.stats.map((s) => (
              <Stat key={s.label} label={s.label} value={s.value} hint={s.hint} />
            ))}
          </View>
        </Card>
      )}

      {show.runMiles && (
        <Card>
          <Label>Run miles · 8 weeks</Label>
          <Chart height={MILES_H} left={m.load.xLabels.left} right={m.load.xLabels.right}>
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
          {/*
            `BarSeries` draws the incomplete bucket at 70% and leaves the caller
            to say why: the current week is a Tuesday against seven full weeks.
          */}
          <Text style={styles.soFar}>So far</Text>
          <NavLine onPress={goRuns}>See the running week →</NavLine>
        </Card>
      )}
      </>
        }
      />

      <WeighInPad
        visible={pad}
        onClose={() => setPad(false)}
        onCommitted={(lb) => { setWeighError(null); setJustLogged(lb); }}
        onFailed={(message) => { setJustLogged(null); setWeighError(message); }}
      />
    </Screen>
  );
}

/**
 * Body: trend weight, rate, maintenance once measured, one chart, one sentence.
 *
 * No intake chart. Pounds and kilocalories on one screen were two panels in two
 * units, and the second only ever said one thing — whether intake sits above or
 * below maintenance — which the sentence says in words.
 */
function BodySection({ card }: { card: BodyCard }) {
  return (
    <Card>
      <Label>{card.label}</Label>
      <View style={styles.statRow}>
        {card.stats.map((s) => (
          <View key={s.label} style={styles.statCol}>
            <Stat label={s.label} value={s.value} hint={s.hint} />
          </View>
        ))}
      </View>
      <WeightChart panel={card.chart} left={card.xLabels.left} right={card.xLabels.right} />
      {card.sentence !== null && (
        <Text
          style={[
            styles.sentence,
            { color: card.sentence.tone === "warn" ? color.warn : color.muted },
          ]}
        >
          {card.sentence.text}
        </Text>
      )}
    </Card>
  );
}

/**
 * Bodyweight: the OLS fit as the only continuous mark, raw weigh-ins as marks.
 *
 * Two SVGs rather than one series with dots, because they are not one series.
 * Joining the circles would draw a second, worse model on top of the first and
 * imply a weight for every day between two weigh-ins eight days apart.
 */
function WeightChart({ panel, left, right }: { panel: WeightPanel; left: string; right: string }) {
  return (
    <Chart height={WEIGHT_H} left={left} right={right}>
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
 * One big lift: its figure and a door to the screen with the real axes.
 *
 * One session is a figure and a sentence ("First session 20 Oct. The trend
 * starts with your next one."), never a one-point chart. From two, the delta,
 * the goal chip and a 32pt sparkline — a sparkline is for the shape, and the
 * screen one tap away answers "what exactly".
 */
function LiftLine(
  { row, divided, onPress }: { row: MainLiftRow; divided: boolean; onPress: () => void },
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
        {row.single ? (
          <Text style={styles.strengthFigure}>e1RM {row.values[0]} lb</Text>
        ) : (
          <View style={styles.strengthRight}>
            {row.goal !== null && <Pill>{row.goal}</Pill>}
            <Text style={[styles.strengthFigure, { color: tone }]}>{row.deltaLabel}</Text>
          </View>
        )}
      </View>
      {row.single ? (
        <Text style={styles.strengthSingle}>{row.singleLine}</Text>
      ) : (
        <Chart height={SPARK_H}>
          {(width, height) => <Sparkline values={row.values} width={width} height={height} />}
        </Chart>
      )}
    </Pressable>
  );
}

/**
 * Sets per muscle, last 7 days. The owner likes it; this is polish only — the
 * explainer is one line, and the weighting is behind "How it's counted".
 */
function VolumeSection({ block, onLift }: { block: VolumeBlock; onLift: () => void }) {
  const [how, setHow] = useState(false);

  return (
    <Card>
      <Label>Sets per muscle · last 7 days</Label>
      <View style={styles.explainRow}>
        <Text style={styles.explain}>{block.explainer}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: how }}
          onPress={() => { tapSelect(); setHow(!how); }}
          style={({ pressed }) => [styles.howToggle, pressed && styles.pressed]}
        >
          <Text style={styles.howToggleText}>{how ? "Hide" : "How it's counted"}</Text>
        </Pressable>
      </View>
      {how && <Text style={styles.howText}>{block.howCounted}</Text>}

      {block.note !== null ? (
        <Text style={styles.muted}>{block.note}</Text>
      ) : (
        <>
          <View style={styles.axisRow}>
            {/* Keyed by index: three fixed ticks, two of which could share a label. */}
            {block.ticks.map((tick, i) => (
              <Text key={i} style={[styles.axisTick, { left: leftPct(tick.fraction) }]}>
                {tick.label}
              </Text>
            ))}
          </View>

          {block.rows.map((row) => <MuscleRow key={row.muscle} row={row} block={block} />)}

          {block.footer !== null && <Text style={styles.volumeFooter}>{block.footer}</Text>}
        </>
      )}

      <NavLine onPress={onLift}>{block.navLabel}</NavLine>
    </Card>
  );
}

/**
 * One muscle's week against the productive range. A meter, not a bar chart:
 * the band IS the answer, the fill is where this muscle sits in it, and the
 * figure on the right is the number without having to read either.
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
 * Eight weeks of "did I lift", as a calendar. A cell is a day; it is filled or
 * it is not. Weigh-in days are not marked — one meaning per cell.
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
