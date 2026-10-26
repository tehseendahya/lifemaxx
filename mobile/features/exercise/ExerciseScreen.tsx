import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import {
  Card, Chart, Empty, Label, Screen, Sparkline, Spinner, color, microLabel, radius, space, tnum,
} from "@/components/ui";
import { apiGet } from "@/lib/api";
import { tapSelect } from "@/lib/haptics";
import { queryKeys } from "@/lib/query";
import type { ExerciseHistory, HistorySet } from "@/lib/types";

import { extractGoalClaims } from "../today/goals";
import { useBootstrap } from "../today/useBootstrap";
import { buildExerciseView, type ProgressView, type SessionView } from "./model";

/**
 * How many sessions the screen asks for: the route's maximum. The old 8 was
 * two months of a twice-a-week lift, which is not enough span for a chart
 * whose whole job is "progression over time".
 */
const HISTORY_LIMIT = 24;

const CHART_H = 96;

const styles = StyleSheet.create({
  card: { marginBottom: space.lg },

  headline: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: space.sm,
    marginTop: space.xs,
  },
  best: { ...tnum, color: color.ink, fontSize: 24, fontWeight: "600" },
  bestUnit: { color: color.muted, fontSize: 13 },
  change: { ...tnum, fontSize: 13, fontWeight: "500" },
  good: { color: color.good },
  bad: { color: color.bad },
  span: { color: color.muted, fontSize: 13, marginBottom: space.md },
  last: { ...tnum, color: color.muted, fontSize: 12 },
  single: { color: color.muted, fontSize: 13, lineHeight: 19, marginTop: space.sm },

  sessionCard: { marginBottom: space.md },
  pressed: { opacity: 0.7 },
  sessionHead: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: space.sm,
    gap: space.sm,
  },
  date: { color: color.ink, fontSize: 14, fontWeight: "500" },
  pr: {
    ...microLabel,
    color: color.accentInk,
    borderWidth: 1,
    borderColor: color.accent,
    borderRadius: radius.sm,
    paddingHorizontal: space.xs + 2,
    paddingVertical: 1,
    overflow: "hidden",
  },
  grow: { flex: 1 },
  summary: { ...tnum, color: color.muted, fontSize: 12 },
  chevron: { color: color.muted, fontSize: 18, marginLeft: space.xs },

  setRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  /**
   * Not `Pill`: a set here carries three parts in different colours (the
   * figure, an `@rpe` in muted, an `F` in warn) and `Pill` renders one `Text`
   * with one colour. The box is the web's `rounded border border-line-strong
   * px-2 py-1 text-sm`, transcribed.
   */
  setBox: {
    borderWidth: 1,
    borderColor: color.lineStrong,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  warmupBox: { borderColor: color.line },
  setText: { ...tnum, color: color.ink, fontSize: 14 },
  warmupText: { color: color.muted },
  dim: { color: color.muted },
  warn: { color: color.warn },

  state: { color: color.muted, fontSize: 13, lineHeight: 19, paddingTop: space.lg },

  /**
   * The owner's own words, at body size and in full ink — the only thing on
   * this page that is not a figure. `lineHeight` is generous because a cue is
   * often two short lines ("elbows tucked" / "pause on chest") and the line
   * breaks they typed are preserved all the way from the database.
   */
  cue: { color: color.ink, fontSize: 15, lineHeight: 22, marginTop: space.xs },
  cueFoot: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: space.sm },
});

/**
 * One exercise's progress and history. Pushed from the live session and from
 * the strength rows, and `?id=<uuid>` rather than a dynamic segment so it
 * matches `GET /api/mobile/exercise?id=` — one convention across the stack.
 */
