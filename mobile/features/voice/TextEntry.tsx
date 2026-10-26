import { useEffect, useRef, useState } from "react";
import type { ComponentRef } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Overlay, Label, color, hit, radius, space } from "@/components/ui";
import { microLabel } from "@/components/ui/Label";
import { tapSelect } from "@/lib/haptics";

const EXAMPLES = [
  "bench 5x5 185",
  "squat 225x5, 245x3, 245x3 @rpe8",
  "pullups bw+25 for 8, 8, 6",
  "did 3 sets weighted pull ups 45lbs for 6 reps",
];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.ground, paddingHorizontal: space.lg },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: color.ink, fontSize: 20, fontWeight: "600", letterSpacing: -0.2 },
  cancel: { paddingHorizontal: 0 },

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
  submit: { marginTop: space.md },
  error: { color: color.bad, fontSize: 13, lineHeight: 19, marginTop: space.md },

  examplesHead: { marginTop: space.xxl },
  example: { ...microLabel, marginBottom: space.sm },
  footnote: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: space.md },
});

/**
 * Typing a set, full screen.
 *
 * Two things about this are deliberate and would otherwise look like mistakes.
 *
 * **It is a full-screen `Modal`, not a `Sheet`.** This is the one surface in
 * the app where the system keyboard is wanted, and a bottom sheet is exactly
 * the wrong container for one: an RN `Modal`'s contents do not move for the
 * keyboard, so a panel anchored to the bottom ends up underneath it. Putting
 * everything interactive in the top half means the keyboard has the bottom half
 * to itself and nothing has to be avoided, animated or measured. This is also
 * the shape `ExercisePicker` already uses for the same reason.
 *
 * **The system keyboard is correct here.** The app's rule is that numbers are
 * typed on `NumberPad`, and that stands — every figure in the confirmation
 * sheet still is. But this field is a sentence, not a number, and the user
 * asked for free typing by name; a 12-key pad cannot spell "weighted pull ups".
 *
 * The examples under the field are not decoration. The four lines are the forms
 * the deterministic parser handles without a network round trip, so they are
 * also the fastest ones — showing them is how anyone finds that out.
 */
export function TextEntry({
  visible,
  initialText,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  /** Pre-filled when re-parsing a corrected sentence, empty on a fresh entry. */
  initialText: string;
  /** `PARSE` on the way in, `RE-PARSE` when correcting. */
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(initialText);
  // `ComponentRef`, not `TextInput`: React Native 0.88 separates the component
  // type from its instance type, and only the instance has `focus()`.
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  /**
   * Re-seeded every time it opens. The component stays mounted between opens
   * while the parent holds it in the tree, so without this the second visit
   * would still show the first visit's text — and after a correction it must
   * show the sentence being corrected.
   */
  useEffect(() => {
    if (!visible) return;
    setText(initialText);
    // `autoFocus` alone is unreliable while a Modal is animating in: the field
    // renders focused but the keyboard never arrives, leaving a screen the user
    // cannot type into. Focusing again next tick is free when it worked.
    const t = setTimeout(() => input.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [visible, initialText]);

  if (!visible) return null;

  const trimmed = text.trim();

  return (
    <Overlay visible onRequestClose={onCancel}>
      <View style={[styles.root, { paddingTop: insets.top + space.md }]}>
        <View style={styles.head}>
          <Text style={styles.title}>Type it</Text>
          <Button variant="ghost" onPress={onCancel} style={styles.cancel}>
            CANCEL
          </Button>
        </View>

        <TextInput
          ref={input}
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="bench 5x5 185"
          placeholderTextColor={color.muted}
          autoCapitalize="none"
          autoCorrect={false}
          // Multiline so several exercises can be typed on separate lines, which
          // is what the parser splits on. `returnKeyType="done"` would then be a
          // lie, so submitting is the button.
          multiline
          blurOnSubmit={false}
          autoFocus
        />

        <Button
          size="lg"
          style={styles.submit}
          disabled={trimmed === "" || busy}
          onPress={() => {
            tapSelect();
            onSubmit(trimmed);
          }}
        >
          {busy ? "PARSING…" : submitLabel}
        </Button>

        {error !== null && <Text style={styles.error}>{error}</Text>}

        <View style={styles.examplesHead}>
          <Label>Forms that never need signal</Label>
        </View>
        {EXAMPLES.slice(0, 3).map((line) => (
          <Text key={line} style={styles.example}>
            {line}
          </Text>
        ))}

        <Text style={styles.footnote}>
          Plain sentences work too — “{EXAMPLES[3]}” — they just go to the coach model to be read,
          so they need a connection. Nothing is logged until you confirm it.
        </Text>
      </View>
    </Overlay>
  );
}
