import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet } from "@/lib/api";
import { enqueue } from "@/lib/outbox";
import { queryKeys } from "@/lib/query";
import type { Bootstrap, SessionPayload } from "@/lib/types";

import { SessionScreen } from "./SessionScreen";
import { StartScreen } from "./StartScreen";
import { useQueuedWrites } from "./useQueuedWrites";
import { deriveSessionState } from "./logic";

/**
 * The Lift tab.
 *
 * Tapping the tab with a session running goes straight into it — there is no
 * start screen to dismiss, no "resume?" prompt and no extra tap. That is the
 * whole reason this route is one component: the decision between `StartScreen`
 * and `SessionScreen` is made from data, not from navigation, so there is no
 * intermediate state a user can be stranded in.
 */
export default function LiftScreen() {
  const queryClient = useQueryClient();
  const queued = useQueuedWrites();

  const bootstrap = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => apiGet<Bootstrap>("/api/mobile/bootstrap"),
  });

  const session = useQuery({
    queryKey: queryKeys.session,
    queryFn: () => apiGet<SessionPayload>("/api/mobile/session"),
  });

  const [gymId, setGymId] = useState<string | null>(null);
  const [localStartedAt, setLocalStartedAt] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Exercises the next session should open with pages for.
   *
   * Set by REPEAT THIS SESSION and by PICK A LIFT on the start screen, and
   * handed to `SessionScreen` as its initial `addedIds`. It seeds PAGES, not
   * sets: `resolveEntry`'s history rung then reads `bootstrap.lastSets` and puts
   * last session's weight and reps on the hero button, where one tap logs them
   * — and nothing at all is written until that tap.
   */
  const [seedIds, setSeedIds] = useState<string[]>([]);

  const state = deriveSessionState({
    activeStartedAt:
      session.data?.activeWorkout?.startedAt ?? bootstrap.data?.activeWorkout?.startedAt ?? null,
    localStartedAt,
    queuedStartAt: queued.queuedStartAt,
  });

  /**
   * Starting always goes through the outbox, online or not.
   *
   * It would be possible to `POST` directly and fall back to the queue on
   * failure, but that means two code paths for the same action and the fallback
   * one is the one that never gets exercised in development. Queueing
   * unconditionally is both simpler and strictly better: `enqueue` kicks off a
   * flush immediately, so with signal the start lands within a second; without
   * it, the queue delivers in order and the start arrives ahead of the sets.
   * `POST /api/sets` resolves the workout server-side, so the sets need no
   * workout id and there is no new server contract to add.
   *
   * `/api/session/start` is idempotent — an existing session comes back with
   * `resumed: true` — so a retry cannot create a second workout.
   *
   * It returns its promise rather than firing and forgetting, because the start
   * screen's free-text logger calls this before queueing any sets and the queue
   * delivers in `createdAt` order with ties broken by a random uuid. Two
   * enqueues in the same millisecond would therefore be ordered arbitrarily,
   * and a set delivered ahead of its start has no session to land in.
   */
  const start = useCallback(async () => {
    setNotice(null);
    setLocalStartedAt(Date.now());

    const gym =
      gymId ??
      bootstrap.data?.gyms.find((g) => g.isDefault)?.id ??
      bootstrap.data?.gyms[0]?.id ??
      null;

    try {
      await enqueue("session-start", "/api/session/start", { gymId: gym });
    } catch (err) {
      console.error("[lift] could not queue the session start", err);
      setLocalStartedAt(null);
      setNotice("Could not start a session on this phone. Try again.");
    }
  }, [gymId, bootstrap.data]);

  /**
   * Start a session that already has pages for these lifts.
   *
   * The seed is set BEFORE `start()` is awaited, in the same tick, so the
   * `localStartedAt` that flips this component over to `SessionScreen` and the
   * seed that screen initialises from land in one batch — the session mounts
   * with its pages already there rather than mounting empty and filling in.
   */
  const startWith = useCallback(
    async (exerciseIds: string[]) => {
      setSeedIds(exerciseIds);
      await start();
    },
    [start],
  );

  /**
   * A session start the outbox gave up on.
   *
   * `dropStaleStarts` bins a start older than six hours, because the backend
   * auto-abandons stale sessions and a start delivered the next morning would
   * be filed against the wrong `local_date` — which is worse than losing it,
   * since the result looks plausible. Either way the local session has to end,
   * and the user has to be told rather than left with a clock that counts up
   * against nothing.
   */
  const handled = useRef(new Set<string>());
  useEffect(() => {
    const fresh = queued.dropped.filter(
      (item) => item.kind === "session-start" && !handled.current.has(item.id),
    );
    if (fresh.length === 0) return;

    for (const item of fresh) handled.current.add(item.id);
    setLocalStartedAt(null);
    // The session is over before it began, so a seed left behind would page up
    // the repeated lifts the next time START is pressed on its own.
    setSeedIds([]);
    setNotice(
      fresh[0].lastError ??
        "That session could not be saved, so it was not started. The sets logged in it were not filed.",
    );
  }, [queued.dropped]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.session });
    void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });
  }, [queryClient]);

  const refreshing = session.isFetching || bootstrap.isFetching;

  if (!state.active) {
    return (
      <StartScreen
        bootstrap={bootstrap.data}
        gymId={gymId}
        onGymChange={setGymId}
        onStart={start}
        onStartWith={startWith}
        refreshing={refreshing}
        onRefresh={refresh}
        notice={notice ?? errorLine(bootstrap.error, session.error)}
      />
    );
  }

  return (
    <SessionScreen
      bootstrap={bootstrap.data}
      session={session.data}
      queued={queued}
      startedAtMs={state.startedAtMs}
      pendingSession={state.pending}
      notice={notice}
      seedExerciseIds={seedIds}
      onStopped={() => {
        setLocalStartedAt(null);
        setSeedIds([]);
        setNotice(null);
        refresh();
      }}
    />
  );
}

/**
 * One line, inline, never a dialog.
 *
 * Only shown on the start screen: once a session is live, a failed read is not
 * worth saying anything about, because every number on the card that matters
 * either came down with `bootstrap` already or is local.
 */
function errorLine(a: unknown, b: unknown): string | null {
  const err = a ?? b;
  if (err === null || err === undefined) return null;
  return err instanceof Error
    ? `Could not reach the API — ${err.message}`
    : "Could not reach the API.";
}
