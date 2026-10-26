import { useEffect, useState, useSyncExternalStore } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  Button, Card, Chart, Label, Screen, Sheet, Sparkline,
  color, hit, microLabel, space, tnum,
} from "@/components/ui";
import { QuickLog } from "@/features/voice";
import { clearLiftNotice, liftNotice } from "@/features/workout/notice";
import { tapSelect } from "@/lib/haptics";
import type { Bootstrap, GymDto } from "@/lib/types";

import { ExercisePicker } from "./ExercisePicker";
import {
  lastSessionBlock, mainLiftRows, nextUpBlock, recentWorkoutRows,
} from "./next";
import type { MainLiftRow } from "./next";

/** How long a notice handed back from the workout screen stays up. */
const HANDED_NOTICE_MS = 4000;

/** The strength sparkline's height, matching Today's. One point draws one dot. */
const SPARK_H = 32;

const styles = StyleSheet.create({
  /*
   * No `flex: 1` and no `justifyContent: "center"`.
   *
   * Those two were the whole of the complaint about this page: the content was
   * vertically centred inside a `ScrollView`, so on a 6.1" phone the button sat
   * mid-screen with a screenful of black under it and the page looked broken
   * rather than empty. `Screen` already supplies the top inset, the scroll and
   * the 96pt bottom gutter, so this adds nothing but the gap before the gutter.
   */
  body: { paddingBottom: space.lg },

  gym: { alignSelf: "center", marginTop: space.xl, paddingVertical: space.sm },
  gymText: { color: color.accent, fontSize: 14 },
  gymPressed: { opacity: 0.6 },
  noGyms: {
    color: color.muted, fontSize: 13, textAlign: "center",
    marginTop: space.lg, lineHeight: 19,
  },

  /*
   * Both logging doors stay above the fold. Lifters rank logging speed above
   * every other thing on this screen, so START and "already did a set?" are the
   * action block, and everything below them is content.
   */
  quickLog: { marginTop: space.xxl, marginBottom: space.xxl },
  quickLogLabel: { textAlign: "center" },

  pressed: { opacity: 0.7 },
  divided: { borderTopWidth: 1, borderTopColor: color.line },
  note: { color: color.muted, fontSize: 13, lineHeight: 19 },
  /** 12pt rather than 13: provenance and caveats sit under what they qualify. */
  fine: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: space.sm },
  quiet: { color: color.muted, fontSize: 13, lineHeight: 19, marginTop: space.sm },
  action: { marginTop: space.lg },

  owedRow: { paddingVertical: space.sm },
  owedLabel: { color: color.ink, fontSize: 15 },
  owedDetail: { ...tnum, color: color.muted, fontSize: 12, marginTop: 2 },

  sessionHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.md,
    marginBottom: space.xs,
  },
  sessionName: { color: color.ink, fontSize: 15, fontWeight: "500", flexShrink: 1 },
  sessionWhen: { ...microLabel, ...tnum },

  liftRow: { paddingVertical: space.sm },
  liftName: { color: color.ink, fontSize: 15 },
  liftDetail: { ...tnum, color: color.muted, fontSize: 13, marginTop: 2 },

  mainRow: { minHeight: hit.min, paddingVertical: space.sm },
  mainHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.md,
  },
  mainName: { color: color.ink, fontSize: 15, flexShrink: 1 },
  mainDelta: { ...tnum, fontSize: 14, fontWeight: "500" },
  /** The target the owner typed, on its own line so the name never truncates for it. */
  goalChip: { ...tnum, color: color.accentInk, fontSize: 12, textAlign: "right", marginTop: 2 },

  gymRow: {
    minHeight: hit.big,
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  gymRowText: { color: color.ink, fontSize: 16 },
  gymRowActive: { color: color.accentInk, fontWeight: "600" },
  sheetNote: { color: color.muted, fontSize: 13, lineHeight: 19, paddingTop: space.md },

  recentRow: { minHeight: hit.min, paddingVertical: space.sm },
});

/**
 * The Lift page with no session running.
 *
 * It used to be one button in the middle of an empty screen. The button was
 * right — starting a session is one press of a 72pt target placed where a thumb
 * lands, and the gym is a line of text rather than a `<select>` — but a page
 * whose only content is centred in a scroll view reads as broken, and the one
 * line of coaching it did carry ("Owed this week: Side Delts · Rear Delts ·
 * Lats") was three labels with no figure, no unit and no reason.
 *
 * Three cards replace it, in this order and no other:
 *
 *  1. NEXT UP — what to train, from the muscle-debt ranking. No day name, no
 *     split, no routine, no prescription. There is no program object in this
 *     app and this is not where one gets introduced.
 *  2. LAST SESSION — what was done last, with a one-tap repeat that PRE-LOADS
 *     and does not log.
 *  3. MAIN LIFTS — whether the lifts are moving, against the target the owner
 *     wrote down for them.
 *
 * Every string, cap and threshold in them lives in `next.ts` and is tested
 * there. This file lays them out and nothing else.
 */
