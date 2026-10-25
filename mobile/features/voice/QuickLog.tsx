import { useCallback, useMemo, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { Button, NumberPad, color, space } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { tapDone, tapError, tapSave, tapSelect } from "@/lib/haptics";
import { enqueue } from "@/lib/outbox";
import { queryKeys } from "@/lib/query";
import { ExercisePicker } from "@/features/lift";
// The module, not `@/features/today`'s barrel. That barrel's default export IS
// the Today screen, so importing the hook through it drags the whole dashboard
// into this module graph for one `useQuery`. `SettingsScreen` reaches for the
// same hook the same way, for the same reason.
import { useBootstrap } from "@/features/today/useBootstrap";
import type { Bootstrap, CatalogueExercise, ExerciseHistory, TranscribeResponse } from "@/lib/types";

import { ConfirmSheet } from "./ConfirmSheet";
import { GroupActions } from "./GroupActions";
import { TextEntry } from "./TextEntry";
import { TextPrompt } from "./TextPrompt";
import { VoiceButton } from "./VoiceButton";
import { deleteExercise, learnAlias, parseSets, queueCue, saveCue } from "./requests";
import {
  PAD_META,
  aliasToLearn,
  blankRow,
  createdExerciseIds,
  cueError,
  cueFor,
  deleteGroup,
  deleteRow,
  duplicateRow,
  fieldToPad,
  groupRows,
  markFirstWarmups,
  normaliseCue,
  padToPatch,
  patchGroup,
  patchRow,
  payloadsFor,
  refileEntry,
  rowsFromParse,
  shouldQueueCue,
  type LogRow,
  type PadField,
  type RowPatch,
  type SourceKind,
} from "./model";

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: space.sm },
  type: { flex: 1 },
  notice: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: space.sm },
  noticeBad: { color: color.bad },
});

type Stage = "idle" | "typing" | "confirming";

/**
 * What the prose editor is attached to.
 *
 * Three targets, one `TextPrompt`, and the third is a different KIND of thing
 * from the first two. A `row` or `group` note is local state that confirm
 * writes with the sets; a `cue` is pinned to the exercise on the server and is
 * saved the instant it is typed. They share the editor because they are both
 * "type a sentence about this", and nothing else.
 */
type NoteTarget =
  | { kind: "row"; key: string }
  | { kind: "group"; entryKey: string }
  | { kind: "cue"; exerciseId: string; exerciseName: string };

/**
 * Type a set, check it, log it.
 *
 * This is the primary door. The user's words when they cut the scope down:
 * "the most important thing is just the ability to free type the updates and
 * ensure they are parsed into the correct fields". So the typed path is the one
 * that must work, it is the wider of the two buttons, and it depends on nothing
 * but `POST /api/sets/parse` — which has been in production since before this
 * project started. The mic beside it is a second way to fill the same field and
 * can be absent without this flow losing anything.
 *
 * The state machine is three stages and lives here rather than in a reducer
 * because every transition is one user action: type → confirm → queued. What is
 * *not* here is any decision about what the rows mean; that is all in `model.ts`
 * where it is unit tested, because "did 3 sets of 6" becoming two sets of three
 * is the kind of bug you only find in a gym.
 *
 * Every overlay the flow needs — the pad, the exercise picker, the group's bulk
 * actions, the note editor — is a sibling of the confirmation sheet and is
 * owned here. They all have to agree about which row or which entry is being
 * edited, and threading that through a parent is how two of them end up
 * disagreeing. They are siblings rather than nested because each is its own
 * `Modal`: the later one draws over the sheet and the sheet does not move.
 *
 * The note editor is also the CUE editor — a lift's carry-forward cue, pinned
 * on the server and shown above that lift's sets every time. It is the one
 * write in this component that does not go through the outbox and is not gated
 * on confirm; `persistCue` below says why, and the two meanings are kept apart
 * by the editor's own copy rather than by a second screen.
 */
