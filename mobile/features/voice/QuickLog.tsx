import { useCallback, useMemo, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";

import { Button, NumberPad, color, space } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { tapDone, tapError, tapSave, tapSelect } from "@/lib/haptics";
import { enqueue } from "@/lib/outbox";
import { ExercisePicker } from "@/features/lift";
import type { CatalogueExercise, TranscribeResponse } from "@/lib/types";

import { ConfirmSheet } from "./ConfirmSheet";
import { GroupActions } from "./GroupActions";
import { TextEntry } from "./TextEntry";
import { TextPrompt } from "./TextPrompt";
import { VoiceButton } from "./VoiceButton";
import { deleteExercise, learnAlias, parseSets } from "./requests";
import {
  PAD_META,
  aliasToLearn,
  blankRow,
  createdExerciseIds,
  deleteGroup,
  deleteRow,
  duplicateRow,
  fieldToPad,
  groupRows,
  markFirstWarmups,
  padToPatch,
  patchGroup,
  patchRow,
  payloadsFor,
  refileEntry,
  rowsFromParse,
  type LogRow,
  type PadField,
  type RowPatch,
} from "./model";

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: space.sm },
  type: { flex: 1 },
  notice: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: space.sm },
  noticeBad: { color: color.bad },
});

type Stage = "idle" | "typing" | "confirming";

/** What a note being typed is attached to. */
type NoteTarget = { kind: "row"; key: string } | { kind: "group"; entryKey: string };

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
  const [sourceLabel, setSourceLabel] = useState("TYPED");
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

  const submit = useCallback(async (text: string) => {
    setBusy(true);
    setEntryError(null);

    try {
      const parsed = await parseSets(text);
      setRows(rowsFromParse(parsed));
      setSourceText(text);
      setSourceLabel("TYPED");
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
    setSourceLabel("HEARD");
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

  /** The note being edited, and a line saying which set it belongs to. */
  const notingText = (() => {
    if (noting === null) return "";
    if (noting.kind === "row") return rows.find((row) => row.key === noting.key)?.note ?? "";
    // One shared note for a whole exercise: offer the first one as a starting
    // point rather than an empty field, since "same as the others" is the
    // commonest reason to use this at all.
    return rows.find((row) => row.entryKey === noting.entryKey)?.note ?? "";
  })();

  const notingWhere = (() => {
    if (noting === null) return undefined;
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
        sourceLabel={sourceLabel}
        usedModel={usedModel}
        queueing={queueing}
        error={sheetError}
        onEditSource={() => {
          setReturnToSheet(true);
          setEntryError(null);
          setStage("typing");
        }}
        onOpenPad={openPad}
        onPatch={(key: string, patch: RowPatch) => setRows((c) => patchRow(c, key, patch))}
        onOpenNote={(key) => setNoting({ kind: "row", key })}
        onDuplicate={(key) => setRows((c) => duplicateRow(c, key))}
        onDelete={(key) => setRows((c) => deleteRow(c, key))}
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
        onClose={() => setBulkFor(null)}
        onPatchGroup={(entryKey, patch) => setRows((c) => patchGroup(c, entryKey, patch))}
        onFirstWarmups={(entryKey, k) => setRows((c) => markFirstWarmups(c, entryKey, k))}
        onNoteForAll={(entryKey) => {
          setBulkFor(null);
          setNoting({ kind: "group", entryKey });
        }}
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

      <TextPrompt
        visible={noting !== null}
        title="Set note"
        subtitle={notingWhere}
        initialText={notingText}
        onSubmit={(text) => {
          const target = noting;
          setNoting(null);
          if (target === null) return;
          setRows((c) =>
            target.kind === "row"
              ? patchRow(c, target.key, { note: text })
              : patchGroup(c, target.entryKey, { note: text }));
        }}
        onCancel={() => setNoting(null)}
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
