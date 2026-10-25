import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useKeepAwake } from "expo-keep-awake";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import {
  Button,
  NumberPad,
  Screen,
  Sheet,
  color,
  space,
  tnum,
} from "@/components/ui";
import { microLabel } from "@/components/ui/Label";
import { apiDelete } from "@/lib/api";
import { tapError, tapSave, tapSelect } from "@/lib/haptics";
import { enqueue, removeQueued } from "@/lib/outbox";
import { newClientId } from "@/lib/shared/outbox";
import { queryKeys } from "@/lib/query";
import type { Bootstrap, CatalogueExercise, SessionPayload } from "@/lib/types";

import { QuickLog } from "@/features/voice";

import { ExerciseCard } from "./ExerciseCard";
import { ExercisePager } from "./ExercisePager";
import { ExercisePicker } from "./ExercisePicker";
import { RestTimerBar } from "./RestTimerBar";
import { SetPills } from "./SetPills";
import { StopSheet } from "./StopSheet";
import { useRestTimer } from "./useRestTimer";
import { useSuggestions } from "./useSuggestions";
import type { QueuedWrites } from "./useQueuedWrites";
import {
  buildSetPayload,
  canLog,
  draftAfterSave,
  elapsedMin,
  emptyDraft,
  localSetFrom,
  mergeSets,
  numberToPad,
  padToNumber,
  pruneLocal,
  resolveEntry,
  sessionExercises,
  setsForExercise,
  stepReps,
  stepWeight,
  type Draft,
  type DisplaySet,
  type LocalSet,
} from "./logic";

const styles = StyleSheet.create({
  subtitle: { ...tnum },
  queued: { ...microLabel, marginBottom: 0 },
  dropped: { color: color.warn, fontSize: 13, lineHeight: 19, marginBottom: space.md },
  droppedRow: { ...tnum, color: color.ink, fontSize: 14, lineHeight: 22 },
  droppedWhy: { color: color.muted, fontSize: 12, lineHeight: 18, marginBottom: space.md },
  pagerHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    marginBottom: space.sm,
  },
  pagerName: { ...microLabel, marginBottom: 0, flexShrink: 1, color: color.muted },
  dots: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.line },
  dotActive: { backgroundColor: color.accent },
  page: { flex: 1 },
  pageScroll: { paddingBottom: space.xxl },
  addPage: { flex: 1, justifyContent: "center" },
  addNote: {
    color: color.muted,
    fontSize: 13,
    textAlign: "center",
    marginTop: space.lg,
    lineHeight: 19,
  },
  removeNote: { color: color.ink, fontSize: 14, lineHeight: 20, marginBottom: space.lg },
  removeError: { color: color.bad, fontSize: 13, lineHeight: 19, marginBottom: space.md },
  secondary: { marginTop: space.sm },
  history: { alignSelf: "flex-start", paddingVertical: space.sm },
  historyText: { color: color.accent, fontSize: 12 },
  quickLog: { paddingTop: space.md },
});

type PadField = { field: "weight" | "reps"; exerciseId: string } | null;

/**
 * Shared empty arrays, used as the fallback for every optional list below.
 *
 * `?? []` would allocate a new array on every render, which makes the `useMemo`
 * that merges the sets and the effect that prunes the local ones re-run on
 * every tick of the elapsed clock — including, in the merge's case, re-sorting
 * the whole session.
 */
const NO_SETS: SessionPayload["sets"] = [];
const NO_CATALOGUE: CatalogueExercise[] = [];

/**
 * The live session.
 *
 * The whole screen is built around one invariant: **nothing here waits for the
 * network before it updates.** A set is written to SQLite and drawn in the same
 * frame as the haptic that acknowledges it; the elapsed clock, the pager, the
 * pills and the rest timer are all local. The only two networked affordances —
 * the progression advice and the session summary — are additive, and the screen
 * is fully usable with neither.
 *
 * The second invariant is that the common case costs one tap. The hero button
 * is labelled with the exact set it will log, pre-filled from the last set of
 * this session, so the third set of bench at 185×5 is one press of a 72pt
 * target. Everything else on the card exists only to change what that button
 * says before it is pressed.
 */
