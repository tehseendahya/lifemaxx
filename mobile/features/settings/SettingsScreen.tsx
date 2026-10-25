import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Constants from "expo-constants";
import { useQueryClient } from "@tanstack/react-query";

import {
  Button, Card, Empty, Label, NumberPad, Screen, Sheet, Spinner, Stat, Toggle,
  color, font, radius, space, tnum,
} from "@/components/ui";
import { apiPost } from "@/lib/api";
import { signOut, useSession } from "@/lib/auth";
import { queryKeys } from "@/lib/query";
import { tapDone, tapError, tapSave, tapSelect } from "@/lib/haptics";
import { useBootstrap } from "@/features/today/useBootstrap";
import type { Bootstrap } from "@/lib/types";

import { ConnectionCard, useReachability } from "./ConnectionCard";
import { buildMaintenance, buildWeighIn, weightFromPad } from "./model";
import type { ProposalKey } from "./model";

/**
 * You — weigh-in, maintenance, goals, connection, account.
 *
 * The order is the whole design. Weighing in is a daily ritual and the web app
 * buried it in a settings page; here it is the first thing on the screen and
 * costs one tap plus three keys. Everything below it is touched monthly at
 * most, so the screen is ordered by how often something is needed rather than
 * by how important it sounds.
 *
 * `bootstrap` is read once at the top and drilled into the cards as a prop.
 * Calling `useBootstrap()` in each card would work — react-query dedupes by key
 * — but it would also register five focus-refetch effects and five outbox
 * subscriptions for one payload, which is five times the work to render one
 * screen.
 */

const styles = StyleSheet.create({
  weightRow: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  weight: { ...tnum, color: color.ink, fontSize: 44, fontWeight: "600", letterSpacing: -1 },
  weightUnit: { color: color.muted, fontSize: 18 },
  weightHint: { color: color.muted, fontSize: 12, marginTop: space.xs },

  muted: { color: color.muted, fontSize: 13, lineHeight: 19 },
  error: { color: color.bad, fontSize: 13, lineHeight: 19, marginTop: space.md },

  divider: { marginTop: space.lg, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: color.line },
  trend: { ...tnum, color: color.muted, fontSize: 13, marginTop: space.xs },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md },
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

  email: { fontFamily: font.mono, color: color.ink, fontSize: 13, marginBottom: space.md },
  about: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: space.sm },
  version: { ...tnum, fontFamily: font.mono, color: color.muted, fontSize: 11 },

  centre: { paddingTop: space.xxl * 2, alignItems: "center" },
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
    // to. Removed rather than invalidated: a refetch against the new base URL
    // should start from nothing, not sit showing the old server's numbers
    // while it runs.
    client.removeQueries({ queryKey: queryKeys.bootstrap });
    client.removeQueries({ queryKey: queryKeys.coach });
  }, [client]);

  const connection = (
    <ConnectionCard
      reachability={probe.state}
      detail={probe.detail}
      onRecheck={probe.check}
      onChanged={onBaseChanged}
    />
  );

  if (!data) {
    return (
      <Screen title="You">
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
            <View style={{ marginTop: space.lg }}>{connection}</View>
          </>
        )}
      </Screen>
    );
  }

  return (
    <Screen title="You" refreshing={refreshing} onRefresh={onRefresh}>
      <WeighInCard data={data} />
      <MaintenanceCard data={data} />
      <GoalsCard data={data} />
      {connection}
      <AccountCard email={session?.email ?? ""} />
      <AboutCard />
    </Screen>
  );
}

// ------------------------------------------------------------------ weigh-in