export function QuickLog({
  exerciseId,
  exerciseName,
  onConfirmed,
  onBeforeLog,
  showVoice = true,
}: {
  /** The exercise under the thumb, if there is one. Prefills the by-hand row. */
  exerciseId?: string | null;
  /** Also sent as the transcription hint, to bias decoding toward this name. */
  exerciseName?: string | null;
  /** Fired after the sets are queued, so the caller can refetch or close. */
  onConfirmed?: () => void;
  /**
   * Run before anything is queued, and awaited.
   *
   * The start screen passes the session start through here. `POST /api/sets`
   * resolves the workout server-side and the set payload carries no workout id,
   * so the only thing that makes a set land in the right session is the order of
   * the queue — the start has to be enqueued first. Awaiting it is what
   * guarantees that.
   */
  onBeforeLog?: () => void | Promise<void>;
  showVoice?: boolean;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [rows, setRows] = useState<LogRow[]>([]);
  const [sourceText, setSourceText] = useState("");
  const [sourceKind, setSourceKind] = useState<SourceKind>("typed");
  const [usedModel, setUsedModel] = useState(false);

  const [busy, setBusy] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  /** One inline line under the bar. Never an `Alert`, for anything. */
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);

  const [editing, setEditing] = useState<{ key: string; field: PadField } | null>(null);
  const [padValue, setPadValue] = useState("");
  const [picking, setPicking] = useState<{ entryKey: string; query: string } | null>(null);
  /** Which group's bulk-action sheet is open, by `entryKey`. */
  const [bulkFor, setBulkFor] = useState<string | null>(null);
  const [noting, setNoting] = useState<NoteTarget | null>(null);
  /** True while a cue is in flight; `cueProblem` is why the last one failed. */
  const [savingCue, setSavingCue] = useState(false);
  const [cueProblem, setCueProblem] = useState<string | null>(null);

  /**
   * Where CANCEL goes from the text screen.
   *
   * Opened from the bar it closes the flow; opened by tapping the source line
   * in the confirmation sheet it has to go back to the sheet with the rows still
   * on it, or a mistyped correction throws away a parse that was nearly right.
   */
  const [returnToSheet, setReturnToSheet] = useState(false);

  const groups = useMemo(() => groupRows(rows), [rows]);
  const bulkGroup = groups.find((group) => group.entryKey === bulkFor) ?? null;

  /**
   * The carry-forward cues, read off the payload every host screen already
   * loaded.
   *
   * `useBootstrap` rather than a request of this feature's own, and that is
   * the whole reason the cues ship in `bootstrap` at all: both screens that
   * mount this — the lift start screen and the session screen — are already
   * holding that payload, react-query dedupes by key, so a cue is on screen in
   * a basement with no round trip of any kind. Nothing here fetches.
   */
  const client = useQueryClient();
  const { data: bootstrap } = useBootstrap();
  const cues = bootstrap?.cues;

  /**
   * Write one cue, and tell every screen that reads cues.
   *
   * Three things are deliberate.
   *
   * It is NOT gated on confirm and NOT undone by DISCARD. A cue is a fact
   * about the exercise; the sets in the sheet are a separate decision, and
   * taking a cue back because a parse was discarded would be the app
   * overruling something the owner did on purpose.
   *
   * The RESPONSE's cue is what lands in the cache, never the local draft. The
   * server trims the ends, normalises CRLF, strips trailing spaces per line
   * and collapses runs of blank lines, so the two strings are not always
   * equal — and the one the database holds is the one the next bootstrap will
   * send. A cleared cue is DELETED from the map rather than stored as `""`,
   * because absence is the only representation of "no cue" the server has and
   * a second one would need every consumer to know about it.
   *
   * A failure that retrying could fix QUEUES rather than stopping. A cue is
   * typed on the same concrete the sets are, and a sentence the owner wrote
   * about their own lifting is not worth less than a set — so a dead signal
   * sends it to the outbox, the editor closes, and the cue is on screen
   * immediately. Only a refusal the server will repeat (too long, or a lift it
   * cannot see) keeps the editor open with the draft still in it, because that
   * is the one the owner has to change something to fix.
   *
   * In the queued path alone, the cache gets the LOCALLY normalised draft:
   * there is no response to take the authoritative string from. That is sound
   * because `normaliseCue` here is a byte-identical mirror of the server's and
   * a test asserts it as text, so the string painted now is the string the next
   * bootstrap will send.
   */
  const persistCue = useCallback(async (exerciseId: string, draft: string) => {
    setSavingCue(true);
    setCueProblem(null);

    /** Put one cue into every cache that holds cues. `null` clears it. */
    const patch = (cue: string | null) => {
      client.setQueryData<Bootstrap>(queryKeys.bootstrap, (current) => {
        if (current === undefined) return current;
        const next = { ...(current.cues ?? {}) };
        if (cue === null) delete next[exerciseId];
        else next[exerciseId] = cue;
        return { ...current, cues: next };
      });
      /*
       * The exercise detail screen edits the same cue and holds its own copy
       * of it from `GET /api/mobile/exercise`. Patching one cache and leaving
       * the other is how the two screens come to disagree.
       *
       * WRITTEN, not invalidated, and that distinction is the whole bug this
       * replaced. Invalidating asks the server for the truth, which is correct
       * online and exactly wrong in the queued branch below: offline there IS
       * no server copy yet, the outbox has not flushed, and `mobile/lib/outbox.ts`
       * invalidates nothing after it does. So the refetch returned the PRE-EDIT
       * cue, React Query cached it as fresh, and the detail screen showed
       * superseded text — or no cue at all, if this was the first one — until
       * the app was relaunched. Offline is the case `queueCue` exists for.
       *
       * Writing is right in both branches: online the server has already
       * answered and `saved.cue` is that answer, so a refetch would only cost a
       * request to be told what we know.
       */
      client.setQueryData<ExerciseHistory>(queryKeys.exercise(exerciseId), (current) =>
        current === undefined ? current : { ...current, cue },
      );
    };

    try {
      const saved = await saveCue(exerciseId, draft);
      patch(saved.cue);
      tapSave();
      setNoting(null);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;

      if (shouldQueueCue(status)) {
        try {
          await queueCue(exerciseId, draft);
          // The server has not spoken, so the mirror speaks for it.
          const local = normaliseCue(draft);
          patch(local === "" ? null : local);
          tapSave();
          setNoting(null);
          return;
        } catch {
          // The queue itself would not take it — SQLite unavailable, which is
          // the one case where there is nowhere to put the words but the
          // screen. Fall through to the editor rather than claiming a save.
        }
      }

      tapError();
      setCueProblem(
        err instanceof Error && err.message !== ""
          ? err.message
          : "Could not save that cue.",
      );
    } finally {
      setSavingCue(false);
    }
  }, [client]);

  const openCue = useCallback((exerciseId: string, exerciseName: string) => {
    setBulkFor(null);
    setCueProblem(null);
    setNoting({ kind: "cue", exerciseId, exerciseName });
  }, []);

  const clear = useCallback(() => {
    setStage("idle");
    setRows([]);
    setSourceText("");
    setUsedModel(false);
    setBusy(false);
    setEntryError(null);
    setSheetError(null);
    setEditing(null);
    setPicking(null);
    setBulkFor(null);
    setNoting(null);
    setSavingCue(false);
    setCueProblem(null);
    setReturnToSheet(false);
  }, []);

  /**
   * Hand back an exercise the parse created and nothing now points at.
   *
   * Creation happens during the PARSE, not at confirm: the sheet needs a real
   * exercise id before a set can reference one, and the outbox contract — a set
   * upserted on `(workout_id, client_id)` — is the one thing in this app that
   * must not change to accommodate a draft id. The cost is an orphan row with
   * zero sets whenever a parse is re-filed or discarded, and this is how it is
   * paid back.
   *
   * Fire and forget, and failure is deliberately silent. `DELETE
   * /api/mobile/exercise` 409s when the exercise has sets (so it can never take
   * history with it) and 404s when it is not the caller's; an unreachable
   * server leaves an empty exercise in the catalogue, which is invisible in
   * every screen that ranks by volume. None of that is worth a line of error
   * text over a set the user is in the middle of logging.
   */
  const dropCreated = useCallback((ids: string[]) => {
    for (const id of ids) {
      void deleteExercise(id).catch(() => {
        /* An unreferenced exercise is not worth telling the user about. */
      });
    }
  }, []);

  /** DISCARD: the rows go, and so does anything the parse created for them. */
  const discard = useCallback(() => {
    dropCreated(createdExerciseIds(rows));
    clear();
  }, [rows, dropCreated, clear]);

  /**
   * Delete one set row, and drop a created exercise the moment nothing points
   * at it any more.
   *
   * Deleting rows one at a time used to leak: only the bulk group delete
   * dropped the exercise, so removing a `new` group's last row by its own `×`
   * left the created row behind with the typed wording learned as its alias.
   * Rather than special-case "was that the last one", this recomputes what is
   * still referenced after the delete — which is correct whichever row goes,
   * and stays correct if the grouping changes.
   *
   * The side effect is deliberately outside `setRows`: a state updater can be
   * invoked twice, and firing DELETEs from inside one would double-send them.
   */
  const removeRow = useCallback((key: string) => {
    const next = deleteRow(rows, key);
    const stillReferenced = new Set(
      next.map((r) => r.exerciseId).filter((id): id is string => id !== null),
    );
    const orphaned = createdExerciseIds(rows).filter((id) => !stillReferenced.has(id));
    if (orphaned.length > 0) dropCreated(orphaned);
    setRows(next);
  }, [rows, dropCreated]);

  const submit = useCallback(async (text: string) => {
    setBusy(true);
    setEntryError(null);

    try {
      const parsed = await parseSets(text);
      setRows(rowsFromParse(parsed));
      setSourceText(text);
      setSourceKind("typed");
      setUsedModel(parsed.usedModel);
      setSheetError(null);
      setStage("confirming");
      setReturnToSheet(false);
    } catch (err) {
      tapError();
      // The text stays on screen. Losing a sentence because the request failed
      // is the one thing that would make the user stop using this.
      setEntryError(
        err instanceof ApiError && err.status === 0
          ? "No answer from the server. The typed line is still here — try again, or log it by hand."
          : err instanceof Error
            ? err.message
            : "Could not parse that.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * The mic's result arrives already parsed, so it skips straight to the sheet.
   *
   * `/api/voice/transcribe` returns the transcript plus the exact
   * `/api/sets/parse` body for exactly this reason: one confirmation UI, one
   * set of correction rules, whichever door the text came in through.
   */
  const adoptTranscript = useCallback((parsed: TranscribeResponse) => {
    setRows(rowsFromParse(parsed));
    setSourceText(parsed.transcript);
    setSourceKind("heard");
    setUsedModel(parsed.usedModel);
    setSheetError(null);
    setNotice(null);
    setStage("confirming");
  }, []);

  const openPad = useCallback((key: string, field: PadField) => {
    tapSelect();
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    setPadValue(fieldToPad(row, field));
    setEditing({ key, field });
  }, [rows]);

  const commitPad = useCallback(() => {
    if (editing === null) return;
    tapSave();
    setRows((current) => patchRow(current, editing.key, padToPatch(editing.field, padValue)));
    setEditing(null);
  }, [editing, padValue]);

  /**
   * Re-file an entry onto a chosen exercise, and tidy up after the choice.
   *
   * Three things happen and all three are deliberate: the rows move, the
   * wording is taught to the server so the same phrase is free next time, and
   * an exercise this parse created on the way here is handed back. Without the
   * third, correcting an auto-created "Incline Smith Press" onto the right lift
   * would leave the wrong one in the catalogue forever — which is the duplicate
   * the near-miss question exists to prevent, arriving by another road.
   */
  const refile = useCallback((entryKey: string, exercise: { id: string; name: string; equipment?: string }) => {
    // Read the alias off `rows` and send it here, outside the state updater.
    // React may call an updater more than once for the same update, and a
    // network request in one would then fire twice.
    const alias = aliasToLearn(rows, entryKey, exercise);
    if (alias !== null) {
      // Fire and forget. The alias makes the same wording free next time; it is
      // not worth blocking the sets the user is about to confirm, and the server
      // upserts so a repeat is harmless.
      void learnAlias(alias.exerciseId, alias.alias).catch(() => {
        /* The correction still applies locally. Nothing to tell the user. */
      });
    }

    const orphaned = rows
      .filter((row) => row.entryKey === entryKey && row.match === "new")
      .map((row) => row.exerciseId)
      .filter((id): id is string => id !== null && id !== exercise.id);
    dropCreated([...new Set(orphaned)]);

    setRows((current) => refileEntry(current, entryKey, exercise));
  }, [rows, dropCreated]);

  const applyPick = useCallback((exercise: CatalogueExercise) => {
    const target = picking;
    setPicking(null);
    if (target === null) return;
    refile(target.entryKey, exercise);
  }, [picking, refile]);

  const confirm = useCallback(async () => {
    setSheetError(null);
    setQueueing(true);

    try {
      if (onBeforeLog) await onBeforeLog();

      // One outbox item per row, each with its own client id, through the same
      // queue manual logging uses. Never a direct POST: a set confirmed in a
      // basement has to survive the walk to the car park.
      for (const payload of payloadsFor(rows, sourceText)) {
        await enqueue("set", "/api/sets", { ...payload });
      }

      tapDone();
      const n = rows.length;
      setNotice({ text: `${n} set${n === 1 ? "" : "s"} queued.`, bad: false });
      // `clear`, not `discard`: an exercise the parse created is now referenced
      // by a queued set and must survive.
      clear();
      onConfirmed?.();
    } catch (err) {
      tapError();
      console.error("[voice] could not queue the parsed sets", err);
      setSheetError("Could not queue those on this phone. Nothing was logged — try again.");
    } finally {
      setQueueing(false);
    }
  }, [rows, sourceText, onBeforeLog, onConfirmed, clear]);

  const meta = editing === null ? PAD_META.weight : PAD_META[editing.field];

  /** The note or cue being edited, and a line saying what it belongs to. */
  const notingText = (() => {
    if (noting === null) return "";
    // The cue comes from the server's map, not from a row — it belongs to the
    // lift, and it is the stored, normalised string the server sent back.
    if (noting.kind === "cue") return cueFor(noting.exerciseId, cues) ?? "";
    if (noting.kind === "row") return rows.find((row) => row.key === noting.key)?.note ?? "";
    // One shared note for a whole exercise: offer the first one as a starting
    // point rather than an empty field, since "same as the others" is the
    // commonest reason to use this at all.
    return rows.find((row) => row.entryKey === noting.entryKey)?.note ?? "";
  })();

  const notingWhere = (() => {
    if (noting === null) return undefined;
    if (noting.kind === "cue") return noting.exerciseName;
    if (noting.kind === "group") {
      const group = groups.find((g) => g.entryKey === noting.entryKey);
      if (group === undefined) return undefined;
      return `All ${group.rows.length} sets · ${group.exerciseName ?? group.query}`;
    }
    for (const group of groups) {
      const at = group.rows.findIndex((row) => row.key === noting.key);
      if (at !== -1) return `Set ${at + 1} · ${group.exerciseName ?? group.query}`;
    }
    return undefined;
  })();

  const editingCue = noting?.kind === "cue";

  return (
    <View>
      <View style={styles.bar}>
        {/*
          Wider than the mic, and first in the reading order. A user who never
          taps the mic must not feel they are on a degraded path — for now this
          IS the path.
        */}
        <Button
          size="lg"
          style={styles.type}
          onPress={() => {
            tapSelect();
            setNotice(null);
            setEntryError(null);
            setReturnToSheet(false);
            setStage("typing");
          }}
        >
          TYPE IT
        </Button>

        {showVoice && (
          <VoiceButton
            exerciseName={exerciseName ?? null}
            onTranscribed={adoptTranscript}
            onNotice={(text, bad) => setNotice(text === null ? null : { text, bad: bad === true })}
          />
        )}
      </View>

      {notice !== null && (
        <Text style={[styles.notice, notice.bad && styles.noticeBad]}>{notice.text}</Text>
      )}

      <TextEntry
        visible={stage === "typing"}
        initialText={sourceText}
        submitLabel={returnToSheet ? "RE-PARSE" : "PARSE"}
        busy={busy}
        error={entryError}
        onSubmit={(text) => void submit(text)}
        onCancel={() => {
          if (returnToSheet) {
            setStage("confirming");
            setEntryError(null);
            return;
          }
          discard();
        }}
      />

      <ConfirmSheet
        visible={stage === "confirming"}
        rows={rows}
        sourceText={sourceText}
        sourceKind={sourceKind}
        usedModel={usedModel}
        cues={cues}
        queueing={queueing}
        error={sheetError}
        onEditSource={() => {
          /*
           * TAP TO FIX throws these rows away and re-parses, so anything the
           * last parse created is already unreferenced — and it is the most
           * likely thing in the sheet to be junk, because wanting to fix the
           * text is usually what a mis-created exercise looks like.
           *
           * Dropping it here is not tidiness. `createUserExercise` learned the
           * typed wording as an alias of that row, so leaving it behind means
           * the typo resolves EXACTLY to the junk exercise from then on — the
           * split-history failure the near-miss question exists to prevent,
           * arriving by the one road the other three cleanup sites miss.
           *
           * Deleting the exercise takes its aliases with it (ON DELETE
           * CASCADE), so the corrected text re-parses from a clean slate.
           */
          dropCreated(createdExerciseIds(rows));
          setReturnToSheet(true);
          setEntryError(null);
          setStage("typing");
        }}
        onOpenPad={openPad}
        onPatch={(key: string, patch: RowPatch) => setRows((c) => patchRow(c, key, patch))}
        onOpenNote={(key) => setNoting({ kind: "row", key })}
        onEditCue={openCue}
        onDuplicate={(key) => setRows((c) => duplicateRow(c, key))}
        onDelete={(key) => removeRow(key)}
        onPickExercise={(entryKey, query) => {
          // Closing the bulk sheet first: two `Modal`s presenting at once is
          // the one thing that reliably leaves iOS showing neither.
          setBulkFor(null);
          setPicking({ entryKey, query });
        }}
        onUseNearMiss={(entryKey, nearMiss) => refile(entryKey, nearMiss)}
        onBulk={(entryKey) => setBulkFor(entryKey)}
        onConfirm={() => void confirm()}
        onLogByHand={() => {
          tapSelect();
          setRows([
            blankRow(
              exerciseId && exerciseName ? { id: exerciseId, name: exerciseName } : null,
            ),
          ]);
        }}
        onClose={discard}
      />

      <GroupActions
        group={bulkGroup}
        cue={cueFor(bulkGroup?.exerciseId ?? null, cues)}
        onClose={() => setBulkFor(null)}
        onPatchGroup={(entryKey, patch) => setRows((c) => patchGroup(c, entryKey, patch))}
        onFirstWarmups={(entryKey, k) => setRows((c) => markFirstWarmups(c, entryKey, k))}
        onNoteForAll={(entryKey) => {
          setBulkFor(null);
          setNoting({ kind: "group", entryKey });
        }}
        onEditCue={openCue}
        onPickExercise={(entryKey, query) => {
          setBulkFor(null);
          setPicking({ entryKey, query });
        }}
        onDeleteGroup={(entryKey) => {
          setBulkFor(null);
          // An exercise this parse created, whose every set has just been
          // deleted, is referenced by nothing. Hand it back.
          const group = groups.find((g) => g.entryKey === entryKey);
          if (group?.match === "new" && group.exerciseId !== null) dropCreated([group.exerciseId]);
          setRows((c) => deleteGroup(c, entryKey));
        }}
      />

      {/*
        One editor, two meanings, and the copy is what tells them apart.

        A SET NOTE is about what happened on these sets and goes with them. A
        CUE is about the lift and comes back every time it is logged, which is
        exactly the thing the owner could not do before — so the footnote says
        so rather than leaving them to find out next session.
      */}
      <TextPrompt
        visible={noting !== null}
        title={editingCue ? "Cue for this lift" : "Set note"}
        subtitle={notingWhere}
        footnote={
          editingCue
            ? "Pinned to this lift. It appears every time you log it, until you change it — it is not logged with the set."
            : undefined
        }
        placeholder={editingCue ? "Elbows tucked, pause on chest…" : undefined}
        submitLabel={editingCue ? "PIN THIS CUE" : undefined}
        clearLabel={editingCue ? "REMOVE THE CUE" : undefined}
        // Only the cue has a server-side ceiling, and `cueError` is the same
        // normalisation the server measures by, so the inline count and the
        // 400 cannot disagree.
        validate={editingCue ? cueError : undefined}
        busy={savingCue}
        error={cueProblem}
        initialText={notingText}
        onSubmit={(text) => {
          const target = noting;
          if (target === null) return;

          // The cue is a network write: it closes this editor only once the
          // server has confirmed it, so a failure leaves the words on screen.
          if (target.kind === "cue") {
            void persistCue(target.exerciseId, text);
            return;
          }

          setNoting(null);
          setRows((c) =>
            target.kind === "row"
              ? patchRow(c, target.key, { note: text })
              : patchGroup(c, target.entryKey, { note: text }));
        }}
        onCancel={() => {
          setCueProblem(null);
          setNoting(null);
        }}
      />

      {/*
        The pad floats over the sheet and the sheet stays where it is. `Screen`
        already reserves the bottom gutter both of them sit in, so nothing
        behind either one reflows — which is the whole reason numbers are not
        typed on the system keyboard in this app.
      */}
      <NumberPad
        visible={editing !== null}
        value={padValue}
        label={meta.label}
        unit={meta.unit}
        allowDecimal={meta.allowDecimal}
        onChange={(next) => {
          tapSelect();
          setPadValue(next);
        }}
        onDone={commitPad}
        onCancel={() => setEditing(null)}
      />

      {/*
        Full screen, over the sheet, pre-filled with the raw wording — so a
        correction is "pick the right one", not "type it from scratch". The sheet
        is left mounted underneath so the rows are still there when this closes.
        `allowCreate` is left at its default: an unresolved phrase is the single
        most likely reason this screen is open, and "preacher curl" has to have
        an answer other than an empty list.
      */}
      <Modal
        visible={picking !== null}
        animationType="slide"
        onRequestClose={() => setPicking(null)}
      >
        {picking !== null && (
          <ExercisePicker
            query={picking.query}
            onPick={applyPick}
            onCancel={() => setPicking(null)}
          />
        )}
      </Modal>
    </View>
  );
}
