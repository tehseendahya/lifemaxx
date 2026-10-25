import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentRef } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { Button, Label, color, hit, radius, space } from "@/components/ui";
import { microLabel } from "@/components/ui/Label";
import { apiGet } from "@/lib/api";
import { tapSelect } from "@/lib/haptics";
import { queryKeys } from "@/lib/query";
import type { Bootstrap, CatalogueExercise } from "@/lib/types";
import { filterCatalogue, partitionByOwed } from "./logic";

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
});

type Row =
  | { kind: "header"; key: string; label: string }
  | { kind: "exercise"; key: string; exercise: CatalogueExercise };

/**
 * Picking an exercise, offline, in two or three characters.
 *
 * The signature is fixed because the voice-logging flow builds against it in
 * parallel: when a transcript cannot be resolved to an exercise, it opens this
 * with the spoken phrase already in `query` so the user corrects rather than
 * retypes. That is also why this component takes no catalogue prop — it reads
 * `bootstrap` from the shared query cache, which both callers already have, and
 * which means neither caller has to thread 35 exercises through its props.
 *
 * Entirely offline: the catalogue came down in the one `bootstrap` call, so
 * this works in a basement. There is no server-side search and there must not
 * be one — a search box that needs signal is a search box that fails at
 * exercise four.
 */
export function ExercisePicker({
  query: initialQuery,
  onPick,
  onCancel,
}: {
  query?: string;
  onPick: (exercise: CatalogueExercise) => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState(initialQuery ?? "");
  // `ComponentRef`, not `TextInput`: React Native 0.88 separates the component
  // type from its instance type, and only the instance has `focus()`.
  const input = useRef<ComponentRef<typeof TextInput>>(null);

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

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.md }]}>
      <View style={styles.head}>
        <TextInput
          ref={input}
          style={styles.input}
          value={query}
          onChangeText={setQuery}
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
              : `Nothing matches “${query}”. Exercises come from the catalogue — add one on the web app if it is genuinely missing.`}
          </Text>
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
    </View>
  );
}