function WeighInCard({ data }: { data: Bootstrap }) {
  const client = useQueryClient();

  const [pad, setPad] = useState(false);
  /**
   * The raw pad string. Deliberately not cleared when the pad opens — only on
   * a successful save. So a failed save can be retried by reopening the pad
   * with the number still in it, rather than being retyped.
   */
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  /**
   * The weight typed on this phone, held until the next `bootstrap` lands.
   *
   * `bootstrap` carries no last weigh-in — the nearest field is
   * `tdee.currentKg`, a fitted trend value that barely moves for one new
   * reading. Without this the big figure would not visibly change after a save,
   * which reads as a save that did not happen.
   */
  const [justLogged, setJustLogged] = useState<number | null>(null);

  const view = buildWeighIn(data, justLogged);

  function done() {
    const entry = weightFromPad(raw);

    if (!entry.ok) {
      // A null reason means the pad is untouched: DONE on an empty pad just
      // closes it rather than complaining about something the user can see is
      // blank.
      if (entry.reason === null) { setPad(false); return; }
      tapError();
      setError(entry.reason);
      return;
    }

    /*
     * Committed on screen before the server has confirmed it, and the haptic
     * fires here rather than on the response.
     *
     * The alternative — hold the pad open with a spinner until the POST returns
     * — advertises latency on the one action in this app that has none worth
     * showing. A weigh-in is idempotent on (user, date): `POST /api/weight`
     * upserts, so a retry after a lost response overwrites rather than
     * duplicating, which is what makes it safe to treat as done.
     *
     * This is not the outbox, also deliberately. `OutboxKind` is
     * `"set" | "session-start"` and widening it would mean editing shared queue
     * code for a write that happens at home, on wifi, once a morning. A visible
     * error with the number still in the pad is a better retry here than a
     * silent queue the user cannot see.
     */
    tapSave();
    setError(null);
    setJustLogged(entry.weightLb);
    setPad(false);

    void (async () => {
      try {
        await apiPost("/api/weight", { weightLb: entry.weightLb });
        setRaw("");
        // The weigh-in feeds the TDEE regression, so the maintenance card below
        // can change from this one write.
        await client.invalidateQueries({ queryKey: queryKeys.bootstrap });
      } catch (err) {
        tapError();
        // Roll the figure back: leaving it showing would claim a weigh-in that
        // is not on record anywhere.
        setJustLogged(null);
        setError(
          `${err instanceof Error ? err.message : "Could not save that weight."} `
          + "Tap LOG WEIGHT to try again.",
        );
      }
    })();
  }

  return (
    <Card>
      <Label>Weigh in</Label>
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

      <NumberPad
        visible={pad}
        value={raw}
        label="Bodyweight"
        unit="lb"
        allowDecimal
        onChange={(next) => { tapSelect(); setError(null); setRaw(next); }}
        onDone={done}
        onCancel={() => { setPad(false); setError(null); }}
      />
    </Card>
  );
}

// --------------------------------------------------------------- maintenance

function MaintenanceCard({ data }: { data: Bootstrap }) {
  const [picked, setPicked] = useState<ProposalKey | null>(null);

  const m = buildMaintenance(data);

  if (m.status === "insufficient") {
    return (
      <Card>
        <Label>Maintenance</Label>
        {/* No number at all below the floor — not a greyed-out one, not an
            estimate from height and weight. See buildMaintenance. */}
        <Text style={styles.muted}>{m.note}</Text>
      </Card>
    );
  }

  const chosen = m.proposal?.chips.find((c) => c.key === picked) ?? null;

  return (
    <Card>
      <Label>Maintenance</Label>
      <Stat label="Measured TDEE" value={<Text>{m.tdee} kcal</Text>} hint={m.hint} />
      <Text style={styles.trend}>{m.trend}</Text>

      {m.proposal !== null && (
        <View style={styles.divider}>
          <Label>Set a target</Label>
          <View style={styles.chips}>
            {m.proposal.chips.map((chip) => (
              <Toggle
                key={chip.key}
                on={picked === chip.key}
                onPress={() => { tapSelect(); setPicked(picked === chip.key ? null : chip.key); }}
              >
                {chip.label}
              </Toggle>
            ))}
          </View>

          {chosen !== null && (
            <Text style={styles.chipDetail}>
              {chosen.detail}
              {"\n"}
              {m.proposal.proteinG} g protein a day
            </Text>
          )}

          {/* Read-only in v1, and it says so rather than pretending: there is
              no endpoint that writes a targets row. */}
          <Text style={styles.note}>{m.proposal.note}</Text>
        </View>
      )}
    </Card>
  );
}

