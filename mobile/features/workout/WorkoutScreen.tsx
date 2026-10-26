import { useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  Button, Card, Screen, Sheet, Spinner, Stat, color, hit, microLabel, space, tnum,
} from "@/components/ui";
import type { WeightUnit } from "@/components/ui/weight-entry";
import { apiGet } from "@/lib/api";
import { tapError, tapSave, tapSelect } from "@/lib/haptics";
import { queryKeys } from "@/lib/query";
import type { Bootstrap } from "@/lib/types";

import { EditSetSheet } from "../lift/EditSetSheet";
import { ExercisePicker } from "../lift/ExercisePicker";
import { editBlockedReason, type DisplaySet, type SetEdit } from "../lift/logic";
import { deleteWorkoutPrompt } from "../lift/next";

import {
  DELETED_NOTICE, addDraftSet, addPrefill, displaySetFor, groupByExercise, removeWarning,
  screenState, setWritePayload, staleKeys, workingSetCount, workoutKey, workoutStats,
  workoutSubtitle, writeErrorMessage, type ExerciseGroup, type SetRowView,
} from "./model";
import { postLiftNotice } from "./notice";
import { deleteWorkout, fetchWorkout, removeWorkoutSet, saveWorkoutSet } from "./requests";
import type { WorkoutDetail } from "./types";

