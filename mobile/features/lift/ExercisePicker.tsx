import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentRef } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Label, Sheet, Spinner, color, hit, radius, space } from "@/components/ui";
import { microLabel } from "@/components/ui/Label";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { tapError, tapSave, tapSelect } from "@/lib/haptics";
import { queryKeys } from "@/lib/query";
import type { Bootstrap, CatalogueExercise } from "@/lib/types";
import { filterCatalogue, normalise, partitionByOwed } from "./logic";

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.ground },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg },
  input: {
    flex: 1,
    height: hit.big,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.lg,
    backgroundColor: color.surface2,
    paddingHorizontal: space.md,
    color: color.ink,
    fontSize: 17,
  },
  cancel: { paddingHorizontal: 0 },
  listPad: { paddingHorizontal: space.lg, paddingTop: space.lg },
  sectionHead: { paddingTop: space.md },
  row: {
    minHeight: hit.big,
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  rowPressed: { backgroundColor: color.surface },
  rowName: { color: color.ink, fontSize: 16 },
  rowMeta: { ...microLabel, marginBottom: 0, marginTop: 2 },
  empty: { color: color.muted, fontSize: 14, paddingTop: space.xl, lineHeight: 20 },

  addBlock: { paddingTop: space.xl, gap: space.sm },
  addNote: { color: color.muted, fontSize: 13, lineHeight: 18 },
  addError: { color: color.bad, fontSize: 13, lineHeight: 18 },
  sheetBody: { color: color.ink, fontSize: 15, lineHeight: 21, marginBottom: space.lg },
  sheetNote: { color: color.muted, fontSize: 13, lineHeight: 18, marginBottom: space.lg },
  sheetActions: { gap: space.sm },
});

type Row =
  | { kind: "header"; key: string; label: string }
  | { kind: "exercise"; key: string; exercise: CatalogueExercise };

/**
 * `POST /api/mobile/exercise/create`.
 *
 * Declared here rather than in `lib/types.ts` because this is the only caller:
 * creating an exercise is a decision made in this screen, and the response is
 * shaped as a `CatalogueExercise` precisely so it can be handed to `onPick`
 * without a translation step.
 */
type CreateResponse =
  | { created: true; exercise: CatalogueExercise; musclesInferred: boolean }
  | { created: false; reason: "exists"; exercise: CatalogueExercise }
  | { created: false; reason: "near_miss"; suggestion: CatalogueExercise; score: number };

/** Below this, a search is still being typed and is not worth offering to add. */
const MIN_CREATE_LENGTH = 3;

/**
 * Picking an exercise, offline, in two or three characters — or adding one that
 * does not exist yet.
 *
 * The signature is fixed because the voice-logging flow builds against it: when
 * a transcript cannot be resolved to an exercise, it opens this with the spoken
 * phrase already in `query` so the user corrects rather than retypes. That is
 * also why this component takes no catalogue prop — it reads `bootstrap` from
 * the shared query cache, which both callers already have.
 *
 * ── WHY THERE IS A CREATE BUTTON HERE ──────────────────────────────────────
 *
 * This screen used to be where the owner got stuck. "preacher curls" did not
 * resolve, so the chip opened this picker with the phrase pre-filled, the
 * search found nothing in the catalogue, and the empty state said to add it on
 * the web app — where there is also no way to add one. The flow dead-ended in a
 * sentence that was not true.
 *
 * So an absent search now offers to add it, and the add is one tap. The server
 * decides whether the name is genuinely new or suspiciously close to something
 * that already exists; a close one comes back as a question with the candidate
 * named, because silently creating a second "Bench Press" out of "bnch pres"
 * splits a year of history and nothing afterwards can tell they were one lift.
 *
 * Searching stays entirely offline — the catalogue came down in the one
 * `bootstrap` call, so it works in a basement. Only the add needs signal, and
 * it says so when there is none: the new exercise's id has to exist before a
 * set can reference it, so there is nothing honest to queue.
 */
