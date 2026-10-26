import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import {
  Button, Card, Columns, Empty, Label, Screen, Spinner, Stat, Toggle,
  color, font, hit, radius, space, tnum,
} from "@/components/ui";
import { ProgressDots } from "@/components/ui/ProgressDots";
import { apiPost } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { queryKeys } from "@/lib/query";
import { tapError, tapSave, tapSelect } from "@/lib/haptics";
import { useBootstrap } from "@/features/today/useBootstrap";
/*
 * Reaching into `features/today`, deliberately and read-only. `goalsBlock` and
 * `goalMeter` are the one implementation of "what does this prose say and how
 * far is it", and Today's Goals card is a three-row preview of the same rows;
 * `CalibrationRows` and `calibrationView` are the one rendering of "how far
 * from a maintenance number"; `WeighInPad` is the one bodyweight pad. Two
 * copies of any of these would come to disagree.
 */
import { CalibrationRows } from "@/features/today/CalibrationRows";
import { goalMeter } from "@/features/today/goal-meter";
import { GoalRow } from "@/features/today/GoalRow";
import { goalsBlock } from "@/features/today/model";
import { NavLine } from "@/features/today/NavLine";
import { calibrationView } from "@/features/today/unlock";
import { WeighInPad } from "@/features/today/WeighInPad";
import type { Bootstrap } from "@/lib/types";

import { useReachability } from "./ConnectionCard";
import { stravaNotice } from "./connections";
import { ConnectionsCard } from "./ConnectionsCard";
import { buildMaintenance, buildWeighIn, targetSaveLabel, weighInStrip } from "./model";
import type { ProposalKey } from "./model";
import { SettingsRows } from "./SettingsRows";

/**
 * You — body, maintenance, goals, then settings.
 *
 * Ordered by what is read rather than by what is configured. The owner's
 * complaint about this screen before the eight days of data was the same as
 * Today's: it looked disorganised, because three of its six cards were either
 * empty or settings. Now the top is the body (a figure, a button, and a
 * fourteen-day strip that fills every morning), then calibration progress or
 * the measured maintenance with target chips that actually save, then goals
 * as meters. Server, account and about are one grouped list at the bottom.
 *
 * On a laptop the cards sit in two columns: the body and maintenance on the
 * left, goals and the settings on the right — the phone's order, split where
 * the reading turns into configuring.
 *
 * `bootstrap` is read once at the top and drilled into the cards as a prop.
 * Calling `useBootstrap()` in each card would work — react-query dedupes by key
 * — but it would also register one focus-refetch effect and one outbox
 * subscription per card, for one payload.
 */

const styles = StyleSheet.create({
  weightRow: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  weight: { ...tnum, color: color.ink, fontSize: 44, fontWeight: "600", letterSpacing: -1 },
  weightUnit: { color: color.muted, fontSize: 18 },
  weightHint: { ...tnum, color: color.muted, fontSize: 12, marginTop: space.xs },
  strip: { marginTop: space.lg },
  stripHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: space.sm,
  },

  muted: { color: color.muted, fontSize: 13, lineHeight: 19 },
  error: { color: color.bad, fontSize: 13, lineHeight: 19, marginTop: space.md },

  divider: { marginTop: space.lg, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: color.line },
  trend: { ...tnum, color: color.muted, fontSize: 13, marginTop: space.xs },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
  chipDetail: { ...tnum, color: color.ink, fontSize: 13, marginTop: space.md, lineHeight: 19 },
  note: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: space.md },

  goals: {
    backgroundColor: color.surface2,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    color: color.ink,
    fontSize: 16,
    lineHeight: 22,
    padding: space.md,
    minHeight: 112,
  },
  goalsFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    marginTop: space.sm,
  },
  goalsExplainer: { color: color.muted, fontSize: 12, lineHeight: 18, flex: 1 },
  saved: { fontFamily: font.mono, color: color.good, fontSize: 10, letterSpacing: 1.4 },

  goalsSection: { marginTop: space.lg },
  aimLine: { color: color.ink, fontSize: 14, lineHeight: 21, paddingVertical: 3 },
  contextToggle: {
    minHeight: hit.min,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  contextToggleText: { ...tnum, color: color.ink, fontSize: 14 },
  chevron: { color: color.muted, fontSize: 16 },
  contextLine: { color: color.muted, fontSize: 13, lineHeight: 19, paddingVertical: 2 },
  pressed: { opacity: 0.7 },

  centre: { paddingTop: space.xxl * 2, alignItems: "center" },
  notice: { fontSize: 13, lineHeight: 19, marginBottom: space.md },
});

