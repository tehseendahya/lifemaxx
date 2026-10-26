import { useEffect, useRef, useState } from "react";
import type { ComponentRef } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Overlay, color, hit, radius, space } from "@/components/ui";
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
  inputBad: { borderColor: color.bad },

  footnote: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: space.sm },
  problem: { color: color.bad, fontSize: 13, lineHeight: 19, marginTop: space.sm },

  save: { marginTop: space.md },
  clear: { marginTop: space.sm },
});

/**
 * A short piece of prose, typed and returned. Used for set notes and for the
 * carry-forward exercise cue.
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
 *
 * ── TWO JOBS, ONE COMPONENT, AND WHY THE EXTRA PROPS EXIST ─────────────────
 *
 * A set note is written to local state and is never wrong; a cue is a round
 * trip to `POST /api/mobile/exercise/cue` that can be refused for length or
 * fail outright. So this grew `validate`, `busy` and `error` rather than the
 * cue growing a second near-identical screen. All three are optional and the
 * note path passes none of them, which is what keeps that path exactly as it
 * was.
 *
 * `error` has to render INSIDE this modal. It covers the confirmation sheet
 * completely, so a failure reported on the sheet behind it would not be seen
 * until the owner had already closed this and lost the draft.
 */
export function TextPrompt({
  visible,
  title,
  subtitle,
  footnote,
  initialText,
  placeholder,
  submitLabel,
  clearLabel,
  validate,
  busy = false,
  error,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  title: string;
  /** What this note is attached to — "Set 2 · Bench Press", "All 4 sets". */
  subtitle?: string;
  /** One quiet line under the field, for a rule the owner cannot infer. */
  footnote?: string;
  initialText: string;
  placeholder?: string;
  submitLabel?: string;
  clearLabel?: string;
  /**
   * Why the LIVE draft cannot be saved, or `null`. Runs on every keystroke and
   * disables the submit, so a cue that is too long is refused on the phone
   * instead of costing a round trip to be told.
   */
  validate?: (text: string) => string | null;
  /** True while the submit is in flight. Keeps the modal open and honest. */
  busy?: boolean;
  /** Why the last submit failed. The draft is deliberately still here. */
  error?: string | null;
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
   *
   * It keys off `initialText` as well as `visible`, which is also what lets a
   * failed cue save keep the draft: the parent holds this open and does not
   * change `initialText`, so nothing re-seeds and the typed words are still
   * there to retry or correct.
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

  const problem = validate === undefined ? null : validate(text);

  return (
    <Overlay visible onRequestClose={onCancel}>
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
          style={[styles.input, problem !== null && styles.inputBad]}
          value={text}
          onChangeText={setText}
          placeholder={placeholder ?? "Felt heavy, left shoulder tight…"}
          placeholderTextColor={color.muted}
          autoCapitalize="sentences"
          multiline
          blurOnSubmit={false}
          autoFocus
          editable={!busy}
        />

        {footnote !== undefined && <Text style={styles.footnote}>{footnote}</Text>}

        {/*
          The live length rule first, then whatever the last attempt came back
          with. They are different problems — one is "this cannot be sent", the
          other is "this was sent and refused" — and showing both at once is
          correct when the owner has edited a rejected draft into a too-long one.
        */}
        {problem !== null && <Text style={styles.problem}>{problem}</Text>}
        {error !== null && error !== undefined && <Text style={styles.problem}>{error}</Text>}

        <Button
          size="lg"
          style={styles.save}
          disabled={busy || problem !== null}
          onPress={() => {
            tapSelect();
            onSubmit(text.trim());
          }}
        >
          {busy ? "SAVING…" : (submitLabel ?? "SAVE NOTE")}
        </Button>

        {initialText !== "" && (
          <Button
            variant="ghost"
            style={styles.clear}
            disabled={busy}
            onPress={() => {
              tapSelect();
              onSubmit("");
            }}
          >
            {clearLabel ?? "CLEAR IT"}
          </Button>
        )}
      </View>
    </Overlay>
  );
}
