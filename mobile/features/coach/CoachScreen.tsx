import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentRef } from "react";
import {
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  Button, Empty, Screen, Spinner, color, font, radius, space,
} from "@/components/ui";
import { apiGet } from "@/lib/api";
import { queryKeys } from "@/lib/query";
import { tapError, tapSelect } from "@/lib/haptics";
import type { CoachHistory } from "@/lib/types";

import { canSend, fromHistory } from "./stream";
import type { ChatMessage } from "./stream";
import { useStreamingAsk } from "./useStreamingAsk";

/**
 * The coach, as a chat transcript in a modal.
 *
 * A modal rather than a tab because asking the coach something is a task, not a
 * place: it happens once a day at most, and a permanent sixth of the tab bar
 * spent on it is a sixth taken from the screen opened mid-set.
 *
 * The coach's voice is set by the system prompt — blunt, one recommendation, no
 * praise. Nothing in this file softens that. There are deliberately no
 * suggestion chips: a chip reading "how am I doing?" is a prompt for a
 * compliment, and the whole point of this coach is that it does not give them.
 *
 * What this file USED to say was `"not enough data" when there isn't any`, and
 * that was the bug written down. The prompt no longer has a refusal in it: a
 * thin log changes what gets cited and whether a trend may be called, never
 * whether the question gets answered. See COACH_VOICE in
 * `src/lib/llm/prompts.ts`. The subtitle below carries the new promise, and it
 * has to stay true — if it says answers come only from logged data, an account
 * with nothing logged reads the screen as broken when the coach answers from
 * the goals text instead.
 */

/** Four lines before the composer starts scrolling instead of growing. */
const COMPOSER_LINE_HEIGHT = 22;
const COMPOSER_MAX_HEIGHT = COMPOSER_LINE_HEIGHT * 4 + space.lg * 2;

const styles = StyleSheet.create({
  transcript: { flex: 1 },
  transcriptBody: { paddingBottom: space.lg, gap: space.md },

  row: { flexDirection: "row" },
  rowUser: { justifyContent: "flex-end" },

  /*
   * A user bubble hugs its text and stops at 85% of the width; an assistant
   * answer takes the full column. That asymmetry is the whole visual grammar of
   * the transcript — a question is a short aside, an answer is the content —
   * and it means neither needs a name label above it.
   */
  user: {
    maxWidth: "85%",
    backgroundColor: color.accentSoft,
    borderWidth: 1,
    borderColor: color.accent,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  userText: { color: color.accentInk, fontSize: 15, lineHeight: 21 },

  assistant: {
    flex: 1,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.lg,
    padding: space.md,
  },
  assistantText: { color: color.ink, fontSize: 15, lineHeight: 22 },
  /** A block, not a caret: a caret at the end of a wrapped line reads as a stray character. */
  cursor: { color: color.accent },
  cutOff: { color: color.muted, fontSize: 12, marginTop: space.sm },

  error: { color: color.bad, fontSize: 13, lineHeight: 19, marginBottom: space.md },

  /**
   * `paddingBottom` is applied at the call site from `useSafeAreaInsets`, not
   * here — see the comment there. Everything else about the row is static.
   */
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.sm,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: COMPOSER_MAX_HEIGHT,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.lg,
    color: color.ink,
    // 16pt floor: anything smaller is uncomfortable to read back while typing,
    // and it is the same floor the sign-in fields use.
    fontSize: 16,
    lineHeight: COMPOSER_LINE_HEIGHT,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.md,
  },
  send: { paddingHorizontal: space.lg },

  centre: { paddingTop: space.xxl * 2, alignItems: "center" },
  footnote: { fontFamily: font.mono, color: color.muted, fontSize: 10, marginTop: space.sm },
});