export function ExercisePicker({
  query: initialQuery,
  onPick,
  onCancel,
  allowCreate = true,
}: {
  query?: string;
  onPick: (exercise: CatalogueExercise) => void;
  onCancel: () => void;
  /**
   * Defaults to on. Both callers want it — the voice flow especially, since an
   * unresolved phrase is the single most likely reason this screen is open.
   */
  allowCreate?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState(initialQuery ?? "");
  // `ComponentRef`, not `TextInput`: React Native 0.88 separates the component
  // type from its instance type, and only the instance has `focus()`.
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const queryClient = useQueryClient();

  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  /** A near miss the server wants answered before it writes anything. */
  const [nearMiss, setNearMiss] = useState<{ typed: string; suggestion: CatalogueExercise } | null>(null);
  /** A created exercise whose muscles could not be inferred — worth one line. */
  const [unmapped, setUnmapped] = useState<CatalogueExercise | null>(null);

  /**
   * `autoFocus` alone is not reliable when this mounts inside a `Modal` that is
   * still animating in: the field renders focused but the keyboard never
   * arrives, and the user is left looking at a search screen they cannot type
   * into. Focusing again on the next tick costs nothing when `autoFocus` worked
   * and fixes it when it did not.
   */
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const { data } = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => apiGet<Bootstrap>("/api/mobile/bootstrap"),
  });

  const rows = useMemo<Row[]>(() => {
    const catalogue = data?.catalogue ?? [];
    const matches = filterCatalogue(catalogue, query);
    const { owed, rest } = partitionByOwed(matches, data?.volume.ranked ?? []);

    const out: Row[] = [];
    if (owed.length > 0) {
      out.push({ kind: "header", key: "h-owed", label: "Owed this week" });
      for (const e of owed) out.push({ kind: "exercise", key: `o-${e.id}`, exercise: e });
    }
    if (rest.length > 0) {
      if (owed.length > 0) out.push({ kind: "header", key: "h-all", label: "Everything else" });
      for (const e of rest) out.push({ kind: "exercise", key: `a-${e.id}`, exercise: e });
    }
    return out;
  }, [data, query]);

  const typed = query.trim();

  /**
   * Whether to offer the add.
   *
   * Not only when the list is empty: "cable curl" finds "Barbell Curl" by
   * substring and the owner still means a different lift, so the offer sits
   * under the results as well. It is withheld when the catalogue already holds
   * that exact name — offering to add "Back Squat" while Back Squat is the
   * first row is how a duplicate gets created on purpose.
   */
  const exactInCatalogue = useMemo(() => {
    const n = normalise(typed);
    return n !== "" && (data?.catalogue ?? []).some((e) => normalise(e.name) === n);
  }, [data, typed]);

  const canAdd = allowCreate && typed.length >= MIN_CREATE_LENGTH && !exactInCatalogue;

  function finish(exercise: CatalogueExercise) {
    // The catalogue in the cache is one exercise out of date the moment this
    // returns, and the live session reads names out of it — an exercise missing
    // from it draws as "Exercise". Not awaited: the pick must land on this
    // frame, and the refetch catches up behind it.
    void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });
    tapSave();
    onPick(exercise);
  }

  async function add(force: boolean) {
    if (adding) return;
    setAdding(true);
    setAddError("");
    try {
      const res = await apiPost<CreateResponse>("/api/mobile/exercise/create", {
        name: typed,
        ...(force ? { force: true } : {}),
      });

      if (res.created === false && res.reason === "near_miss") {
        tapSelect();
        setNearMiss({ typed, suggestion: res.suggestion });
        return;
      }

      // `exists` lands here too: the name resolved after all, so the right
      // answer is to pick that row rather than to report anything.
      if (res.created && !res.musclesInferred) {
        setUnmapped(res.exercise);
        void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });
        tapSelect();
        return;
      }
      finish(res.exercise);
    } catch (err) {
      tapError();
      setAddError(
        err instanceof ApiError && err.status === 0
          ? "Adding an exercise needs a connection — a new lift has to exist on the server before a set can point at it."
          : err instanceof Error
            ? err.message
            : "Could not add it.",
      );
    } finally {
      setAdding(false);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.md }]}>
      <View style={styles.head}>
        <TextInput
          ref={input}
          style={styles.input}
          value={query}
          onChangeText={(next) => {
            setQuery(next);
            // A stale error under a search that has since changed reads as a
            // broken screen rather than as a failed add.
            if (addError !== "") setAddError("");
          }}
          placeholder="Search exercises"
          placeholderTextColor={color.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          autoFocus
          clearButtonMode="while-editing"
        />
        <Button variant="ghost" onPress={onCancel} style={styles.cancel}>
          CANCEL
        </Button>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={[styles.listPad, { paddingBottom: insets.bottom + space.xxl }]}
        keyboardShouldPersistTaps="handled"
        // The keyboard stays up while the list scrolls. Dismissing it on drag
        // would mean a second tap to refine a search after one scroll.
        keyboardDismissMode="none"
        ListEmptyComponent={
          <Text style={styles.empty}>
            {data === undefined
              ? "The exercise catalogue has not been loaded yet. Open Today once with a connection and it will be here from then on."
              : typed === ""
                ? "No exercises yet."
                : `Nothing in the catalogue matches “${typed}”.`}
          </Text>
        }
        ListFooterComponent={
          canAdd ? (
            <View style={styles.addBlock}>
              <Label>Not in the catalogue?</Label>
              <Button
                variant="secondary"
                size="lg"
                onPress={() => {
                  tapSelect();
                  void add(false);
                }}
                disabled={adding}
              >
                {adding ? "ADDING…" : `ADD “${typed}”`}
              </Button>
              {adding && <Spinner />}
              {addError !== "" ? (
                <Text style={styles.addError}>{addError}</Text>
              ) : (
                <Text style={styles.addNote}>
                  It becomes yours alone, and the wording you just typed is remembered — the
                  next time you write it, it logs with no questions asked.
                </Text>
              )}
            </View>
          ) : undefined
        }
        renderItem={({ item }) =>
          item.kind === "header" ? (
            <View style={styles.sectionHead}>
              <Label>{item.label}</Label>
            </View>
          ) : (
            <Pressable
              onPress={() => {
                tapSelect();
                onPick(item.exercise);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <Text style={styles.rowName}>{item.exercise.name}</Text>
              {item.exercise.equipment !== "" && (
                <Text style={styles.rowMeta}>{item.exercise.equipment}</Text>
              )}
            </Pressable>
          )
        }
      />

      {/*
        The near-miss question. It names the candidate rather than asking an
        abstract "are you sure?", because the only person who can tell a typo
        from a different machine is the one who was standing at it.
      */}
      <Sheet
        visible={nearMiss !== null}
        onClose={() => setNearMiss(null)}
        title="Did you mean this one?"
      >
        {nearMiss !== null && (
          <>
            <Text style={styles.sheetBody}>
              “{nearMiss.typed}” is close to {nearMiss.suggestion.name}, which you already have.
            </Text>
            <Text style={styles.sheetNote}>
              Two rows for one lift splits its history in half, and nothing afterwards can tell
              they were the same thing.
            </Text>
            <View style={styles.sheetActions}>
              <Button
                size="lg"
                onPress={() => {
                  const { suggestion, typed: phrase } = nearMiss;
                  setNearMiss(null);
                  /*
                   * Teach the resolver the phrase on the way out. This is the
                   * one place in the picker where that is unambiguously right:
                   * the user has just confirmed that this specific wording means
                   * this specific row, so the next transcript resolves it
                   * exactly, with no query and no question. Fire and forget — a
                   * failed lesson is a lesson not learned, not a failed pick.
                   */
                  void apiPost("/api/mobile/exercise/alias", {
                    exerciseId: suggestion.id,
                    alias: phrase,
                  }).catch(() => {});
                  finish(suggestion);
                }}
              >
                {`USE ${nearMiss.suggestion.name.toUpperCase()}`}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onPress={() => {
                  setNearMiss(null);
                  void add(true);
                }}
              >
                {`NO — ADD “${nearMiss.typed}”`}
              </Button>
            </View>
          </>
        )}
      </Sheet>

      {/*
        One line, once, for a created exercise nothing could map to a muscle.

        It costs a tap, and it is worth it: the alternative is the owner doing
        four sets of a new machine and watching the muscle they just trained
        stay at the top of "owed this week" with no explanation anywhere.
      */}
      <Sheet
        visible={unmapped !== null}
        onClose={() => {
          const exercise = unmapped;
          setUnmapped(null);
          if (exercise) finish(exercise);
        }}
        title={unmapped === null ? undefined : `${unmapped.name} added`}
      >
        {unmapped !== null && (
          <>
            <Text style={styles.sheetBody}>
              Its name did not say which muscles it works, so nothing was guessed.
            </Text>
            <Text style={styles.sheetNote}>
              Sets on it count in your history, your trends and your estimated maxes. They will
              not count toward weekly volume or move anything in “owed this week” until the
              muscles are set.
            </Text>
            <Button
              size="lg"
              onPress={() => {
                const exercise = unmapped;
                setUnmapped(null);
                if (exercise) finish(exercise);
              }}
            >
              GOT IT
            </Button>
          </>
        )}
      </Sheet>
    </View>
  );
}
