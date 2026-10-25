import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";

import { Button, color, hit, radius, space, tnum } from "@/components/ui";
import { microLabel } from "@/components/ui/Label";
import { tapSelect } from "@/lib/haptics";
import { groupSummary, type MatchState, type SetGroup } from "./model";

/** Below this there is nothing to apply in bulk, so the `⋯` is not offered. */
export const BULK_MIN_SETS = 3;

const styles = StyleSheet.create({
  root: {
    paddingTop: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },

  nameRow: {
    minHeight: hit.min,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  namePressed: { opacity: 0.6 },
  name: { color: color.ink, fontSize: 17, fontWeight: "600", flexShrink: 1 },
  nameFuzzy: { color: color.warn },
  nameNew: { color: color.accent },
  nameBad: { color: color.bad, fontSize: 15, fontWeight: "500" },

  chip: {
    borderWidth: 1,
    borderColor: color.accent,
    backgroundColor: color.accentSoft,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  chipText: { ...microLabel, marginBottom: 0, color: color.accentInk },

  spacer: { flex: 1 },
  equipment: { ...microLabel, marginBottom: 0, textAlign: "right" },

  evidence: { ...microLabel, marginBottom: 0, marginTop: 2 },

  /**
   * The carry-forward cue, and the one block on this header drawn on a filled
   * surface rather than as bare type.
   *
   * It is the only thing here the owner WROTE. The name, the equipment, the
   * `heard:` line and the `ignored:` line are all the app reporting what it
   * worked out; the cue is their own instruction to themselves, coming back at
   * the moment it is useful. A filled box says "this came from you" without
   * needing a word to say it, and it keeps a two-line cue from reading as a
   * third machine-generated evidence line.
   *
   * No left border, deliberately: the group already carries a 2pt left border
   * for its match state and a second one 12pt inside it reads as a nesting
   * level that does not exist.
   */
  cue: {
    marginTop: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    backgroundColor: color.surface2,
  },
  cuePressed: { opacity: 0.6 },
  cueLabel: { ...microLabel, marginBottom: space.xs, color: color.accentInk },
  // No `numberOfLines`. A cue may hold a newline — "elbows tucked" above
  // "pause on chest" — and that is the only formatting the field has.
  cueText: { color: color.ink, fontSize: 13, lineHeight: 19 },

  addCue: {
    minHeight: hit.min,
    justifyContent: "center",
    paddingHorizontal: space.sm,
    marginVertical: -space.sm,
  },
  addCuePressed: { opacity: 0.55 },
  addCueText: { ...microLabel, marginBottom: 0, color: color.accentInk },

  askRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs },
  askText: { color: color.ink, fontSize: 14, flex: 1 },
  askButton: { paddingHorizontal: space.md },

  pick: { marginTop: space.sm },

  summaryRow: { flexDirection: "row", alignItems: "center", marginTop: space.xs },
  summary: { ...microLabel, ...tnum, marginBottom: 0 },
  bulk: {
    width: hit.min,
    height: hit.min,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: -space.sm,
  },
  bulkPressed: { opacity: 0.55 },
  bulkText: { color: color.muted, fontSize: 22, lineHeight: 24 },
});

/**
 * The 2pt left border that marks a whole group, by state.
 *
 * Exported because it belongs on the wrapper *around* the header and its lines
 * — a border on the header alone would stop at the first set and read as a
 * divider rather than as "everything under here is uncertain". The sheet owns
 * that wrapper; this owns what the states look like.
 */
export const GROUP_BORDER: Record<MatchState, ViewStyle> = {
  exact: {},
  fuzzy: { borderLeftWidth: 2, borderLeftColor: color.warn, paddingLeft: space.md },
  new: { borderLeftWidth: 2, borderLeftColor: color.accent, paddingLeft: space.md },
  none: { borderLeftWidth: 2, borderLeftColor: color.bad, paddingLeft: space.md },
};

/**
 * One exercise, and how certain the app is that it is the right one.
 *
 * ── WHY THE FOUR STATES LOOK DIFFERENT ─────────────────────────────────────
 *
 * A confident wrong match is the worst outcome in this app: it logs cleanly,
 * looks correct, and splits a year of trend history in two with nothing on
 * screen to say so. The owner hit it twice in one paste — "incline smith press"
 * matched Incline *Barbell* Press and "cable rope hammer curls" matched
 * *Dumbbell* Curl — so this header spends its space on the distinction:
 *
 *  - `exact`  plain. Nothing to doubt, nothing to read.
 *  - `fuzzy`  `~`, warn colour, and the raw wording ALWAYS printed underneath.
 *             Never collapsed, even when the strings look similar: the point is
 *             to be able to compare them without remembering what was typed.
 *  - `new`    `+`, accent, a NEW chip and the wording it was created from. A
 *             lift that did not exist before this paste is a permanent addition
 *             to the catalogue and must be noticeable — and no more than that,
 *             because zero taps for a genuinely new lift was the instruction.
 *             Confirm is NOT blocked by it.
 *  - `none`   the wording that failed, in bad colour, and a real full-width
 *             button. The chip that was "technically tappable" is why the owner
 *             said the UI would not let them fix it.
 *
 * The EQUIPMENT on the right is the other half of the same fix. "Incline Press
 * · SMITH" and "Incline Press · BARBELL" differ by one word in the middle of a
 * name; they differ at a glance in a column.
 *
 * ── WHY THE CUE IS HERE AND NOT ANYWHERE ELSE ──────────────────────────────
 *
 * The owner asked for "a place to add notes per exercise". A cue is pinned to
 * the lift and shown every time it is logged, so the only honest place for it
 * is between the lift's name and its sets — the one spot on the phone where
 * those two facts are already on screen together, with the number pad a tap
 * away and the bar still in your hands.
 *
 * It is deliberately NOT inside the `⋯` sheet, which is the obvious cheap
 * answer and is wrong twice: that sheet only appears at three sets or more
 * (`BULK_MIN_SETS`), so a cue would be unreachable on a two-set exercise, and
 * a cue you have to open a sheet to read is a cue you do not read. It is in
 * that sheet as WELL, because that sheet is "everything you can do to this
 * exercise" and omitting it there would be a hole.
 *
 * It is also not a `LogRow.note`. The note is one line about one set, written
 * to the set and gone with it; the cue is one line about the LIFT that comes
 * back forever. Both exist on this header's rows and neither is the other's
 * default — see the `cues` section of `model.ts`.
 */
export function GroupHeader({
  group,
  cue,
  onEditCue,
  onPickExercise,
  onUseNearMiss,
  onBulk,
}: {
  group: SetGroup;
  /**
   * This lift's carry-forward cue, or `null` — which covers both "nothing
   * written" and "no exercise to pin one to". See `cueFor` in `model.ts`.
   */
  cue: string | null;
  onEditCue: (exerciseId: string, exerciseName: string) => void;
  onPickExercise: (entryKey: string, query: string) => void;
  /** Re-file onto the near miss, learn the wording, remove the exercise just created. */
  onUseNearMiss: (entryKey: string, nearMiss: { id: string; name: string }) => void;
  onBulk: (entryKey: string) => void;
}) {
  const { match, query } = group;
  const name = group.exerciseName ?? "";
  const showBulk = group.rows.length >= BULK_MIN_SETS;

  /**
   * A cue needs something to be pinned TO, and an unresolved or by-hand group
   * has no exercise id yet. The affordance is therefore absent rather than
   * disabled: offering it on the one group the owner has to fix first would
   * compete with `PICK AN EXERCISE`, which is the only thing that unblocks the
   * confirm button.
   */
  const cuable = group.exerciseId !== null && group.exerciseName !== null
    ? { id: group.exerciseId, name: group.exerciseName }
    : null;

  return (
    <View style={styles.root}>
      {match === "none" ? (
        <View style={styles.nameRow}>
          {/*
            The by-hand row has no wording to quote — it was opened from a
            screen that did not know which exercise was under the thumb — and
            `UNMATCHED: “”` reads as a bug rather than as a prompt.
          */}
          <Text style={styles.nameBad} numberOfLines={2}>
            {query.trim() === "" ? "NO EXERCISE YET" : `UNMATCHED: “${query}”`}
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={() => {
            tapSelect();
            onPickExercise(group.entryKey, query);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${name}. Tap to change the exercise for these ${group.rows.length} sets.`}
          style={({ pressed }) => [styles.nameRow, pressed && styles.namePressed]}
        >
          <Text
            style={[
              styles.name,
              match === "fuzzy" && styles.nameFuzzy,
              match === "new" && styles.nameNew,
            ]}
            numberOfLines={1}
          >
            {match === "fuzzy" ? `~ ${name}` : match === "new" ? `+ ${name}` : name}
          </Text>

          {match === "new" && (
            <View style={styles.chip}>
              <Text style={styles.chipText}>NEW</Text>
            </View>
          )}

          <View style={styles.spacer} />

          {group.equipment !== null && <Text style={styles.equipment}>{group.equipment}</Text>}
        </Pressable>
      )}

      {match === "fuzzy" && <Text style={styles.evidence}>{`heard: “${query}”`}</Text>}
      {match === "new" && <Text style={styles.evidence}>{`created from “${query}”`}</Text>}

      {/*
        What the parser recognised and refused to believe. The owner's "165,5"
        typo is this case: the chunk is gone from the sets, and saying so here is
        the difference between a parser that corrected a typo and a parser that
        quietly lost a set.
      */}
      {group.dropped.length > 0 && (
        <Text style={styles.evidence}>
          {`ignored: ${group.dropped.map((d) => `“${d}”`).join(", ")}`}
        </Text>
      )}

      {/*
        THE ONE-TAP CORRECTION, and it asks two different questions.
        
        Both resolve the same way — re-file these sets onto the named exercise,
        learn the wording, and hand back the row the parse created — but what is
        being asked is not the same thing, and the wording has to say which.

        On a `new` group the near miss is a DIFFERENT lift: the server created
        "Bnch Pres" and something called Barbell Bench Press already exists. The
        question is genuinely "did you mean that instead?", and it is the reason
        any of this exists — "bnch pres" must not silently mint a second bench
        press, because nothing afterwards can merge the two halves of the
        history.

        On a `fuzzy` group the near miss IS the row the matcher chose, so
        "Did you mean Barbell Bench Press?" would be offering back the answer it
        had just given — a tautology with a no-op button under it. What is
        actually uncertain there is the MATCH, so that is what it asks about, and
        answering promotes a guess to a confirmed alias: the `~` goes away and
        the same wording resolves exactly next time instead of being re-guessed.

        Ignoring either one is free. Confirm is not blocked by a question.
      */}
      {group.nearMiss !== null && (
        <View style={styles.askRow}>
          <Text style={styles.askText}>
            {match === "fuzzy"
              ? "Matched on spelling. Right?"
              : `Did you mean ${group.nearMiss.name}?`}
          </Text>
          <Button
            variant="secondary"
            style={styles.askButton}
            onPress={() => {
              tapSelect();
              if (group.nearMiss !== null) onUseNearMiss(group.entryKey, group.nearMiss);
            }}
          >
            {match === "fuzzy" ? "YES" : "USE IT"}
          </Button>
        </View>
      )}

      {match === "none" && (
        <Button
          variant="secondary"
          style={styles.pick}
          onPress={() => {
            tapSelect();
            onPickExercise(group.entryKey, query);
          }}
        >
          PICK AN EXERCISE
        </Button>
      )}

      {/*
        The cue, last before the sets, which is where it is read between them.
        
        It comes AFTER the near-miss question and `PICK AN EXERCISE` on purpose:
        those two are a conversation about whether this is even the right lift,
        and a cue wedged into the middle of it is both premature and in the way.
        Once the lift is settled, the cue is the last thing the eye crosses on
        the way down to the figures.

        The whole block is the edit control — a 44pt-plus target, no separate
        pencil. A cue nobody can tap is a cue nobody can correct.
      */}
      {cue !== null && cuable !== null && (
        <Pressable
          onPress={() => {
            tapSelect();
            onEditCue(cuable.id, cuable.name);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Cue for ${cuable.name}: ${cue}. Tap to edit it.`}
          style={({ pressed }) => [styles.cue, pressed && styles.cuePressed]}
        >
          <Text style={styles.cueLabel}>CUE · TAP TO EDIT</Text>
          <Text style={styles.cueText}>{cue}</Text>
        </Pressable>
      )}

      <View style={styles.summaryRow}>
        <Text style={styles.summary}>{groupSummary(group)}</Text>
        <View style={styles.spacer} />

        {/*
          With no cue written, the affordance rides the summary row rather than
          taking a line of its own. Fifteen sets across five exercises is the
          normal paste for this owner, and five dedicated "ADD A CUE" rows
          would be five rows of chrome above the sets they are meant to be read
          beside. Once a cue exists it gets the block above instead, which is
          the right trade: it is worth space when it has something to say.
        */}
        {cue === null && cuable !== null && (
          <Pressable
            onPress={() => {
              tapSelect();
              onEditCue(cuable.id, cuable.name);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Pin a cue to ${cuable.name}. It shows every time you log this lift.`}
            hitSlop={{ top: 8, bottom: 8 }}
            style={({ pressed }) => [styles.addCue, pressed && styles.addCuePressed]}
          >
            {/*
              "CUE", not "NOTE". Every set line below already has a note dot
              and they are different things — one is about the set, one is
              about the lift. Two controls both called a note, a centimetre
              apart, doing different things, is worse than one unfamiliar word
              that the editor's own footnote defines.
            */}
            <Text style={styles.addCueText}>+ PIN A CUE</Text>
          </Pressable>
        )}

        {showBulk && (
          <Pressable
            onPress={() => {
              tapSelect();
              onBulk(group.entryKey);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Actions for all ${group.rows.length} sets of ${name === "" ? query : name}`}
            hitSlop={6}
            style={({ pressed }) => [styles.bulk, pressed && styles.bulkPressed]}
          >
            <Text style={styles.bulkText}>⋯</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
