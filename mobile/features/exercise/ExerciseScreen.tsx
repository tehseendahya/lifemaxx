import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import {
  Card, Empty, Label, Screen, Spinner, Stat, color, radius, space, tnum,
} from "@/components/ui";
import { apiGet } from "@/lib/api";
import { queryKeys } from "@/lib/query";
import type { ExerciseHistory } from "@/lib/types";

import { barHeightPct, buildExerciseView } from "./model";

const styles = StyleSheet.create({
  card: { marginBottom: space.lg },

  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: space.md,
  },
  good: { color: color.good },
  bad: { color: color.bad },

  chart: { flexDirection: "row", alignItems: "flex-end", height: 64, gap: 4 },
  bar: { flex: 1, borderRadius: radius.sm, backgroundColor: color.accent, opacity: 0.7 },

  sessionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: space.sm,
    gap: space.sm,
  },
  date: { color: color.ink, fontSize: 14, fontWeight: "500" },
  volume: { ...tnum, color: color.muted, fontSize: 11 },

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
  setText: { ...tnum, color: color.ink, fontSize: 14 },
  dim: { color: color.muted },
  warn: { color: color.warn },

  state: { color: color.muted, fontSize: 13, lineHeight: 19, paddingTop: space.lg },
});

/**
 * One exercise's history and e1RM trend. Pushed from the live session, and
 * `?id=<uuid>` rather than a dynamic segment so it matches
 * `GET /api/mobile/exercise?id=` — one convention across the whole stack.
 */
export default function ExerciseScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: queryKeys.exercise(id ?? ""),
    queryFn: () => apiGet<ExerciseHistory>(`/api/mobile/exercise?id=${encodeURIComponent(id ?? "")}`),
    // Pushed with an id or not at all; firing a request without one would be a
    // guaranteed 400 and a red error line on arrival.
    enabled: typeof id === "string" && id !== "",
  });

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

  const view = buildExerciseView(data);

  return (
    <Screen
      title={view.title}
      subtitle={view.subtitle}
      refreshing={isRefetching}
      onRefresh={() => void refetch()}
    >
      {view.trend.length > 0 && view.peakE1rmLb !== null && (
        <Card style={styles.card}>
          <View style={styles.statRow}>
            <Stat label="Best e1RM" value={`${Math.round(view.peakE1rmLb)} lb`} />
            {view.changePct !== null && (
              <Stat
                label={`Over ${view.trend.length} sessions`}
                value={
                  <Text style={view.changePct >= 0 ? styles.good : styles.bad}>
                    {view.changePct >= 0 ? "+" : ""}
                    {view.changePct.toFixed(1)}%
                  </Text>
                }
              />
            )}
          </View>
          <View
            style={styles.chart}
            accessibilityRole="image"
            accessibilityLabel="Estimated one-rep-max trend, oldest to newest"
          >
            {view.trend.map((p) => (
              <View
                key={p.date}
                style={[styles.bar, { height: `${barHeightPct(p.e1rmLb, view.peakE1rmLb)}%` }]}
              />
            ))}
          </View>
        </Card>
      )}

      <Label>History</Label>
      {view.sessions.length === 0 ? (
        <Empty>No sessions logged yet.</Empty>
      ) : (
        view.sessions.map((s) => (
          <Card key={s.date} style={styles.card}>
            <View style={styles.sessionHead}>
              <Text style={styles.date}>{s.label}</Text>
              <Text style={styles.volume}>{s.volumeLb} lb volume</Text>
            </View>
            {s.sets.length === 0 ? (
              <Text style={styles.volume}>Warmups only.</Text>
            ) : (
              <View style={styles.setRow}>
                {s.sets.map((set, i) => (
                  <View key={i} style={styles.setBox}>
                    <Text style={styles.setText}>
                      {set.weightLb} × {set.reps}
                      {set.rpe !== null ? <Text style={styles.dim}> @{set.rpe}</Text> : null}
                      {set.toFailure ? <Text style={styles.warn}> F</Text> : null}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </Card>
        ))
      )}
    </Screen>
  );
}
