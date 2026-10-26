import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { useQueryClient } from "@tanstack/react-query";

import {
  Button, Card, Label, Sheet, color, font, hit, space, tnum,
} from "@/components/ui";
import { apiBaseUrl } from "@/lib/config";
import { signOut } from "@/lib/auth";
import { tapDone, tapSelect } from "@/lib/haptics";

import { ConnectionCard } from "./ConnectionCard";
import type { ReachabilityProbe } from "./ConnectionCard";
import { describeReachability } from "./model";

/**
 * Settings, collapsed to one grouped list (the iOS Settings pattern).
 *
 * Server, account and about used to be three full cards at the foot of You,
 * each as tall as the goals card above them, for things touched a few times a
 * year. Now they are three 44pt rows with the current value on the right, and
 * the full card opens in a sheet. You leads with body and goals; this is the
 * part you scroll past.
 */

const styles = StyleSheet.create({
  row: {
    minHeight: hit.min,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingVertical: space.sm,
  },
  divided: { borderTopWidth: 1, borderTopColor: color.line },
  pressed: { opacity: 0.7 },
  rowLabel: { color: color.ink, fontSize: 15 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 1 },
  rowValue: { ...tnum, color: color.muted, fontSize: 13, flexShrink: 1 },
  chevron: { color: color.muted, fontSize: 16 },

  muted: { color: color.muted, fontSize: 13, lineHeight: 19 },
  email: { fontFamily: font.mono, color: color.ink, fontSize: 13, marginBottom: space.lg },
  about: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: space.sm },
  version: { ...tnum, fontFamily: font.mono, color: color.muted, fontSize: 11 },
});

type Open = "server" | "account" | "about" | null;

/** The figure on the right of a row, in the tone it was given. */
function Row({ label, value, tone = "muted", divided, onPress }: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "muted";
  divided: boolean;
  onPress: () => void;
}) {
  const valueColour = tone === "good" ? color.good : tone === "bad" ? color.bad : color.muted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      onPress={() => { tapSelect(); onPress(); }}
      style={({ pressed }) => [styles.row, divided && styles.divided, pressed && styles.pressed]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        <Text style={[styles.rowValue, { color: valueColour }]} numberOfLines={1}>{value}</Text>
        <Text style={styles.chevron}>›</Text>
      </View>
    </Pressable>
  );
}

export function SettingsRows({ probe, onBaseChanged, email }: {
  probe: ReachabilityProbe;
  onBaseChanged: () => void;
  email: string;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState<Open>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const version = Constants.expoConfig?.version ?? "0.1.0";
  const sdk = Constants.expoConfig?.sdkVersion ?? "58.0.0";
  const status = describeReachability(probe.state, apiBaseUrl());

  const close = () => { setOpen(null); setConfirming(false); };

  async function out() {
    setBusy(true);
    try {
      await signOut();
      /*
       * Clear the read cache, never the outbox. Undelivered sets belong to the
       * user who logged them and are delivered on the next sign-in; the read
       * cache is one user's data and must not be on screen for the next.
       */
      client.clear();
      tapDone();
      // No navigation here. The gate in app/_layout.tsx reacts to the auth
      // state change; two things navigating on sign-out is a double replace.
    } finally {
      setBusy(false);
      close();
    }
  }

  return (
    <Card>
      <Label>Settings</Label>
      <Row
        label="Server"
        value={status.text.charAt(0) + status.text.slice(1).toLowerCase()}
        tone={status.tone}
        divided={false}
        onPress={() => setOpen("server")}
      />
      <Row
        label="Account"
        value={email === "" ? "signed in" : email}
        divided
        onPress={() => setOpen("account")}
      />
      <Row label="About" value={`v${version}`} divided onPress={() => setOpen("about")} />

      {/*
        The existing card, unchanged, inside a sheet. It keeps its own URL
        editor sheet; nesting is one level, and it is where the API base URL is
        fixed when nothing else on the phone can load.
      */}
      <Sheet visible={open === "server"} onClose={close} title="Server">
        <ConnectionCard
          reachability={probe.state}
          detail={probe.detail}
          onRecheck={probe.check}
          onChanged={onBaseChanged}
        />
      </Sheet>

      <Sheet visible={open === "account"} onClose={close} title={confirming ? "Sign out?" : "Account"}>
        {!confirming ? (
          <>
            <Text style={styles.email} selectable>{email === "" ? "signed in" : email}</Text>
            <Button variant="danger" size="lg" onPress={() => { tapSelect(); setConfirming(true); }}>
              SIGN OUT
            </Button>
          </>
        ) : (
          <>
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
          </>
        )}
      </Sheet>

      <Sheet visible={open === "about"} onClose={close} title="About">
        <Text style={styles.version}>lifemaxx {version} · Expo SDK {sdk}</Text>
        {/* Both are things a user would otherwise spend an evening hunting for. */}
        <Text style={styles.about}>
          Push notifications are web-only today. Turn them on in the browser app and
          add it to your home screen — they do not reach this client.
        </Text>
        <Text style={styles.about}>
          Apple Health cannot be read from Expo Go, so there is no HealthKit here.
          The Health Auto Export webhook already brings steps, sleep and weight in,
          and keeps working untouched.
        </Text>
      </Sheet>
    </Card>
  );
}