const styles = StyleSheet.create({
  card: { marginBottom: space.lg },
  state: { color: color.muted, fontSize: 14, lineHeight: 20, paddingTop: space.lg },
  stateAction: { marginTop: space.lg },

  stats: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  muscles: { ...tnum, color: color.muted, fontSize: 13, lineHeight: 19, marginTop: space.md },

  exerciseHead: {
    minHeight: hit.min,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  exerciseName: { color: color.ink, fontSize: 16, fontWeight: "600", flexShrink: 1 },
  chevron: { color: color.muted, fontSize: 18 },

  setRow: {
    minHeight: hit.min,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  setLabel: { ...microLabel, ...tnum, width: 20, color: color.ink },
  setLabelWarm: { color: color.muted },
  setFigure: { ...tnum, color: color.ink, fontSize: 16, minWidth: 96 },
  setFigureWarm: { color: color.muted },
  setRpe: { ...tnum, color: color.muted, fontSize: 14 },
  setFail: { ...tnum, color: color.warn, fontSize: 14, fontWeight: "600" },
  spacer: { flex: 1 },

  addSet: {
    minHeight: hit.min,
    justifyContent: "center",
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  addSetText: { color: color.accentInk, fontSize: 14 },
  pressed: { opacity: 0.6 },

  addExercise: { marginTop: space.sm },
  deleteWorkout: { marginTop: space.lg },

  deleteWhat: { color: color.ink, fontSize: 15, fontWeight: "500" },
  deleteWhen: { ...microLabel, ...tnum, marginTop: 2 },
  deleteWarn: { color: color.ink, fontSize: 14, lineHeight: 20, marginVertical: space.lg },
  deleteError: { color: color.bad, fontSize: 13, lineHeight: 19, marginBottom: space.md },
  secondary: { marginTop: space.sm },
});

/** Which set editor is open: fixing an existing set, or adding one to a lift. */
type Editor = { mode: "edit" | "add"; set: DisplaySet } | null;

/**
 * One past workout, every set, and the way to correct it.
 *
 * The owner's ask: open a past workout, see every set — weight, reps, RPE,
 * kind — edit them, add sets, add an exercise, delete. Before this the Lift
 * tab's recent-workouts row could only delete the whole thing, so a 155 typed
 * for 165 last Tuesday was either kept or the whole session was thrown away.
 *
 * Every figure is edited in the live session's own `EditSetSheet`, so a set is
 * typed the same way here as at the rack (pad, lb/kg toggle, RPE and kind
 * segments). What differs is the transport: these are direct requests to
 * `/api/mobile/workout/set`, not the outbox. A sheet stays open on failure
 * with the reason, and offline it says so; nothing is queued. Why the live
 * session cannot be edited from here, and why this is not `/api/sets`, is in
 * `src/lib/workout-edit.ts`.
 *
 * `?id=<uuid>` rather than a dynamic segment, matching `/exercise?id=` and the
 * API's `GET /api/mobile/workout?id=`.
 */
export default function WorkoutScreen() {
  const { id: rawId } = useLocalSearchParams<{ id?: string }>();
  const id = typeof rawId === "string" ? rawId : "";
  const router = useRouter();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: workoutKey(id),
    queryFn: () => fetchWorkout(id),
    enabled: id !== "",
    // A 404 is an answer (the workout was deleted), not a blip worth retrying.
    retry: (count, err) =>
      !(typeof err === "object" && err !== null && "status" in err && err.status === 404) && count < 1,
  });

  // The same cache entry every tab reads. The catalogue names muscles for the
  // stat row and `lastSets` prefills a lift new to this workout.
  const bootstrap = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => apiGet<Bootstrap>("/api/mobile/bootstrap"),
  });

  const [editor, setEditor] = useState<Editor>(null);
  const [editError, setEditError] = useState("");
  const [pending, setPending] = useState(false);
  /** The weight pad's unit, per lift — the live session's rule. */
  const [units, setUnits] = useState<Record<string, WeightUnit>>({});
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deletePending, setDeletePending] = useState(false);
  /** Makes every add-mode open a new sheet key, so it re-seeds. */
  const nonce = useRef(0);

  const state = screenState({ data: query.data, error: query.error, isLoading: query.isLoading });

  const refresh = async (exerciseIds: string[]) => {
    await Promise.all(
      staleKeys(id, exerciseIds).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  };

  /*
   * After the workout is gone: nothing here can be shown any more, so the
   * screen leaves, and Lift says why. The workout's own entry is REMOVED rather
   * than invalidated — invalidating would refetch it and get a 404 for a
   * screen that is already closing.
   */
  const leaveDeleted = async (exerciseIds: string[]) => {
    postLiftNotice(DELETED_NOTICE);
    queryClient.removeQueries({ queryKey: workoutKey(id) });
    await Promise.all(
      staleKeys(id, exerciseIds).slice(1).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
    router.back();
  };

  const openAdd = (exerciseId: string, prefill: SetEdit) => {
    tapSelect();
    nonce.current += 1;
    setEditError("");
    setEditor({ mode: "add", set: addDraftSet(exerciseId, prefill, nonce.current) });
  };

  const save = async (detail: WorkoutDetail, edit: SetEdit) => {
    if (editor === null) return;
    const reason = editBlockedReason(edit);
    if (reason !== null) {
      setEditError(reason);
      tapError();
      return;
    }
    setEditError("");
    setPending(true);
    try {
      await saveWorkoutSet(setWritePayload(
        detail.id,
        editor.set.exerciseId,
        edit,
        editor.mode === "edit" && editor.set.id !== null ? editor.set.id : undefined,
      ));
      tapSave();
      setEditor(null);
      await refresh([editor.set.exerciseId]);
    } catch (err) {
      setEditError(writeErrorMessage(err, "Could not save that set."));
      tapError();
    } finally {
      setPending(false);
    }
  };

  const remove = async (detail: WorkoutDetail) => {
    if (editor === null || editor.set.id === null) return;
    setEditError("");
    setPending(true);
    try {
      const result = await removeWorkoutSet(detail.id, editor.set.id);
      tapSave();
      setEditor(null);
      if (result.workoutDeleted) await leaveDeleted([editor.set.exerciseId]);
      else await refresh([editor.set.exerciseId]);
    } catch (err) {
      setEditError(writeErrorMessage(err, "Could not remove that set."));
      tapError();
    } finally {
      setPending(false);
    }
  };

  const confirmDelete = async (detail: WorkoutDetail) => {
    setDeleteError("");
    setDeletePending(true);
    try {
      await deleteWorkout(detail.id);
      tapSave();
      setDeleting(false);
      await leaveDeleted(detail.sets.map((s) => s.exerciseId));
    } catch (err) {
      setDeleteError(writeErrorMessage(err, "Could not delete that workout."));
      tapError();
    } finally {
      setDeletePending(false);
    }
  };

  const back = (
    <Button variant="ghost" onPress={() => { tapSelect(); router.back(); }}>
      BACK
    </Button>
  );

  if (id === "") {
    return (
      <Screen title="Workout" action={back}>
        <Text style={styles.state}>No workout was named.</Text>
      </Screen>
    );
  }

  if (state.kind === "loading") {
    return (
      <Screen title="Workout" action={back}>
        <Spinner size="large" style={{ marginTop: space.xxl }} />
      </Screen>
    );
  }

  if (state.kind === "missing") {
    return (
      <Screen title="Workout" action={back}>
        <Text style={styles.state}>This workout no longer exists.</Text>
        <Button variant="secondary" size="lg" style={styles.stateAction} onPress={() => router.back()}>
          BACK
        </Button>
      </Screen>
    );
  }

  if (state.kind === "error") {
    return (
      <Screen
        title="Workout"
        action={back}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
      >
        <Text style={styles.state}>{state.message}{"\n"}Pull down to try again.</Text>
      </Screen>
    );
  }

  if (state.kind === "live") {
    return (
      <Screen title={query.data?.name ?? "Workout"} action={back}>
        <Text style={styles.state}>This session is still running. Open Lift to edit it.</Text>
        <Button
          size="lg"
          style={styles.stateAction}
          onPress={() => {
            tapSelect();
            router.navigate("/lift");
          }}
        >
          OPEN LIFT
        </Button>
      </Screen>
    );
  }

  const detail = state.detail;
  const groups = groupByExercise(detail);
  const stats = workoutStats(detail, bootstrap.data?.catalogue ?? []);

  return (
    <Screen
      title={detail.name}
      subtitle={workoutSubtitle(detail)}
      action={back}
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      <Card style={styles.card}>
        <View style={styles.stats}>
          <Stat label="Sets" value={String(stats.sets)} />
          <Stat label="Volume" value={`${stats.volumeLb} lb`} />
          {stats.duration !== null && <Stat label="Duration" value={stats.duration} />}
        </View>
        {stats.muscles !== null && <Text style={styles.muscles}>{stats.muscles}</Text>}
      </Card>

      {groups.map((group) => (
        <ExerciseCard
          key={group.exerciseId}
          group={group}
          onOpenExercise={() => {
            tapSelect();
            router.push({ pathname: "/exercise", params: { id: group.exerciseId } });
          }}
          onEditSet={(row) => {
            tapSelect();
            setEditError("");
            setEditor({ mode: "edit", set: displaySetFor(row.set) });
          }}
          onAddSet={() => openAdd(group.exerciseId, addPrefill(group.last, undefined))}
        />
      ))}

      <Button
        variant="secondary"
        size="lg"
        style={styles.addExercise}
        onPress={() => {
          tapSelect();
          setPicking(true);
        }}
      >
        + ADD EXERCISE
      </Button>

      <Button
        variant="ghost"
        style={styles.deleteWorkout}
        textStyle={{ color: color.bad }}
        onPress={() => {
          tapSelect();
          setDeleteError("");
          setDeleting(true);
        }}
      >
        Delete workout
      </Button>

      <EditSetSheet
        set={editor?.set ?? null}
        mode={editor?.mode ?? "edit"}
        unit={units[editor?.set.exerciseId ?? ""] ?? "lb"}
        onUnitChange={(next) => {
          if (editor === null) return;
          setUnits((current) => ({ ...current, [editor.set.exerciseId]: next }));
        }}
        error={editError}
        pending={pending}
        removeWarning={removeWarning(detail)}
        onSave={(edit) => void save(detail, edit)}
        onRemove={() => void remove(detail)}
        onClose={() => {
          if (pending) return;
          setEditError("");
          setEditor(null);
        }}
      />

      {/*
        The confirmation moved here from the Lift tab unchanged, count and all:
        there is no undo, and "delete this workout?" alone does not say whether
        that is one stray set or an hour of training.
      */}
      <Sheet
        visible={deleting}
        onClose={() => {
          if (!deletePending) setDeleting(false);
        }}
        title="Delete this workout?"
      >
        <Text style={styles.deleteWhat}>{detail.name}</Text>
        <Text style={styles.deleteWhen}>{workoutSubtitle(detail)}</Text>
        <Text style={styles.deleteWarn}>
          {deleteWorkoutPrompt({ workingSets: workingSetCount(detail) })}
        </Text>
        {deleteError !== "" && <Text style={styles.deleteError}>{deleteError}</Text>}
        <Button
          variant="danger"
          size="lg"
          disabled={deletePending}
          onPress={() => void confirmDelete(detail)}
        >
          {deletePending ? "DELETING…" : "DELETE WORKOUT"}
        </Button>
        <Button
          variant="ghost"
          style={styles.secondary}
          disabled={deletePending}
          onPress={() => setDeleting(false)}
        >
          KEEP IT
        </Button>
      </Sheet>

      {/*
        The live session's picker, owed-lifts header and all. Picking a lift
        opens the add sheet on it straight away — a lift with no sets is not
        something this screen can show, so there is no empty card in between.
      */}
      <Modal
        visible={picking}
        animationType="slide"
        onRequestClose={() => setPicking(false)}
        statusBarTranslucent
      >
        <ExercisePicker
          onCancel={() => setPicking(false)}
          onPick={(exercise) => {
            setPicking(false);
            const here = groups.find((g) => g.exerciseId === exercise.id)?.last ?? null;
            openAdd(exercise.id, addPrefill(here, bootstrap.data?.lastSets[exercise.id]));
          }}
        />
      </Modal>
    </Screen>
  );
}

/**
 * One lift's sets, as rows a thumb can hit.
 *
 * Rows rather than the chips the Exercise history uses: here each set is a
 * target that opens an editor, and a 44pt row is a target where a 28pt chip is
 * not. The name taps through to that lift's history.
 */
function ExerciseCard({
  group,
  onOpenExercise,
  onEditSet,
  onAddSet,
}: {
  group: ExerciseGroup;
  onOpenExercise: () => void;
  onEditSet: (row: SetRowView) => void;
  onAddSet: () => void;
}) {
  return (
    <Card style={styles.card}>
      <Pressable
        onPress={onOpenExercise}
        accessibilityRole="button"
        accessibilityLabel={`${group.name} history`}
        style={({ pressed }) => [styles.exerciseHead, pressed && styles.pressed]}
      >
        <Text style={styles.exerciseName} numberOfLines={1}>{group.name}</Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      {group.rows.map((row) => (
        <Pressable
          key={row.set.id}
          onPress={() => onEditSet(row)}
          accessibilityRole="button"
          accessibilityLabel={
            `${row.warmup ? "Warmup" : `Set ${row.label}`}, ${row.figure.replace("×", "by")}`
            + `${row.rpe !== null ? `, RPE ${row.rpe.slice(1)}` : ""}${row.failure ? ", to failure" : ""}`
          }
          accessibilityHint="Opens this set to edit or remove it"
          style={({ pressed }) => [styles.setRow, pressed && styles.pressed]}
        >
          <Text style={[styles.setLabel, row.warmup && styles.setLabelWarm]}>{row.label}</Text>
          <Text style={[styles.setFigure, row.warmup && styles.setFigureWarm]}>{row.figure}</Text>
          {row.rpe !== null && <Text style={styles.setRpe}>{row.rpe}</Text>}
          <View style={styles.spacer} />
          {row.failure && <Text style={styles.setFail}>F</Text>}
        </Pressable>
      ))}

      <Pressable
        onPress={onAddSet}
        accessibilityRole="button"
        accessibilityLabel={`Add a set of ${group.name}`}
        style={({ pressed }) => [styles.addSet, pressed && styles.pressed]}
      >
        <Text style={styles.addSetText}>+ Add set</Text>
      </Pressable>
    </Card>
  );
}
