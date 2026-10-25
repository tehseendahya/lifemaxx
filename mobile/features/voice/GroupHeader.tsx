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
 */
export function GroupHeader({
  group,
  onPickExercise,
  onUseNearMiss,
  onBulk,
}: {
  group: SetGroup;
  onPickExercise: (entryKey: string, query: string) => void;
  /** Re-file onto the near miss, learn the wording, remove the exercise just created. */
  onUseNearMiss: (entryKey: string, nearMiss: { id: string; name: string }) => void;
  onBulk: (entryKey: string) => void;
}) {
  const { match, query } = group;
  const name = group.exerciseName ?? "";
  const showBulk = group.rows.length >= BULK_MIN_SETS;

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

      <View style={styles.summaryRow}>
        <Text style={styles.summary}>{groupSummary(group)}</Text>
        <View style={styles.spacer} />
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