export default function ExerciseScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: queryKeys.exercise(id ?? ""),
    queryFn: () => apiGet<ExerciseHistory>(
      `/api/mobile/exercise?id=${encodeURIComponent(id ?? "")}&limit=${HISTORY_LIMIT}`,
    ),
    // Pushed with an id or not at all; firing a request without one would be a
    // guaranteed 400 and a red error line on arrival.
    enabled: typeof id === "string" && id !== "",
  });

  /*
   * The owner's goals, for the reference line. Read from the cached bootstrap
   * rather than fetched: they are already on the phone, and the goal line is
   * the one thing on this page that can be absent without anything being wrong.
   */
  const { data: bootstrap } = useBootstrap();
  const claims = useMemo(
    () => (bootstrap === undefined
      ? []
      : extractGoalClaims(bootstrap.goalsText, bootstrap.catalogue, bootstrap.today).claims),
    [bootstrap],
  );

  if (typeof id !== "string" || id === "") {
    return (
      <Screen title="Exercise">
        <Text style={styles.state}>No exercise was named.</Text>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen title="Exercise" refreshing={isRefetching} onRefresh={() => void refetch()}>
        <Text style={styles.state}>
          {error instanceof Error ? error.message : "Could not load this exercise."}
          {"\n"}Pull down to try again.
        </Text>
      </Screen>
    );
  }

  if (isLoading || !data) {
    return (
      <Screen title="Exercise">
        <Spinner size="large" style={{ marginTop: space.xxl }} />
      </Screen>
    );
  }

  const view = buildExerciseView(data, claims);

  const openWorkout = (workoutId: string) => {
    tapSelect();
    router.push(`/workout?id=${encodeURIComponent(workoutId)}`);
  };

  return (
    <Screen
      title={view.title}
      subtitle={view.subtitle}
      refreshing={isRefetching}
      onRefresh={() => void refetch()}
    >
      {/*
        The cue, above everything, because it is the only thing on this page the
        owner wrote rather than the app worked out — and the one they came to
        re-read before the next set.

        Read-only here on purpose. The cue is edited in the confirm sheet, which
        is where you are every time this lift is logged. Two editors for one
        field is how the two come to disagree, so the footnote says where it is
        changed instead of pretending there is nothing to change.
      */}
      {view.cue !== null && (
        <Card style={styles.card}>
          <Label>Your cue</Label>
          <Text style={styles.cue}>{view.cue}</Text>
          <Text style={styles.cueFoot}>
            Shown every time you log this lift. Edit it in the confirm sheet when you log a set.
          </Text>
        </Card>
      )}

      <ProgressCard progress={view.progress} />

      <Label>History</Label>
      {view.sessions.length === 0 ? (
        <Empty>No sessions logged yet. Log this lift and its history shows here.</Empty>
      ) : (
        view.sessions.map((s, i) => (
          <SessionCard
            // Two sessions can share a date; the workout id cannot repeat.
            key={s.workoutId ?? `${s.date}-${i}`}
            session={s}
            onOpen={s.workoutId === null ? null : openWorkout}
          />
        ))
      )}
    </Screen>
  );
}

/** The metric card. Absent with no data; a sentence at one point; a chart at two. */
function ProgressCard({ progress }: { progress: ProgressView }) {
  if (progress.kind === "none") return null;

  if (progress.kind === "single") {
    return (
      <Card style={styles.card}>
        <Label>{progress.label}</Label>
        <Text style={styles.single}>{progress.line}</Text>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <Label>{progress.label}</Label>
      <View style={styles.headline}>
        <Text style={styles.best}>
          {progress.best}
          <Text style={styles.bestUnit}> best</Text>
        </Text>
        {progress.change !== null && (
          <Text style={[styles.change, progress.change.up ? styles.good : styles.bad]}>
            {progress.change.text}
          </Text>
        )}
      </View>
      <Text style={styles.span}>{progress.span}</Text>

      <View accessible accessibilityRole="image" accessibilityLabel={progress.accessibilityLabel}>
        <Chart height={CHART_H} left={progress.left} right={progress.right}>
          {(width, height) => (
            <Sparkline
              values={progress.values}
              width={width}
              height={height}
              dots
              reference={progress.reference}
              // Widened to include the goal, so the dashed line is on the panel
              // rather than silently clipped when the goal is above every point.
              domain={progress.reference === null ? undefined : domainWith(progress.values, progress.reference)}
            />
          )}
        </Chart>
      </View>
      <Text style={styles.last}>{progress.last}</Text>
    </Card>
  );
}

/** The series' range stretched to include `extra`, padded 4% like the default. */
function domainWith(values: number[], extra: number): [number, number] {
  const lo = Math.min(...values, extra);
  const hi = Math.max(...values, extra);
  const pad = (hi - lo) * 0.04 || 1;
  return [lo - pad, hi + pad];
}

function SessionCard({ session, onOpen }: {
  session: SessionView;
  onOpen: ((workoutId: string) => void) | null;
}) {
  const body = (
    <Card style={styles.sessionCard}>
      <View style={styles.sessionHead}>
        <Text style={styles.date}>{session.label}</Text>
        {session.pr && <Text style={styles.pr}>PR</Text>}
        <View style={styles.grow} />
        <Text style={styles.summary}>{session.summary}</Text>
        {onOpen !== null && <Text style={styles.chevron}>›</Text>}
      </View>
      <View style={styles.setRow}>
        {session.sets.map((set, i) => <SetBox key={i} set={set} />)}
      </View>
    </Card>
  );

  if (onOpen === null || session.workoutId === null) return body;
  const workoutId = session.workoutId;

  return (
    <Pressable
      onPress={() => onOpen(workoutId)}
      accessibilityRole="button"
      accessibilityLabel={`${session.label}${session.pr ? ", personal record" : ""}, ${session.summary}`}
      accessibilityHint="Opens this workout to view or edit its sets"
      style={({ pressed }) => pressed && styles.pressed}
    >
      {body}
    </Pressable>
  );
}

/** One set. A warmup is dimmed and prefixed "W" rather than hidden. */
function SetBox({ set }: { set: HistorySet }) {
  return (
    <View style={[styles.setBox, set.isWarmup && styles.warmupBox]}>
      <Text style={[styles.setText, set.isWarmup && styles.warmupText]}>
        {set.isWarmup ? "W " : ""}
        {set.weightLb} × {set.reps}
        {set.rpe !== null ? <Text style={styles.dim}> @{set.rpe}</Text> : null}
        {set.toFailure ? <Text style={styles.warn}> F</Text> : null}
      </Text>
    </View>
  );
}
