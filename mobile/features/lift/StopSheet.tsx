import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button, Label, Sheet, Stat, color, space, tnum } from "@/components/ui";
import { apiPost } from "@/lib/api";
import { tapDone, tapError, tapSelect } from "@/lib/haptics";
import { flushOutbox } from "@/lib/outbox";
import { kgToLb } from "@/lib/shared/units";
import { fmtWeight } from "./logic";

interface StopSummary {
  durationMin: number;
  totalSets: number;
  volumeKg: number;
  muscles: { muscle: string; label: string; sets: number }[];
}

interface StopResult {
  workout: { id: string; name: string | null } | null;
  discarded?: boolean;
  summary?: StopSummary;
}

const styles = StyleSheet.create({
  body: { color: color.ink, fontSize: 14, lineHeight: 20, marginBottom: space.lg },
  warn: { color: color.warn, fontSize: 13, lineHeight: 19, marginBottom: space.lg },
  error: { color: color.bad, fontSize: 13, lineHeight: 19, marginBottom: space.lg },
  stats: { flexDirection: "row", justifyContent: "space-between", marginBottom: space.lg },
  muscles: { ...tnum, color: color.muted, fontSize: 13, lineHeight: 19, marginBottom: space.lg },
  name: { color: color.ink, fontSize: 17, fontWeight: "600", marginBottom: space.md },
  secondary: { marginTop: space.sm },
});

type Phase = "confirm" | "syncing" | "stopping" | "summary" | "error";

/**
 * Ending the session: a sheet, never a `confirm()` and never an `Alert`.
 *
 * It also carries the one piece of hazard-handling in this flow that the server
 * cannot do for us. `POST /api/sets` resolves the workout through
 * `getActiveWorkout()`, so once the session is completed a queued set has
 * nowhere to land: it comes back 400, the outbox classifies a 4xx as permanent
 * and drops it, and the user silently loses sets they actually did. So stopping
 * flushes the queue first and refuses to complete the session while sets are
 * still waiting — with an explicit override, because refusing outright would
 * strand someone whose gym has no signal at all.
 *
 * This is the one place in the flow that waits on the network, and it is the
 * right place: nothing is being logged, and the alternative is losing data.
 */
export function StopSheet({
  visible,
  queuedSetCount,
  onClose,
  onStopped,
}: {
  visible: boolean;
  queuedSetCount: number;
  onClose: () => void;
  onStopped: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [result, setResult] = useState<StopResult | null>(null);
  const [error, setError] = useState("");
  const [forced, setForced] = useState(false);

  function close() {
    onClose();
    // Reset after the sheet is dismissed, so reopening it starts at the
    // confirmation rather than on last session's summary.
    setPhase("confirm");
    setResult(null);
    setError("");
    setForced(false);
  }

  async function stop() {
    tapSelect();

    if (queuedSetCount > 0 && !forced) {
      setPhase("syncing");
      await flushOutbox();
      // Re-read through the prop on the next render rather than trusting the
      // flush result: the parent is subscribed to the outbox and is the only
      // thing that knows the current count.
      setPhase("confirm");
      setForced(true);
      return;
    }

    setPhase("stopping");
    try {
      const res = await apiPost<StopResult>("/api/session/stop", {});
      setResult(res);
      setPhase("summary");
      tapDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not end the session.");
      setPhase("error");
      tapError();
    }
  }

  const title =
    phase === "summary" ? (result?.discarded === true ? "Nothing to save" : "Session done") : "End this session?";

  return (
    <Sheet visible={visible} onClose={phase === "stopping" ? () => {} : close} title={title}>
      {phase === "summary" ? (
        <Summary result={result} onDone={() => {
          close();
          onStopped();
        }} />
      ) : (
        <>
          {phase === "error" && <Text style={styles.error}>{error}</Text>}

          {queuedSetCount > 0 && (
            <Text style={styles.warn}>
              {queuedSetCount} {queuedSetCount === 1 ? "set is" : "sets are"} still only on this
              phone. Ending the session now means {queuedSetCount === 1 ? "it" : "they"} cannot be
              filed against it.
            </Text>
          )}

          <Text style={styles.body}>
            The session is saved as you go, so nothing you have already logged is lost. Ending it
            closes it out and names it.
          </Text>

          <Button
            size="lg"
            onPress={() => void stop()}
            disabled={phase === "syncing" || phase === "stopping"}
          >
            {phase === "syncing"
              ? "SYNCING…"
              : phase === "stopping"
                ? "ENDING…"
                : queuedSetCount > 0 && !forced
                  ? "SYNC, THEN END"
                  : queuedSetCount > 0
                    ? "END ANYWAY"
                    : "END SESSION"}
          </Button>

          <Button
            variant="ghost"
            size="md"
            style={styles.secondary}
            onPress={close}
            disabled={phase === "stopping"}
          >
            KEEP LIFTING
          </Button>
        </>
      )}
    </Sheet>
  );
}

function Summary({ result, onDone }: { result: StopResult | null; onDone: () => void }) {
  if (result === null || result.workout === null) {
    return (
      <>
        <Text style={styles.body}>
          That session had no sets in it, so it was discarded rather than saved as an empty
          workout.
        </Text>
        <Button size="lg" onPress={onDone}>
          DONE
        </Button>
      </>
    );
  }

  const summary = result.summary;

  return (
    <>
      {result.workout.name !== null && <Text style={styles.name}>{result.workout.name}</Text>}

      {summary !== undefined && (
        <>
          <View style={styles.stats}>
            <Stat label="Minutes" value={String(summary.durationMin)} />
            <Stat label="Hard sets" value={String(summary.totalSets)} />
            {/*
              `volumeKg` is the one figure the stop route returns in kg. Every
              other weight in this app crosses the wire in lb, so it is
              converted here rather than displayed in a unit the user does not
              think in.
            */}
            <Stat label="Volume" value={`${fmtWeight(Math.round(kgToLb(summary.volumeKg)))} lb`} />
          </View>

          {summary.muscles.length > 0 && (
            <>
              <Label>Worked</Label>
              <Text style={styles.muscles}>
                {summary.muscles
                  .slice(0, 6)
                  .map((m) => `${m.label} ${m.sets}`)
                  .join(" · ")}
              </Text>
            </>
          )}
        </>
      )}

      <Button size="lg" onPress={onDone}>
        DONE
      </Button>
    </>
  );
}
