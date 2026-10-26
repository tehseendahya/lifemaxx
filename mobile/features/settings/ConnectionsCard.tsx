import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { Card, Label, color, hit, space, tnum } from "@/components/ui";
import { apiPost } from "@/lib/api";
import { tapError, tapSelect } from "@/lib/haptics";

import {
  connectUrl, pushDetail, pushRow, stravaDetail, stravaRow,
  type PushState, type RowView,
} from "./connections";
import { currentPushState, enablePush } from "./push";

/**
 * Strava, and in a browser, notifications.
 *
 * Strava works from both: the route returns the authorise URL, and the
 * callback finds the user from a signed `state` rather than a cookie — so the
 * phone can open it in Safari and the laptop can navigate the tab to it. Both
 * land back on `/you?strava=…`, which `SettingsScreen` turns into a notice.
 *
 * Notifications are web push, which only a browser can receive, so the row is
 * not drawn on the phone at all. Every word on both rows comes from
 * `connections.ts`.
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
  rowText: { flexShrink: 1 },
  rowLabel: { color: color.ink, fontSize: 15 },
  rowDetail: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  rowValue: { ...tnum, fontSize: 13 },
  rowValueAction: { color: color.accent },
  error: { color: color.bad, fontSize: 13, lineHeight: 19, marginTop: space.sm },
});

const WEB = Platform.OS === "web";

export function ConnectionsCard({ stravaConnected }: { stravaConnected: boolean | undefined }) {
  const [stravaBusy, setStravaBusy] = useState(false);
  const [push, setPush] = useState<PushState>("checking");
  const [pushBusy, setPushBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!WEB) return;
    let live = true;
    void currentPushState().then((state) => { if (live) setPush(state); });
    return () => { live = false; };
  }, []);

  async function connectStrava() {
    tapSelect();
    setError(null);
    setStravaBusy(true);
    try {
      // A 503 when Strava is not configured on the server arrives here as an
      // ApiError carrying the route's own sentence, which is shown as is.
      const url = connectUrl(await apiPost<unknown>("/api/mobile/strava/connect"));
      if (url === null) throw new Error("The server did not return a Strava link.");
      if (WEB) {
        // Same tab: the callback redirects back to /you, so a new tab would
        // leave this one behind showing the old state.
        window.location.assign(url);
        return; // The page is leaving; nothing to reset.
      }
      await Linking.openURL(url);
    } catch (err) {
      tapError();
      setError(err instanceof Error ? err.message : "Could not reach Strava.");
    } finally {
      setStravaBusy(false);
    }
  }

  async function turnOnPush() {
    tapSelect();
    setError(null);
    setPushBusy(true);
    try {
      setPush(await enablePush());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not turn notifications on.");
      setPush(await currentPushState());
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <Card>
      <Label>Connections</Label>
      <Row
        label="Strava"
        detail={stravaDetail(stravaConnected)}
        view={stravaRow(stravaConnected, stravaBusy)}
        divided={false}
        onPress={() => { void connectStrava(); }}
      />
      {WEB && (
        <Row
          label="Notifications"
          detail={pushDetail(push)}
          view={pushRow(push, pushBusy)}
          divided
          onPress={() => { void turnOnPush(); }}
        />
      )}
      {error !== null && <Text style={styles.error}>{error}</Text>}
    </Card>
  );
}

function Row({ label, detail, view, divided, onPress }: {
  label: string;
  detail: string;
  view: RowView;
  divided: boolean;
  onPress: () => void;
}) {
  const tone = view.tone === "good" ? color.good : view.tone === "bad" ? color.bad : color.muted;
  const body = (
    <>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {detail !== "" && <Text style={styles.rowDetail}>{detail}</Text>}
      </View>
      <Text style={[styles.rowValue, { color: tone }, view.actionable && styles.rowValueAction]}>
        {view.value}
      </Text>
    </>
  );

  // A settled row is not a button: a pointer cursor and a hover on "Connected"
  // would promise an action that does not exist.
  if (!view.actionable) {
    return <View style={[styles.row, divided && styles.divided]}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${view.value}`}
      style={({ pressed }) => [styles.row, divided && styles.divided, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}
