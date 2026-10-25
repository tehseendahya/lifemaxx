import { StyleSheet, Text, View } from "react-native";

import {
  Button, Card, Empty, Label, Pill, Screen, Spinner, Stat,
  color, space, tnum,
} from "@/components/ui";
import { tapSelect } from "@/lib/haptics";
// Imported from the module rather than through `@/features/today`, so the Runs
// screen does not drag the Today screen in behind the hook.
import { useBootstrap } from "@/features/today/useBootstrap";

import { buildRunsModel } from "./model";
import type { RunRow, TrendNote } from "./model";

const styles = StyleSheet.create({
  /*
   * Six stats in two rows of three. `flexBasis: "30%"` rather than a third of
   * the width exactly: `Stat`'s hint is a short phrase that must not wrap, and
   * leaving the gap to `gap` instead of to the basis is what keeps the three
   * columns aligned between the two rows.
   */
  stats: { flexDirection: "row", flexWrap: "wrap", rowGap: space.md, columnGap: space.md },
  stat: { flexBasis: "30%", flexGrow: 1 },

  divider: {
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },

  body: { color: color.ink, fontSize: 14, lineHeight: 20 },
  muted: { color: color.muted, fontSize: 14, lineHeight: 20 },
  good: { color: color.good },
  warn: { color: color.warn },

  hitRow: { ...tnum, color: color.muted, fontSize: 12, marginTop: space.xs },
  footnote: { color: color.muted, fontSize: 12, marginTop: space.sm, lineHeight: 17 },

  runHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  runName: { color: color.ink, fontSize: 14, fontWeight: "500", flexShrink: 1 },
  runDate: { ...tnum, color: color.muted, fontSize: 12 },
  figures: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: space.md,
    rowGap: 2,
    marginTop: space.sm,
    alignItems: "center",
  },
  figure: { ...tnum, color: color.muted, fontSize: 14 },
  verdict: { color: color.ink, fontSize: 14, lineHeight: 20, marginTop: space.sm },

  /** Lighter than `divider`: these rows are a compact list, not card sections. */
  weekDivider: {
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  weekRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.md,
    minHeight: 32,
  },
  weekStart: { ...tnum, color: color.muted, fontSize: 12 },
  weekFigure: { ...tnum, color: color.ink, fontSize: 14 },
  weekPace: { color: color.muted },

  sectionLabel: { marginTop: space.sm },
  centre: { paddingTop: space.xxl * 2, alignItems: "center" },
});

/**
 * Running, on its own screen — ported from `src/app/runs/page.tsx`.
 *
 * Pushed from the Today card rather than given a tab: you review runs weekly
 * and you never log one, so a permanent sixth of the tab bar would be spent on
 * the screen opened least. Being a stack push inside the Today tab means the
 * back gesture works and the tab bar does not move.
 *
 * Read-only by design. Runs arrive from the Strava pull and the Health Auto
 * Export webhook; there is no manual entry, no edit and no delete here, and
 * tapping a run does nothing because there is no run-detail endpoint to push to.
 */
export default function RunsScreen() {
  const { data, loading, error, refreshing, onRefresh, retry } = useBootstrap();

  // Runs is pushed from Today, so in practice `bootstrap` is already cached and
  // this branch never renders. It still has to exist: deep-linking straight to
  // /runs, or a process restart with the screen in the stack, both arrive here
  // with an empty cache.
  if (!data) {
    return (
      <Screen title="Running">
        {loading ? (
          <View style={styles.centre}><Spinner size="large" /></View>
        ) : (
          <>
            <Empty>{error ?? "Could not load your runs."}</Empty>
            <Button variant="secondary" size="lg" onPress={() => { tapSelect(); retry(); }}>
              Try again
            </Button>
          </>
        )}
      </Screen>
    );
  }

  const m = buildRunsModel(data);

  if (m.isEmpty) {
    return (
      <Screen title="Running" refreshing={refreshing} onRefresh={onRefresh}>
        <Empty>
          No runs yet. Connect Strava in Settings and they arrive on the nightly pull.
        </Empty>
      </Screen>
    );
  }

  return (
    <Screen
      title="Running"
      subtitle={m.subtitle}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <Card>
        <Label>This week</Label>
        <View style={styles.stats}>
          {m.week.map((stat) => (
            <View key={stat.label} style={styles.stat}>
              <Stat label={stat.label} value={stat.value} hint={stat.hint} />
            </View>
          ))}
        </View>
        <View style={styles.divider}>
          <TrendLine note={m.trend} />
        </View>
      </Card>

      {m.interference !== null && (
        <Card>
          <Label>Running into lifting</Label>
          <Text style={styles.body}>{m.interference.headline}</Text>
          {m.interference.rows.map((row) => (
            <Text key={row.key} style={styles.hitRow}>{row.text}</Text>
          ))}
          <Text style={styles.footnote}>{m.interference.footnote}</Text>
        </Card>
      )}

      <Label>Runs</Label>
      {m.runs.map((run) => <RunCard key={run.id} run={run} />)}

      {/*
        Absent on an account whose only runs are this week: a single-row
        "earlier weeks" card that repeats the number at the top of the screen
        is worse than no card.
      */}
      {m.history.length > 1 && (
        <>
          <Label style={styles.sectionLabel}>Earlier weeks</Label>
          <Card>
            {m.history.map((week, i) => (
              <View key={week.weekStart} style={[styles.weekRow, i > 0 && styles.weekDivider]}>
                <Text style={styles.weekStart}>{week.weekStart}</Text>
                <Text style={styles.weekFigure}>
                  {week.distanceMi} mi
                  {week.runs > 0 && <Text style={styles.weekPace}>  ·  {week.avgPace}/mi</Text>}
                </Text>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

function TrendLine({ note }: { note: TrendNote }) {
  if (note.figure === null) return <Text style={styles.muted}>{note.lead}</Text>;

  return (
    <Text style={styles.muted}>
      {note.lead}
      <Text style={note.tone === "good" ? styles.good : styles.warn}>{note.figure}</Text>
      {note.tail}
    </Text>
  );
}

/**
 * The effort is a `Pill` with its text in a token colour rather than a coloured
 * pill: `Pill` has no tone of its own, and nesting a `<Text>` inside it keeps
 * the tabular numerals it already sets while picking up the web's
 * hard-is-`warn`, long-is-`accent` coding. An easy run stays muted, which is
 * the point — it is the case you do not need to look at.
 */
const EFFORT_STYLE = StyleSheet.create({
  easy: { color: color.muted },
  hard: { color: color.warn },
  long: { color: color.accent },
});

function RunCard({ run }: { run: RunRow }) {
  return (
    <Card>
      <View style={styles.runHead}>
        <Text style={styles.runName} numberOfLines={1}>{run.name}</Text>
        <Text style={styles.runDate}>{run.date}</Text>
      </View>
      <View style={styles.figures}>
        {run.figures.map((figure, i) => (
          <Text key={i} style={styles.figure}>{figure}</Text>
        ))}
        <Pill><Text style={EFFORT_STYLE[run.effort]}>{run.effort}</Text></Pill>
      </View>
      {run.verdict !== null && <Text style={styles.verdict}>{run.verdict}</Text>}
    </Card>
  );
}
