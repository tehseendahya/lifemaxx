import { useEffect, useRef, useState } from "react";
import type { ComponentRef } from "react";
import { Modal, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, color, hit, radius, space } from "@/components/ui";
import { tapSelect } from "@/lib/haptics";

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.ground, paddingHorizontal: space.lg },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: color.ink, fontSize: 20, fontWeight: "600", letterSpacing: -0.2 },
  cancel: { paddingHorizontal: 0 },
  subtitle: { color: color.muted, fontSize: 13, lineHeight: 19, marginTop: space.xs },

  input: {
    marginTop: space.lg,
    minHeight: hit.huge,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.lg,
    backgroundColor: color.surface2,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.md,
    color: color.ink,
    fontSize: 17,
    lineHeight: 23,
  },
  save: { marginTop: space.md },
  clear: { marginTop: space.sm },
});

/**
 * A short piece of prose, typed and returned. Used for set notes.
 *
 * **Full-screen `Modal`, not a `Sheet`, and that is the whole point.** An RN
 * `Modal`'s contents do not move for the keyboard, so a panel anchored to the
 * bottom of the screen ends up underneath it — the note field would be behind
 * the keys the user is typing on. Everything interactive therefore sits in the
 * top half and the keyboard gets the bottom half to itself, with nothing to
 * avoid, animate or measure. `TextEntry` and `ExercisePicker` are this shape
 * for the same reason.
 *
 * The system keyboard is correct here: rule 5 of the design system bans it for
 * NUMBERS, and a set note is prose. It is one of the nine text fields the rule
 * explicitly allows.
 *
 * CLEAR is a separate button rather than "save an empty string", because an
 * empty field after a backspace-heavy edit is ambiguous: SAVE on empty text and
 * CLEAR do the same thing here, and having both means neither has to be
 * guessed at.
 */
export function TextPrompt({
  visible,
  title,
  subtitle,
  initialText,
  placeholder,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  title: string;
  /** What this note is attached to — "Set 2 · Bench Press", "All 4 sets". */
  subtitle?: string;
  initialText: string;
  placeholder?: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(initialText);
  // `ComponentRef`, not `TextInput`: React Native 0.88 separates the component
  // type from its instance type, and only the instance has `focus()`.
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  /**
   * Re-seeded on every open. The component stays mounted between opens while
   * the parent holds it in the tree, so without this the note for set 2 would
   * open showing set 1's text — and the user would save it onto the wrong set.
   */
  useEffect(() => {
    if (!visible) return;
    setText(initialText);
    // `autoFocus` alone is unreliable while a Modal animates in: the field
    // renders focused and the keyboard never arrives. Re-focusing next tick is
    // free when it worked.
    const t = setTimeout(() => input.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [visible, initialText]);

  if (!visible) return null;

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onCancel}>
      <View style={[styles.root, { paddingTop: insets.top + space.md }]}>
        <View style={styles.head}>
          <Text style={styles.title}>{title}</Text>
          <Button variant="ghost" onPress={onCancel} style={styles.cancel}>
            CANCEL
          </Button>
        </View>
        {subtitle !== undefined && <Text style={styles.subtitle}>{subtitle}</Text>}

        <TextInput
          ref={input}
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={placeholder ?? "Felt heavy, left shoulder tight…"}
          placeholderTextColor={color.muted}
          autoCapitalize="sentences"
          multiline
          blurOnSubmit={false}
          autoFocus
        />

        <Button
          size="lg"
          style={styles.save}
          onPress={() => {
            tapSelect();
            onSubmit(text.trim());
          }}
        >
          SAVE NOTE
        </Button>

        {initialText !== "" && (
          <Button
            variant="ghost"
            style={styles.clear}
            onPress={() => {
              tapSelect();
              onSubmit("");
            }}
          >
            CLEAR IT
          </Button>
        )}
      </View>
    </Modal>
  );
}