export function StartScreen({
  bootstrap,
  gymId,
  onGymChange,
  onStart,
  onStartWith,
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
  /**
   * Start a session with these exercises already paged up and last session's
   * weights on the hero button. Nothing is logged — see the line under REPEAT.
   */
  onStartWith: (exerciseIds: string[]) => void | Promise<void>;
  refreshing: boolean;
  onRefresh: () => void;
  /** An inline line — "that session could not be saved" — never a dialog. */
  notice: string | null;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);

  /*
   * "Workout deleted.", handed back by the workout screen after it deleted the
   * workout and popped itself (see `features/workout/notice.ts`). Shown in the
   * subtitle slot `notice` already uses, ahead of it, and cleared after a few
   * seconds so it reads as news rather than as a standing state.
   */
  const handed = useSyncExternalStore(liftNotice.subscribe, liftNotice.get);
  useEffect(() => {
    if (handed === null) return;
    const timer = setTimeout(clearLiftNotice, HANDED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [handed]);

  const gyms: GymDto[] = bootstrap?.gyms ?? [];
  const gym = gyms.find((g) => g.id === gymId) ?? gyms.find((g) => g.isDefault) ?? gyms[0];

  const next = bootstrap !== undefined ? nextUpBlock(bootstrap) : null;
  const last = bootstrap !== undefined ? lastSessionBlock(bootstrap) : null;
  const mains = bootstrap !== undefined ? mainLiftRows(bootstrap) : [];
  const recent = bootstrap !== undefined ? recentWorkoutRows(bootstrap) : [];

  return (
    <Screen
      title="Lift"
      subtitle={handed ?? notice ?? undefined}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View style={styles.body}>
        {/* The action block. Bare views, not a Card: it is the action, not content. */}
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
          <Text style={styles.noGyms}>
            No gyms saved. The session will still log; add a gym on the web app so the coach knows
            what equipment you have.
          </Text>
        )}

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

        {/*
          The three content cards, all of which read `bootstrap`. On a cold
          launch with no cache there is nothing to draw them from for about a
          second; the action block above does not depend on it and is up
          immediately, which is the half that matters.
        */}
        {next !== null && (
          <>
            <Card>
              <Label>Next up</Label>

              {next.rows.map((row, i) => (
                <View key={row.muscle} style={[styles.owedRow, i > 0 && styles.divided]}>
                  <Text style={styles.owedLabel}>{row.label}</Text>
                  <Text style={styles.owedDetail}>{row.detail}</Text>
                </View>
              ))}

              {/* A statement when there is nothing to rank. Never a blank card. */}
              {next.note !== null && <Text style={styles.note}>{next.note}</Text>}

              {next.gap !== null && <Text style={styles.quiet}>{next.gap}</Text>}

              {/*
                The caveat, and there is no rung below it: this card never says
                the data is too thin to call. It says what it is working from and
                then answers anyway.
              */}
              {next.caveat !== null && <Text style={styles.quiet}>{next.caveat}</Text>}

              <Button
                variant="secondary"
                size="lg"
                style={styles.action}
                onPress={() => {
                  tapSelect();
                  setAdding(true);
                }}
              >
                PICK A LIFT
              </Button>
            </Card>

            <Card>
              <Label>Last session</Label>

              {last === null ? (
                <Text style={styles.note}>
                  No completed sessions yet. Once you finish one, its lifts and weights appear here
                  ready to repeat.
                </Text>
              ) : (
                <>
                  <View style={styles.sessionHead}>
                    <Text style={styles.sessionName} numberOfLines={1}>{last.name}</Text>
                    <Text style={styles.sessionWhen}>{last.when}</Text>
                  </View>

                  {last.rows.map((row, i) => (
                    <View key={row.exerciseId} style={[styles.liftRow, i > 0 && styles.divided]}>
                      <Text style={styles.liftName} numberOfLines={1}>{row.name}</Text>
                      <Text style={styles.liftDetail}>{row.detail}</Text>
                    </View>
                  ))}

                  <Button
                    variant="secondary"
                    size="lg"
                    style={styles.action}
                    onPress={() => {
                      tapSelect();
                      void onStartWith(last.exerciseIds);
                    }}
                  >
                    REPEAT THIS SESSION
                  </Button>
                  {/*
                    Pre-loads, does not log. Logging sets the owner has not done
                    would corrupt the only history this app has, and a one-tap
                    repeat that silently wrote four sets of bench would be the
                    worst bug on this screen.
                  */}
                  <Text style={styles.fine}>
                    Starts a session with these lifts and last session&apos;s weights loaded. Nothing
                    is logged until you tap LOG.
                  </Text>
                </>
              )}
            </Card>

            <Card>
              <Label>Main lifts</Label>
              {mains.length === 0 ? (
                <Text style={styles.note}>
                  Nothing yet. Log the same lift twice and its trend appears here.
                </Text>
              ) : (
                mains.map((row, i) => (
                  <MainLift
                    key={row.exerciseId}
                    row={row}
                    divided={i > 0}
                    onPress={() => {
                      tapSelect();
                      router.push({ pathname: "/exercise", params: { id: row.exerciseId } });
                    }}
                  />
                ))
              )}
            </Card>

            {/*
              Every past workout, one row each — never one row per date, which
              is how two sessions used to be drawn as one. A row opens that
              workout: every set, each one fixable, sets and lifts addable, and
              the delete the owner asked for "just in case there are errors" at
              the bottom of it. The delete used to be the only thing a row
              could do; it moved there with its confirmation unchanged.
            */}
            {recent.length > 0 && (
              <Card>
                <Label>Recent workouts</Label>
                {recent.map((row, i) => (
                  <Pressable
                    key={row.id}
                    onPress={() => {
                      tapSelect();
                      router.push({ pathname: "/workout", params: { id: row.id } });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.name}, ${row.when}, ${row.summary}`}
                    accessibilityHint="Opens this workout to view or edit its sets"
                    style={({ pressed }) => [
                      styles.recentRow, i > 0 && styles.divided, pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.sessionHead}>
                      <Text style={styles.sessionName} numberOfLines={1}>{row.name}</Text>
                      <Text style={styles.sessionWhen}>{row.when}</Text>
                    </View>
                    <Text style={styles.liftDetail} numberOfLines={1}>{row.summary}</Text>
                  </Pressable>
                ))}
              </Card>
            )}
          </>
        )}
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
        <Text style={styles.sheetNote}>
          The gym decides which equipment the coach assumes you have. It does not restrict what you
          can log.
        </Text>
      </Sheet>

      {/*
        The same picker the live session uses, which already pins the owed lifts
        under an "Owed this week" header. That pinned block IS the rest of the
        answer to "what do I train" — a list of lifts for the muscles the card
        above just named — so there is no second ordering to maintain here.
      */}
      <Modal
        visible={adding}
        animationType="slide"
        onRequestClose={() => setAdding(false)}
        statusBarTranslucent
      >
        <ExercisePicker
          onCancel={() => setAdding(false)}
          onPick={(exercise) => {
            setAdding(false);
            void onStartWith([exercise.id]);
          }}
        />
      </Modal>
    </Screen>
  );
}

/**
 * One main lift: the trend, and the target the owner wrote for it.
 *
 * The same treatment as Today's strength rows — name, delta or the ONE SESSION
 * micro-label, a 32pt sparkline whose one-point case degrades to a single dot,
 * the whole row tapping through to the set-by-set history. What it adds, and
 * the reason this card is not a copy of Today's, is the goal chip: the number
 * the lift has to reach and the month it has to reach it by, next to the line
 * that has to get there.
 *
 * The chip is on its own right-aligned line rather than beside the name. On a
 * 6.1" phone "Barbell Bench Press", "→ 205 by Dec" and "ONE SESSION" do not fit
 * on one row, and the thing that would have given way is the lift's name.
 */
function MainLift(
  { row, divided, onPress }: { row: MainLiftRow; divided: boolean; onPress: () => void },
) {
  const tone = row.tone === "good" ? color.good : row.tone === "warn" ? color.warn : color.muted;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.name} history`}
      onPress={onPress}
      style={({ pressed }) => [styles.mainRow, divided && styles.divided, pressed && styles.pressed]}
    >
      <View style={styles.mainHead}>
        <Text style={styles.mainName} numberOfLines={1}>{row.name}</Text>
        {row.deltaLabel !== null
          ? <Text style={[styles.mainDelta, { color: tone }]}>{row.deltaLabel}</Text>
          : <Label style={{ marginBottom: 0 }}>One session</Label>}
      </View>

      {row.goal !== null && <Text style={styles.goalChip}>{row.goal}</Text>}

      <Chart height={SPARK_H}>
        {(width, height) => <Sparkline values={row.values} width={width} height={height} />}
      </Chart>
    </Pressable>
  );
}