// -------------------------------------------------------------------- goals

function GoalsCard({ data }: { data: Bootstrap }) {
  const client = useQueryClient();

  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** What the server last told us, so a blur with no edit does not POST. */
  const committed = useRef<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => { if (savedTimer.current !== null) clearTimeout(savedTimer.current); },
    [],
  );

  /*
   * Seeded once, not resynced on every refetch.
   *
   * A refetch lands every 30 seconds while this tab is focused, and rewriting
   * the field from it would wipe a half-typed sentence mid-word. The cost is
   * that an edit made on the laptop while this screen is open loses to the
   * phone's copy on the next blur — acceptable, because `POST /api/profile`
   * versions goals into `goal_history` rather than overwriting them, so the
   * laptop's wording is recoverable.
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

  return (
    <Card>
      <Label>Goals</Label>
      {/*
        Free text, never a picker. A goal dropdown would reduce "half marathon
        in the fall, plus shoulders and back" to one bit of information, and
        this is the string the model reads before it answers anything.
      */}
      <TextInput
        value={text ?? ""}
        onChangeText={setText}
        onBlur={() => { void commit(); }}
        placeholder="Half marathon in the fall. Shoulders and back. Abs."
        placeholderTextColor={color.muted}
        style={styles.goals}
        multiline
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
    </Card>
  );
}

// ------------------------------------------------------------------- account

function AccountCard({ email }: { email: string }) {
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function out() {
    setBusy(true);
    try {
      await signOut();
      /*
       * Clear the read cache, never the outbox.
       *
       * Undelivered sets belong to the user who logged them and must survive a
       * sign-out so they are delivered on the next sign-in — a set logged in a
       * basement is not forfeit because somebody tapped sign out on the way
       * home. The read cache is the opposite: it is one user's data and must
       * not be on screen when the next one signs in.
       */
      client.clear();
      tapDone();
      // No navigation here. The gate in app/_layout.tsx reacts to the auth
      // state change; two things navigating on sign-out is a double replace.
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <Card>
      <Label>Account</Label>
      <Text style={styles.email} selectable>{email === "" ? "signed in" : email}</Text>

      <Button variant="danger" onPress={() => { tapSelect(); setConfirming(true); }}>
        SIGN OUT
      </Button>

      <Sheet visible={confirming} onClose={() => setConfirming(false)} title="Sign out?">
        <Text style={[styles.muted, { marginBottom: space.lg }]}>
          Sets that have not reached the server yet stay on this phone, and are
          delivered when you sign back in.
        </Text>
        <Button variant="danger" size="lg" onPress={() => { void out(); }} disabled={busy}>
          Sign out
        </Button>
        <Button
          variant="ghost"
          size="lg"
          onPress={() => setConfirming(false)}
          disabled={busy}
          style={{ marginTop: space.sm }}
        >
          Cancel
        </Button>
      </Sheet>
    </Card>
  );
}

// --------------------------------------------------------------------- about

function AboutCard() {
  const version = Constants.expoConfig?.version ?? "0.1.0";
  const sdk = Constants.expoConfig?.sdkVersion ?? "58.0.0";

  return (
    <Card>
      <Label>About</Label>
      <Text style={styles.version}>lifemaxx {version} · Expo SDK {sdk}</Text>

      {/* Both of these are things a user would otherwise spend an evening
          hunting for in a settings screen that never mentions them. */}
      <Text style={styles.about}>
        Push notifications are web-only today. Turn them on in the browser app and
        add it to your home screen — they do not reach this client.
      </Text>
      <Text style={styles.about}>
        Apple Health cannot be read from Expo Go, so there is no HealthKit here.
        The Health Auto Export webhook already brings steps, sleep and weight in,
        and keeps working untouched.
      </Text>
    </Card>
  );
}