export default function CoachScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = useQueryClient();
  // `ComponentRef` rather than `ScrollView`: in React Native 0.88 ScrollView is
  // a function component, so the class itself is not the instance type.
  const scroller = useRef<ComponentRef<typeof ScrollView> | null>(null);

  const [draft, setDraft] = useState("");
  const { messages, send, streaming, error } = useStreamingAsk("/api/coach/chat");

  const history = useQuery({
    queryKey: queryKeys.coach,
    queryFn: () => apiGet<CoachHistory>("/api/mobile/coach?limit=30"),
  });

  /*
   * The transcript is server history followed by this mounting's exchanges, and
   * the history query is deliberately not refetched while the modal is open:
   * `/api/coach/chat` persists both sides of the exchange itself, so a refetch
   * mid-conversation would return rows that are already on screen from the
   * stream and every message would appear twice. Invalidating on the way out is
   * what makes the next open show the full, persisted transcript.
   */
  useEffect(
    () => () => {
      void client.invalidateQueries({ queryKey: queryKeys.coach });
    },
    [client],
  );

  const rows: ChatMessage[] = [...fromHistory(history.data?.messages ?? []), ...messages];

  const onSend = useCallback(() => {
    if (!canSend(draft, streaming)) return;
    tapSelect();
    send(draft);
    setDraft("");
  }, [draft, streaming, send]);

  useEffect(() => {
    if (error !== null) tapError();
  }, [error]);

  const ready = canSend(draft, streaming);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      // `padding` is the only behaviour that works for a composer pinned to the
      // bottom of a flex column; `height` fights the modal's own presentation.
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen
        title="Coach"
        subtitle="Your own data, with the sample size stated. Thin weeks still get an answer."
        scroll={false}
        action={
          <Button variant="ghost" onPress={() => { tapSelect(); router.back(); }}>
            Close
          </Button>
        }
      >
        <ScrollView
          ref={scroller}
          style={styles.transcript}
          contentContainerStyle={styles.transcriptBody}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          // Follows the answer as it streams. Bound to content size rather than
          // to the message array because the array does not change while a
          // single message is growing.
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        >
          {history.isPending ? (
            <View style={styles.centre}>
              <Spinner size="large" />
            </View>
          ) : rows.length === 0 ? (
            <Empty>
              Ask about your plan, a lift, or tonight&apos;s macros. Questions about your goals
              and your split need nothing logged at all.
            </Empty>
          ) : (
            rows.map((m) => <Bubble key={m.id} message={m} />)
          )}
        </ScrollView>

        {error !== null && <Text style={styles.error}>{error}</Text>}

        {/*
          * The bottom inset is this screen's to apply, and it was missing.
          *
          * `Screen scroll={false}` deliberately adds no bottom inset (see
          * Screen.tsx) because the fixed variant is for screens that pin
          * something themselves and need the full height to position against.
          * A tab screen gets away with that: expo-router's tab bar carries
          * `paddingBottom: insets.bottom` itself, so content above it is
          * already clear of the home indicator. Coach is a root-stack MODAL —
          * there is no tab bar underneath it — so the TextInput and the 56pt
          * SEND button sat in the home-indicator strip.
          */}
        <View style={[styles.composer, { paddingBottom: insets.bottom }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask the coach"
            placeholderTextColor={color.muted}
            style={styles.input}
            multiline
            // Return inserts a newline rather than sending: these questions run
            // to a couple of sentences and losing one to a stray return would be
            // worse than reaching for the button.
            blurOnSubmit={false}
            editable={!streaming}
            accessibilityLabel="Your question"
          />
          <Button
            size="lg"
            onPress={onSend}
            disabled={!ready}
            style={styles.send}
          >
            SEND
          </Button>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <View style={[styles.row, styles.rowUser]}>
        <View style={styles.user}>
          <Text style={styles.userText}>{message.content}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={styles.assistant}>
        {/*
          `selectable` so a number or a recommendation can be copied out. Only
          on the answers — a question is already in the user's own head.
        */}
        <Text style={styles.assistantText} selectable>
          {message.content}
          {message.streaming === true && <Text style={styles.cursor}>{"▌"}</Text>}
        </Text>
        {message.failed === true && (
          // The routes append "(The coach is unreachable right now.)" to the
          // stream themselves when the model fails on their side. This line is
          // for the other case — the connection dying mid-answer, where that
          // text never made it across — so the two never both appear.
          <Text style={styles.cutOff}>The answer was cut off. Ask again to get the rest.</Text>
        )}
      </View>
    </View>
  );
}