export function SessionScreen({
  bootstrap,
  session,
  queued,
  startedAtMs,
  pendingSession,
  notice,
  onStopped,
}: {
  bootstrap: Bootstrap | undefined;
  session: SessionPayload | undefined;
  queued: QueuedWrites;
  startedAtMs: number | null;
  /** The start is queued and the server has not confirmed a workout yet. */
  pendingSession: boolean;
  notice: string | null;
  onStopped: () => void;
}) {
  // While a session is live the screen is read between sets, with wet hands,
  // and a phone that locks every thirty seconds is a phone that costs a Face ID
  // per set.
  useKeepAwake();

  const router = useRouter();
  const queryClient = useQueryClient();
  const rest = useRestTimer();
  const suggestions = useSuggestions();

  const [page, setPage] = useState(0);
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [localSets, setLocalSets] = useState<LocalSet[]>([]);
  const [pad, setPad] = useState<PadField>(null);
  const [padValue, setPadValue] = useState("");
  const [rpeOpen, setRpeOpen] = useState<Record<string, boolean>>({});
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});
  const [picking, setPicking] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [removing, setRemoving] = useState<DisplaySet | null>(null);
  const [removeError, setRemoveError] = useState("");
  const [showDropped, setShowDropped] = useState(false);
  /**
   * How much of the outbox's dropped list has already been raised.
   *
   * `useOutbox().dropped` is append-only for the life of the launch and there
   * is no API to clear it, so "I have dealt with this" has to be tracked here
   * or the warning line would stay up for the rest of the session. It is a
   * position rather than a set of ids on purpose: a retry that fails again
   * re-appends the *same* item id, and an id-keyed set would hide the second
   * failure forever.
   */
  const [ackedDrops, setAckedDrops] = useState(0);

  // -------------------------------------------------------------- the clock

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Ten seconds, not one. The readout is whole minutes, so a faster tick
    // re-renders a screen full of numbers for nothing.
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  // ------------------------------------------------------------------- sets

  const serverSets = session?.sets ?? NO_SETS;
  const sets = useMemo(
    () => mergeSets(serverSets, queued.sets, localSets),
    [serverSets, queued.sets, localSets],
  );

  // Local optimistic rows exist only to cover the gap between the press and
  // SQLite publishing. Once the queue or the server has one, holding a second
  // copy means the merge does more work on every render for no benefit.
  useEffect(() => {
    setLocalSets((current) => {
      const next = pruneLocal(current, serverSets, queued.sets);
      return next.length === current.length ? current : next;
    });
  }, [serverSets, queued.sets]);

  const catalogue: CatalogueExercise[] = bootstrap?.catalogue ?? NO_CATALOGUE;
  const exercises = useMemo(
    () => sessionExercises(sets, addedIds, catalogue),
    [sets, addedIds, catalogue],
  );

  // The trailing page is always "+ ADD EXERCISE", so the page count is one more
  // than the exercise count and the last index is never a real exercise.
  const pageCount = exercises.length + 1;
  const addPageIndex = exercises.length;

  // An exercise can leave the session — its only set was deleted — which can
  // leave the pager parked past the end.
  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  // ----------------------------------------------------------- outbox drain

  const wasPending = useRef(queued.pending);
  useEffect(() => {
    // Refetch on the edge, not on the level. The outbox publishes on every
    // flush, including the idle one every thirty seconds, so refetching
    // whenever the queue is empty would refetch forever. The only moment the
    // server has something new is when the queue *drains*.
    if (wasPending.current > 0 && queued.pending === 0 && !queued.syncing) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.session });
      void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });
    }
    wasPending.current = queued.pending;
  }, [queued.pending, queued.syncing, queryClient]);

  // --------------------------------------------------------------- the card

  const draftFor = useCallback((id: string): Draft => drafts[id] ?? emptyDraft(), [drafts]);

  const patchDraft = useCallback((id: string, patch: Partial<Draft>) => {
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? emptyDraft()), ...patch } }));
  }, []);

  const entryFor = useCallback(
    (exerciseId: string) => {
      const sessionLast = (() => {
        const mine = setsForExercise(sets, exerciseId);
        return mine.length > 0 ? mine[mine.length - 1] : null;
      })();
      return resolveEntry(
        drafts[exerciseId],
        sessionLast,
        bootstrap?.lastSets[exerciseId],
        suggestions.get(exerciseId),
      );
    },
    [sets, drafts, bootstrap, suggestions],
  );

  // ----------------------------------------------------------------- saving

  const logSet = useCallback(
    (exerciseId: string) => {
      const entry = entryFor(exerciseId);

      // Nothing is known about this exercise yet: no history, no session set,
      // no advice. Open the pad rather than refusing — the button already said
      // SET WEIGHT, so this is the action it advertised.
      if (!canLog(entry)) {
        tapSelect();
        setPadValue(numberToPad(entry.weightLb));
        setPad({ field: "weight", exerciseId });
        return;
      }

      const draft = draftFor(exerciseId);
      const payload = buildSetPayload({
        clientId: newClientId(),
        exerciseId,
        entry,
        draft,
      });
      if (payload === null) return;

      // The haptic is the acknowledgement, and it fires before the await. The
      // user is holding a barbell: the thing that tells them the set landed has
      // to be the press itself, not a round trip they cannot feel.
      tapSave();

      const loggedAt = new Date().toISOString();
      setLocalSets((current) => [...current, localSetFrom(payload, loggedAt)]);
      setDrafts((current) => ({ ...current, [exerciseId]: draftAfterSave(draft, entry) }));
      setRpeOpen((current) => ({ ...current, [exerciseId]: false }));
      setNoteOpen((current) => ({ ...current, [exerciseId]: false }));
      rest.start();

      // Not awaited. `enqueue` writes to SQLite and kicks off a flush; the set
      // is already on screen and already durable, and the pager deliberately
      // does not move.
      void enqueue("set", "/api/sets", { ...payload }).catch((err: unknown) => {
        // The only way this rejects is SQLite itself failing, which the outbox
        // already degrades to an in-memory store for. Surfacing it is better
        // than a silently missing set.
        console.error("[lift] could not queue a set", err);
        tapError();
      });
    },
    [entryFor, draftFor, rest.start],
  );

  // ---------------------------------------------------------------- removal

  const removeSet = useCallback(
    async (set: DisplaySet) => {
      setRemoveError("");
      try {
        if (set.id !== null) {
          await apiDelete("/api/sets", { id: set.id });
          await queryClient.invalidateQueries({ queryKey: queryKeys.session });
        } else {
          // Still on this phone: abandon the queued write, and drop the local
          // optimistic copy in case the queue has not published yet.
          const outboxId = queued.idOf(set.clientId);
          if (outboxId !== null) await removeQueued(outboxId);
          setLocalSets((current) => current.filter((l) => l.clientId !== set.clientId));
        }
        setRemoving(null);
      } catch (err) {
        setRemoveError(err instanceof Error ? err.message : "Could not remove that set.");
        tapError();
      }
    },
    [queryClient, queued],
  );

  // --------------------------------------------------------------- the pad

  const commitPad = useCallback(() => {
    if (pad === null) return;
    tapSave();

    const value = padToNumber(padValue);
    // `null` means the pad was closed untouched, which must leave the prefilled
    // value alone rather than writing 0 — that distinction is the whole reason
    // `NumberPad` emits a raw string and refuses to parse it itself.
    if (value !== null) {
      patchDraft(
        pad.exerciseId,
        pad.field === "weight"
          ? { weightLb: value }
          // Clamped here rather than rejected: a typed `0` reps would make the
          // hero button fall back to SET WEIGHT, so tapping LOG would open the
          // weight pad for a reps mistake.
          : { reps: Math.max(1, Math.round(value)) },
      );
    }

    setPad(null);
    setPadValue("");
  }, [pad, padValue, patchDraft]);

  // ----------------------------------------------------------------- render

  const current = exercises[Math.min(page, exercises.length - 1)];

  /**
   * Sets the outbox gave up on.
   *
   * Filtered to `kind === "set"`: the queue is shared with the session start
   * and with other features' writes, and a dropped meal photo is not something
   * to raise on the lift screen. A dropped *start* is the parent's business —
   * it ends the local session — and arrives here as `notice`.
   */
  const droppedSets = queued.dropped.slice(ackedDrops).filter((item) => item.kind === "set");

  /**
   * A real retry, not a refresh.
   *
   * The dropped item still carries its payload, including the `clientId` it was
   * minted with — so re-queueing it is genuinely idempotent: if the original
   * delivery actually succeeded and only the response was lost, the server
   * upserts on `(workout_id, client_id)` and nothing is duplicated.
   */
  const retryDropped = useCallback(() => {
    tapSelect();
    for (const item of droppedSets) {
      void enqueue("set", item.url, item.payload);
    }
    setAckedDrops(queued.dropped.length);
    setShowDropped(false);
  }, [droppedSets, queued.dropped.length]);

  return (
    <Screen
      title="Session"
      scroll={false}
      subtitle={
        <Text style={styles.subtitle}>
          {`${elapsedMin(startedAtMs, now)} MIN`}
          {/*
            Muted, no spinner, no badge, no red. Being in a basement is the
            normal case in this app, not a failure to announce — and the clock
            still runs, from the local start time, while the start is queued.
          */}
          {pendingSession && <Text style={styles.queued}>{"  ·  SESSION PENDING"}</Text>}
          {queued.setCount > 0 && (
            <Text style={styles.queued}>{`  ·  ${queued.setCount} QUEUED`}</Text>
          )}
        </Text>
      }
      action={
        <Button
          variant="secondary"
          onPress={() => {
            tapSelect();
            setStopping(true);
          }}
        >
          STOP
        </Button>
      }
    >
      {notice !== null && <Text style={styles.dropped}>{notice}</Text>}

      {droppedSets.length > 0 && (
        <Pressable onPress={() => setShowDropped(true)} accessibilityRole="button">
          <Text style={styles.dropped}>
            {droppedSets.length} {droppedSets.length === 1 ? "set" : "sets"} didn&apos;t save — tap
            to retry
          </Text>
        </Pressable>
      )}

      <View style={styles.pagerHead}>
        <Text style={styles.pagerName} numberOfLines={1}>
          {page === addPageIndex ? "ADD AN EXERCISE" : (current?.name ?? "")}
        </Text>
        <Dots count={pageCount} active={page} onPick={setPage} />
      </View>

      {exercises.length === 0 && page === addPageIndex ? (
        <View style={styles.addPage}>
          <Button
            size="hero"
            onPress={() => {
              tapSelect();
              setPicking(true);
            }}
          >
            + ADD EXERCISE
          </Button>
          <Text style={styles.addNote}>
            The session is already running. Pick what you are about to do and the card will be
            pre-filled from last time.
          </Text>
        </View>
      ) : (
        <ExercisePager
          count={pageCount}
          page={page}
          onPageChange={(next) => {
            tapSelect();
            setPage(next);
          }}
          renderPage={(index) => {
            if (index === addPageIndex) {
              return (
                <View style={styles.addPage}>
                  <Button
                    size="hero"
                    onPress={() => {
                      tapSelect();
                      setPicking(true);
                    }}
                  >
                    + ADD EXERCISE
                  </Button>
                  <Text style={styles.addNote}>
                    Swipe back to carry on with{" "}
                    {exercises[exercises.length - 1]?.name ?? "the last exercise"}.
                  </Text>
                </View>
              );
            }

            const exercise = exercises[index];
            if (exercise === undefined) return null;

            return (
              <ScrollView
                style={styles.page}
                contentContainerStyle={styles.pageScroll}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <ExerciseCard
                  exercise={exercise}
                  history={bootstrap?.lastSets[exercise.id]}
                  today={bootstrap?.today ?? session?.today ?? ""}
                  entry={entryFor(exercise.id)}
                  draft={draftFor(exercise.id)}
                  suggest={suggestions.get(exercise.id)}
                  focused={index === page}
                  onRequestSuggest={suggestions.request}
                  onDraft={(patch) => patchDraft(exercise.id, patch)}
                  onLog={() => logSet(exercise.id)}
                  onOpenPad={(field) => {
                    tapSelect();
                    const entry = entryFor(exercise.id);
                    setPadValue(
                      numberToPad(field === "weight" ? entry.weightLb : entry.reps),
                    );
                    setPad({ field, exerciseId: exercise.id });
                  }}
                  onStepWeight={(dir) => {
                    tapSelect();
                    const entry = entryFor(exercise.id);
                    patchDraft(exercise.id, {
                      weightLb: stepWeight(entry.weightLb, exercise.incrementLb, dir),
                      // Stepping the weight commits whatever reps were showing,
                      // so a late suggestion cannot change them underneath.
                      reps: entry.reps ?? undefined,
                    });
                  }}
                  onStepReps={(dir) => {
                    tapSelect();
                    const entry = entryFor(exercise.id);
                    patchDraft(exercise.id, {
                      reps: stepReps(entry.reps, dir),
                      weightLb: entry.weightLb ?? undefined,
                    });
                  }}
                  rpeOpen={rpeOpen[exercise.id] === true}
                  onToggleRpe={() => {
                    tapSelect();
                    setRpeOpen((c) => ({ ...c, [exercise.id]: !(c[exercise.id] === true) }));
                  }}
                  noteOpen={noteOpen[exercise.id] === true}
                  onToggleNote={() => {
                    tapSelect();
                    setNoteOpen((c) => ({ ...c, [exercise.id]: !(c[exercise.id] === true) }));
                  }}
                />

                <SetPills
                  sets={setsForExercise(sets, exercise.id)}
                  onLongPressSet={(set) => {
                    setRemoveError("");
                    setRemoving(set);
                  }}
                />

                <Pressable
                  onPress={() => {
                    tapSelect();
                    router.push({ pathname: "/exercise", params: { id: exercise.id } });
                  }}
                  accessibilityRole="button"
                  style={styles.history}
                >
                  <Text style={styles.historyText}>HISTORY →</Text>
                </Pressable>
              </ScrollView>
            );
          }}
        />
      )}

      {/*
        Typing or speaking a set, once for the whole screen rather than once per
        page. Same reasoning as the pad below it: `ExercisePager` keeps several
        pages mounted, and three copies of this would be three audio recorders
        and three modals racing to present. It follows whichever exercise is
        under the thumb, which is what makes "did another 3 at 185" land on the
        right one and gives the transcriber a useful decoding hint.
      */}
      <View style={styles.quickLog}>
        <QuickLog
          exerciseId={current?.id ?? null}
          exerciseName={current?.name ?? null}
          onConfirmed={() => {
            // The rows are already in SQLite and already drawn from the queue;
            // this only pulls the server's view forward once they land.
            void queryClient.invalidateQueries({ queryKey: queryKeys.session });
          }}
        />
      </View>

      <RestTimerBar timer={rest} />

      {/*
        One pad for the whole screen rather than one per page: it is a Modal
        overlay, and three mounted copies of it is three modals racing to
        present.
      */}
      <NumberPad
        visible={pad !== null}
        value={padValue}
        label={pad?.field === "reps" ? "Reps" : "Weight"}
        unit={pad?.field === "reps" ? "reps" : "lb"}
        allowDecimal={pad?.field !== "reps"}
        onChange={(next) => {
          tapSelect();
          setPadValue(next);
        }}
        onDone={commitPad}
        onCancel={() => {
          setPad(null);
          setPadValue("");
        }}
      />

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
            setAddedIds((current) =>
              current.includes(exercise.id) ? current : [...current, exercise.id],
            );
            // Focus the page that is about to exist. `exercises` has not been
            // recomputed yet, so its index is the current add-page index — the
            // new exercise takes that slot and the add page shuffles right.
            setPage(addPageIndex);
          }}
        />
      </Modal>

      <Sheet
        visible={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this set?"
      >
        {removeError !== "" && <Text style={styles.removeError}>{removeError}</Text>}
        <Text style={styles.removeNote}>
          {removing === null
            ? ""
            : removing.id === null
              ? "It has not reached the server yet, so it will just be dropped from the queue."
              : "It will be deleted from the session."}
        </Text>
        <Button variant="danger" size="lg" onPress={() => void removeSet(removing as DisplaySet)}>
          REMOVE
        </Button>
        <Button variant="ghost" style={styles.secondary} onPress={() => setRemoving(null)}>
          KEEP IT
        </Button>
      </Sheet>

      <Sheet
        visible={showDropped}
        onClose={() => setShowDropped(false)}
        title={droppedSets.length === 1 ? "A set didn't save" : "Some sets didn't save"}
      >
        {droppedSets.map((item) => (
          <Text key={item.id} style={styles.droppedRow}>
            {String(item.payload.weightLb ?? "?")} × {String(item.payload.reps ?? "?")}
          </Text>
        ))}
        <Text style={styles.droppedWhy}>
          {droppedSets[0]?.lastError ?? "The server refused the write."}
        </Text>
        <Button size="lg" onPress={retryDropped}>
          RETRY {droppedSets.length === 1 ? "IT" : "THEM"}
        </Button>
        <Button
          variant="ghost"
          style={styles.secondary}
          onPress={() => {
            setAckedDrops(queued.dropped.length);
            setShowDropped(false);
          }}
        >
          LET THEM GO
        </Button>
      </Sheet>

      <StopSheet
        visible={stopping}
        queuedSetCount={queued.setCount}
        onClose={() => setStopping(false)}
        onStopped={onStopped}
      />
    </Screen>
  );
}

/**
 * Page dots, with real tap targets.
 *
 * Six-point dots are an indicator, not a control, so each one gets a generous
 * `hitSlop` rather than being drawn 44pt wide. A fifth exercise is otherwise
 * four swipes away from the first.
 */
function Dots({
  count,
  active,
  onPick,
}: {
  count: number;
  active: number;
  onPick: (index: number) => void;
}) {
  if (count <= 1) return null;

  return (
    <View style={styles.dots}>
      {Array.from({ length: count }, (_, i) => (
        <Pressable
          key={i}
          hitSlop={10}
          onPress={() => {
            tapSelect();
            onPick(i);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Page ${i + 1} of ${count}`}
        >
          <View style={[styles.dot, i === active && styles.dotActive]} />
        </Pressable>
      ))}
    </View>
  );
}