export default function SettingsScreen() {
  const { data, loading, error, refreshing, onRefresh, retry } = useBootstrap();
  const { session } = useSession();
  const client = useQueryClient();
  const probe = useReachability();

  // One probe on mount. Deliberately not re-run on focus: it is a network
  // request made to render a single word, and there is a Re-check button for
  // when the answer actually matters.
  const { check } = probe;
  useEffect(() => { check(); }, [check]);

  const onBaseChanged = useCallback(() => {
    // The cached payload belongs to a server this phone is no longer talking
    // to. Removed rather than invalidated, so a refetch against the new base
    // URL starts from nothing instead of showing the old server's numbers.
    client.removeQueries({ queryKey: queryKeys.bootstrap });
    client.removeQueries({ queryKey: queryKeys.coach });
  }, [client]);

  /*
   * The Strava OAuth round trip lands back here as `/you?strava=connected` (or
   * `=error`). Shown once, above everything; the flag in `bootstrap` is what
   * actually flips the row, on the refetch this screen does on focus.
   */
  const { strava } = useLocalSearchParams<{ strava?: string | string[] }>();
  const landed = stravaNotice(strava);
  const notice = landed === null ? null : (
    <Text style={[styles.notice, { color: landed.tone === "bad" ? color.bad : color.good }]}>
      {landed.text}
    </Text>
  );

  const settings = (
    <SettingsRows probe={probe} onBaseChanged={onBaseChanged} email={session?.email ?? ""} />
  );

  if (!data) {
    return (
      <Screen title="You">
        {notice}
        {loading ? (
          <View style={styles.centre}><Spinner size="large" /></View>
        ) : (
          <>
            <Empty>{error ?? "Could not load your profile."}</Empty>
            <Button variant="secondary" size="lg" onPress={() => { tapSelect(); retry(); }}>
              Try again
            </Button>
            {/* Reachable with no data on purpose: a wrong API URL is the most
                likely reason there is none, and this is where it is fixed. */}
            <View style={{ marginTop: space.lg }}>{settings}</View>
          </>
        )}
      </Screen>
    );
  }

  return (
    <Screen title="You" refreshing={refreshing} onRefresh={onRefresh}>
      {notice}
      <Columns
        left={
          <>
            <BodyCard data={data} />
            <MaintenanceCard data={data} />
          </>
        }
        right={
          <>
            <GoalsCard data={data} />
            <ConnectionsCard stravaConnected={data.stravaConnected} />
            {settings}
          </>
        }
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------- body

function BodyCard({ data }: { data: Bootstrap }) {
  const [pad, setPad] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The weight typed on this phone, held until the next `bootstrap` lands, so
   * the big figure visibly changes on save. Dropped once the payload carries
   * today's reading, so it cannot mask a later correction.
   */
  const [justLogged, setJustLogged] = useState<number | null>(null);

  const todayLogged = data.history.days.some((d) => d.date === data.today && d.weightLb !== null);
  const view = buildWeighIn(data, todayLogged ? null : justLogged);
  const strip = weighInStrip(data);
  const weighedDays = strip.filter((d) => d.on).length;

  return (
    <Card>
      <Label>Body</Label>
      <View style={styles.weightRow}>
        <Text style={styles.weight}>{view.figure}</Text>
        {view.figure !== "—" && <Text style={styles.weightUnit}>lb</Text>}
      </View>
      <Text style={styles.weightHint}>{view.hint}</Text>

      <Button
        size="lg"
        onPress={() => { tapSelect(); setError(null); setPad(true); }}
        style={{ marginTop: space.lg }}
      >
        LOG WEIGHT
      </Button>
      {error !== null && <Text style={styles.error}>{error}</Text>}

      {/*
        The calibration habit, visible: fourteen dots, one per morning, today
        outlined until it is filled. It is the one thing on this screen that
        moves every day of the first fortnight.
      */}
      <View style={styles.strip}>
        <View style={styles.stripHead}>
          <Label style={{ marginBottom: 0 }}>Weigh-ins · 14 days</Label>
          <Text style={styles.weightHint}>{weighedDays} of {strip.length}</Text>
        </View>
        <ProgressDots
          states={strip.map((d) => (d.on ? "on" : d.today ? "current" : "off"))}
        />
      </View>

      <WeighInPad
        visible={pad}
        onClose={() => setPad(false)}
        onCommitted={(lb) => { setError(null); setJustLogged(lb); }}
        onFailed={(message) => { setJustLogged(null); setError(message); }}
      />
    </Card>
  );
}

// --------------------------------------------------------------- maintenance

function MaintenanceCard({ data }: { data: Bootstrap }) {
  const client = useQueryClient();
  const [picked, setPicked] = useState<ProposalKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cal = calibrationView(data);
  const m = buildMaintenance(data);

  if (cal !== null) {
    return (
      <Card>
        <Label>Calibrating maintenance</Label>
        {/*
          No number at all below the floor — not a greyed-out one, not an
          estimate from height and weight. The counts are the content, and they
          are the same two tracks as the Unlocking card on Today.
        */}
        <CalibrationRows view={cal} />
      </Card>
    );
  }
  // `calibrationView` is null exactly when TDEE is ok; this narrows the type.
  if (m.status !== "ok") return null;

  const proposal = m.proposal;
  const chosen = proposal.chips.find((c) => c.key === (picked ?? proposal.current)) ?? null;
  const saveLabel = targetSaveLabel(proposal, picked);

  async function save() {
    if (picked === null) return;
    setSaving(true);
    setError(null);
    try {
      // The mode only. The server recomputes the kcal from its own TDEE.
      await apiPost("/api/mobile/target", { mode: picked });
      tapSave();
      setPicked(null);
      // Food's fuel card flips out of "calibrating" from this refetch.
      await client.invalidateQueries({ queryKey: queryKeys.bootstrap });
    } catch (err) {
      tapError();
      setError(err instanceof Error ? err.message : "Could not save that target.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <Label>Maintenance</Label>
      <Stat label="Measured TDEE" value={`${m.tdee} kcal`} hint={m.hint} />
      <Text style={styles.trend}>{m.trend}</Text>

      <View style={styles.divider}>
        <Label>Calorie target</Label>
        <View style={styles.chips}>
          {proposal.chips.map((chip) => (
            <Toggle
              key={chip.key}
              on={(picked ?? proposal.current) === chip.key}
              onPress={() => {
                tapSelect();
                setError(null);
                setPicked(picked === chip.key ? null : chip.key);
              }}
            >
              {chip.label}
            </Toggle>
          ))}
        </View>

        {chosen !== null && (
          <Text style={styles.chipDetail}>
            {chosen.detail}
            {"\n"}
            {proposal.proteinG} g protein a day
          </Text>
        )}

        {saveLabel !== null && (
          <Button
            size="lg"
            onPress={() => { void save(); }}
            disabled={saving}
            style={{ marginTop: space.md }}
          >
            {saving ? "SAVING…" : saveLabel}
          </Button>
        )}
        {error !== null && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.note}>{proposal.note}</Text>
      </View>
    </Card>
  );
}

// -------------------------------------------------------------------- goals

/**
 * Three kinds of content from one text box, plus the box.
 *
 * Targets as meters (`GoalRow`, shared with Today, with the owner's sentence
 * under each), soft aims as plain lines, and the standing context the coach
 * reads collapsed behind one row. The free text is still the single source of
 * truth, `POST /api/profile { goalsText }` is still the only write, and the
 * coach still reads the whole string on every answer.
 */
function GoalsCard({ data }: { data: Bootstrap }) {
  const client = useQueryClient();

  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);

  /**
   * Whether the editor is open. Seeded once from whether there was anything to
   * read when this card mounted, and never resynced: a refetch landing
   * mid-sentence must not close the box the owner is typing in.
   */
  const [autoFocus] = useState(() => data.goalsText.trim() === "");
  const [editing, setEditing] = useState(autoFocus);

  /** What the server last told us, so a blur with no edit does not POST. */
  const committed = useRef<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => { if (savedTimer.current !== null) clearTimeout(savedTimer.current); },
    [],
  );

  /*
   * Seeded once, not resynced on every refetch: a refetch lands every 30
   * seconds while this tab is focused, and rewriting the field from it would
   * wipe a half-typed sentence. `POST /api/profile` versions goals into
   * `goal_history`, so a laptop edit lost to the phone's next blur is
   * recoverable.
   */
  useEffect(() => {
    if (text === null) {
      setText(data.goalsText);
      committed.current = data.goalsText;
    }
  }, [data.goalsText, text]);

  function flash() {
    setSaved(true);
    if (savedTimer.current !== null) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2_000);
  }

  async function commit() {
    if (text === null) return;
    const next = text.trim();
    if (next === committed.current) return;

    setSaving(true);
    setError(null);
    try {
      await apiPost("/api/profile", { goalsText: next });
      committed.current = next;
      tapSave();
      flash();
      // This string goes into the system prompt of every model call, and
      // `bootstrap` holds the copy the Coach modal reads.
      await client.invalidateQueries({ queryKey: queryKeys.bootstrap });
    } catch (err) {
      tapError();
      setError(err instanceof Error ? err.message : "Could not save your goals.");
    } finally {
      setSaving(false);
    }
  }

  const block = goalsBlock(data);
  const rows = block.targets.map((row) => goalMeter(row, data));

  return (
    <Card>
      <Label>Goals</Label>

      {block.empty !== null && <Text style={styles.muted}>{block.empty}</Text>}

      {rows.map((row, i) => <GoalRow key={row.key} row={row} divided={i > 0} showSentence />)}

      {block.note !== null && (
        <Text style={[styles.muted, { marginTop: space.md }]}>{block.note}</Text>
      )}

      {block.aims.length > 0 && (
        <View style={styles.goalsSection}>
          <Label>Also working on</Label>
          {/*
            No bar, no figure, no tone. "Getting arms to be bigger" has no
            honest progress pattern — this app does not measure arms — and a
            bar beside it would be a fabricated measurement.
          */}
          {block.aims.map((line, i) => <Text key={i} style={styles.aimLine}>{line}</Text>)}
        </View>
      )}

      {block.context.length > 0 && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: contextOpen }}
            onPress={() => { tapSelect(); setContextOpen(!contextOpen); }}
            style={({ pressed }) => [styles.contextToggle, pressed && styles.pressed]}
          >
            <Text style={styles.contextToggleText}>Coach context ({block.context.length})</Text>
            <Text style={styles.chevron}>{contextOpen ? "⌄" : "›"}</Text>
          </Pressable>
          {/*
            The owner's split and schedule, visibly read and visibly NOT turned
            into a schema. There is no split or program object in this app —
            "what should I train" is answered from the muscle-debt ranking.
          */}
          {contextOpen && block.context.map((line, i) => (
            <Text key={i} style={styles.contextLine}>{line}</Text>
          ))}
        </>
      )}

      {!editing ? (
        <NavLine onPress={() => setEditing(true)}>Edit goals →</NavLine>
      ) : (
        <View style={styles.goalsSection}>
          {/*
            Free text, never a picker. A goal dropdown would reduce "half
            marathon in the fall, plus shoulders and back" to one bit, and this
            is the string the model reads before it answers anything.
          */}
          <TextInput
            value={text ?? ""}
            onChangeText={setText}
            onBlur={() => { void commit(); }}
            placeholder="205 bench press by December. Work on arm size. Current split: push, pull, legs."
            placeholderTextColor={color.muted}
            style={styles.goals}
            multiline
            autoFocus={autoFocus}
            editable={text !== null && !saving}
            accessibilityLabel="Your goals, in your own words"
          />
          <View style={styles.goalsFoot}>
            <Text style={styles.goalsExplainer}>
              Written in your own words. The coach reads this on every answer.
            </Text>
            {saving ? <Spinner /> : saved ? <Text style={styles.saved}>SAVED</Text> : null}
          </View>
          {error !== null && <Text style={styles.error}>{error}</Text>}
          {block.empty === null && (
            <NavLine onPress={() => { void commit(); setEditing(false); }}>
              Done editing →
            </NavLine>
          )}
        </View>
      )}
    </Card>
  );
}
