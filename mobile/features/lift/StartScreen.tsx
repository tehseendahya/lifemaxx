import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button, Label, Screen, Sheet, color, hit, space } from "@/components/ui";
import { QuickLog } from "@/features/voice";
import { tapSelect } from "@/lib/haptics";
import type { Bootstrap, GymDto } from "@/lib/types";
import { owedLine } from "./logic";

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: "center", paddingBottom: space.xxl * 2 },
  gym: { alignSelf: "center", marginTop: space.xl, paddingVertical: space.sm },
  gymText: { color: color.accent, fontSize: 14 },
  gymPressed: { opacity: 0.6 },
  owed: { color: color.muted, fontSize: 13, textAlign: "center", marginTop: space.lg, lineHeight: 19 },
  quickLog: { marginTop: space.xxl },
  quickLogLabel: { textAlign: "center" },
  gymRow: {
    minHeight: hit.big,
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  gymRowText: { color: color.ink, fontSize: 16 },
  gymRowActive: { color: color.accentInk, fontWeight: "600" },
  note: { color: color.muted, fontSize: 13, lineHeight: 19, paddingTop: space.md },
});

/**
 * One button.
 *
 * The web app's start screen is a card with a `<select>` for the gym and a
 * button under it, which costs a tap on the dropdown, a scroll, a tap on the
 * gym, and a tap on start — for a choice that is the same every single time.
 * Here the gym is already the default one, it is a line of text rather than a
 * control, and starting a session is one press of a 72pt target placed where a
 * thumb lands.
 *
 * Everything else about this screen is read-only context: which gym it will
 * file the session against, and which muscles are owed sets this week.
 */
export function StartScreen({
  bootstrap,
  gymId,
  onGymChange,
  onStart,
  refreshing,
  onRefresh,
  notice,
}: {
  bootstrap: Bootstrap | undefined;
  gymId: string | null;
  onGymChange: (gymId: string | null) => void;
  /**
   * Awaitable, because the free-text logger below also calls it and has to know
   * the start is queued before it queues any sets.
   */
  onStart: () => void | Promise<void>;
  refreshing: boolean;
  onRefresh: () => void;
  /** An inline line — "that session could not be saved" — never a dialog. */
  notice: string | null;
}) {
  const [picking, setPicking] = useState(false);

  const gyms: GymDto[] = bootstrap?.gyms ?? [];
  const gym = gyms.find((g) => g.id === gymId) ?? gyms.find((g) => g.isDefault) ?? gyms[0];
  const owed = owedLine(bootstrap?.volume.ranked ?? []);

  return (
    <Screen
      title="Lift"
      subtitle={notice ?? undefined}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View style={styles.body}>
        <Button
          size="hero"
          onPress={() => {
            tapSelect();
            void onStart();
          }}
        >
          START LIFT
        </Button>

        {gyms.length > 0 ? (
          <Pressable
            onPress={() => {
              tapSelect();
              setPicking(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Gym: ${gym?.name ?? "none"}. Tap to change.`}
            style={({ pressed }) => [styles.gym, pressed && styles.gymPressed]}
          >
            <Text style={styles.gymText}>{gym?.name ?? "Pick a gym"}</Text>
          </Pressable>
        ) : (
          <Text style={styles.owed}>
            No gyms saved. The session will still log; add a gym on the web app so the coach knows
            what equipment you have.
          </Text>
        )}

        {owed !== "" && <Text style={styles.owed}>Owed this week: {owed}</Text>}

        {/*
          Logging a set you have already done, without first pressing START.
          `onBeforeLog` is awaited, and that ordering is the whole point: the
          session start is queued ahead of the sets, and `POST /api/sets`
          resolves the workout server-side from whatever session is open — so a
          set delivered before its start would land in yesterday's session or
          fail outright.
        */}
        <View style={styles.quickLog}>
          <Label style={styles.quickLogLabel}>Already did a set?</Label>
          <QuickLog onBeforeLog={onStart} />
        </View>
      </View>

      {/*
        A sheet, not a dropdown. There is no `<select>`-equivalent anywhere in
        this app: a picker wheel is two taps and a dismissal for something that
        should be one tap on the thing you want.
      */}
      <Sheet visible={picking} onClose={() => setPicking(false)} title="Which gym?">
        {gyms.map((g) => (
          <Pressable
            key={g.id}
            onPress={() => {
              tapSelect();
              onGymChange(g.id);
              setPicking(false);
            }}
            accessibilityRole="button"
            style={styles.gymRow}
          >
            <Text style={[styles.gymRowText, g.id === gym?.id && styles.gymRowActive]}>
              {g.name}
            </Text>
          </Pressable>
        ))}
        <Text style={styles.note}>
          The gym decides which equipment the coach assumes you have. It does not restrict what you
          can log.
        </Text>
      </Sheet>
    </Screen>
  );
}
