import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button, Card, Label, Sheet, color, font, radius, space } from "@/components/ui";
import { apiBaseUrl, defaultApiBaseUrl, setApiBaseOverride } from "@/lib/config";
import { tapError, tapSave, tapSelect } from "@/lib/haptics";

import { describeReachability } from "./model";
import type { Reachability } from "./model";

/**
 * Which server this phone is talking to, and how to change it.
 *
 * This is on both the You screen and the sign-in screen, and the second of
 * those is the point: a wrong API base URL and a wrong password fail
 * identically from the outside, and the wrong URL is by far the more likely of
 * the two on a first run. A user staring at UNREACHABLE has to be able to fix
 * it without being signed in, because they cannot sign in until it is fixed.
 *
 * The override is what makes one scanned QR code point at a LAN dev server —
 * `http://192.168.x.x:3000` — with no rebuild. Plain HTTP works in Expo Go
 * without an ATS exemption, and `newClientId()` in the shared outbox already
 * has a non-secure-context fallback written for exactly this case.
 */

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  status: { fontFamily: font.mono, fontSize: 10, letterSpacing: 1.4 },
  good: { color: color.good },
  bad: { color: color.bad },
  muted: { color: color.muted },

  url: {
    fontFamily: font.mono,
    color: color.ink,
    fontSize: 12,
    lineHeight: 18,
    marginTop: space.sm,
  },
  detail: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: space.sm },

  row: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  grow: { flex: 1 },

  input: {
    fontFamily: font.mono,
    backgroundColor: color.surface2,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    color: color.ink,
    fontSize: 16,
    paddingHorizontal: space.md,
    height: 50,
    marginBottom: space.md,
  },
  hint: { color: color.muted, fontSize: 12, lineHeight: 17, marginBottom: space.lg },
  sheetError: { color: color.bad, fontSize: 13, marginBottom: space.md },
});

export function ConnectionCard({
  reachability,
  detail,
  onRecheck,
  onChanged,
}: {
  reachability: Reachability;
  /** A one-line explanation when the probe found something other than this API. */
  detail?: string | null;
  onRecheck: () => void;
  /** Fired after the base URL actually changed, so the caller can drop cached data. */
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = apiBaseUrl();
  const fallback = defaultApiBaseUrl();
  const status = describeReachability(reachability, base);

  const open = useCallback(() => {
    tapSelect();
    setDraft(base);
    setError(null);
    setEditing(true);
  }, [base]);

  const apply = useCallback(
    async (next: string | null) => {
      setSaving(true);
      setError(null);
      try {
        await setApiBaseOverride(next);
        tapSave();
        setEditing(false);
        onChanged();
        onRecheck();
      } catch (err) {
        tapError();
        // A SecureStore write can fail, and silently keeping the old URL while
        // the sheet closes would look like the change took effect.
        setError(err instanceof Error ? err.message : "Could not save that URL.");
      } finally {
        setSaving(false);
      }
    },
    [onChanged, onRecheck],
  );

  const trimmed = draft.trim();
  const malformed = trimmed !== "" && !/^https?:\/\/.+/i.test(trimmed);

  return (
    <Card>
      <View style={styles.head}>
        <Label style={{ marginBottom: 0 }}>Connection</Label>
        <Text
          style={[
            styles.status,
            status.tone === "good" ? styles.good : status.tone === "bad" ? styles.bad : styles.muted,
          ]}
        >
          {status.text}
        </Text>
      </View>

      <Text style={styles.url} selectable>
        {base === "" ? "not set" : base}
      </Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}

      <View style={styles.row}>
        <Button variant="secondary" onPress={open} style={styles.grow}>
          Edit
        </Button>
        <Button
          variant="ghost"
          onPress={() => { tapSelect(); onRecheck(); }}
          disabled={reachability === "checking" || base === ""}
          style={styles.grow}
        >
          Re-check
        </Button>
      </View>

      <Sheet visible={editing} onClose={() => setEditing(false)} title="API server">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="https://lifemaxx.vercel.app"
          placeholderTextColor={color.muted}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          // `url` rather than `default`: it puts "/" and ".com" on the keyboard
          // and leaves autocorrect out of a hostname.
          keyboardType="url"
          autoComplete="off"
          accessibilityLabel="API base URL"
        />
        <Text style={styles.hint}>
          Scheme and host, no trailing path — the app appends /api itself. Use your
          laptop&apos;s LAN address to point at a dev server.
        </Text>

        {error !== null && <Text style={styles.sheetError}>{error}</Text>}
        {malformed && <Text style={styles.sheetError}>Start with http:// or https://</Text>}

        <Button
          size="lg"
          onPress={() => { void apply(trimmed); }}
          disabled={saving || trimmed === "" || malformed || trimmed === base}
        >
          Save
        </Button>
        <Button
          variant="ghost"
          size="lg"
          onPress={() => { void apply(null); }}
          // Nothing to reset to when the bundle shipped without a URL, and
          // nothing to reset from when the override is already gone.
          disabled={saving || fallback === "" || base === fallback}
          style={{ marginTop: space.sm }}
        >
          {fallback === "" ? "No bundled default" : `Reset to ${fallback}`}
        </Button>
      </Sheet>
    </Card>
  );
}

// ------------------------------------------------------------------- probing

/** Long enough for a cold serverless start, short enough not to look stuck. */
const PROBE_TIMEOUT_MS = 8_000;

export interface ReachabilityProbe {
  state: Reachability;
  detail: string | null;
  check: () => void;
}

/**
 * Is the configured server up, and is it actually this app's API?
 *
 * Three deliberate choices here, all of them non-obvious:
 *
 *  - It uses the global `fetch`, not `apiGet`. A 401 through `apiGet` triggers
 *    the unauthorized handler, which signs the user out and replaces the route
 *    with /sign-in. On the sign-in screen that is a redirect loop, and on the
 *    You screen it would sign someone out for the crime of looking at their
 *    settings.
 *  - It probes `/api/mobile/coach?limit=1` rather than `bootstrap`. A liveness
 *    check must not pull the 27 KB dashboard payload, and it must work while
 *    signed out — `limit=1` is the smallest authenticated response on the
 *    native surface.
 *  - A 401 counts as CONNECTED. "Not signed in" is this API answering
 *    correctly; the question this card asks is whether the server is reachable,
 *    not whether there is a session. No token is sent at all, so the answer
 *    does not depend on one.
 *
 * The body is inspected rather than just the status because the most useful
 * thing this can catch is a URL pointing at a live server that is not lifemaxx
 * — a 200 from someone's router admin page would otherwise read as CONNECTED.
 */
export function useReachability(): ReachabilityProbe {
  const [state, setState] = useState<Reachability>("unknown");
  const [detail, setDetail] = useState<string | null>(null);

  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const check = useCallback(() => {
    const base = apiBaseUrl();
    if (base === "") {
      setState("unreachable");
      setDetail(null);
      return;
    }

    setState("checking");
    setDetail(null);

    void (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

      try {
        const res = await fetch(`${base}/api/mobile/coach?limit=1`, {
          method: "GET",
          signal: controller.signal,
        });

        const text = await res.text();
        let shaped = false;
        try {
          const body = JSON.parse(text) as Record<string, unknown>;
          shaped = Array.isArray(body.messages) || typeof body.error === "string";
        } catch {
          /* not JSON — see below */
        }

        if (!alive.current) return;

        if (shaped) {
          setState("connected");
        } else {
          setState("unreachable");
          setDetail(`Something answered at that address, but it is not the lifemaxx API (HTTP ${res.status}).`);
        }
      } catch (err) {
        if (!alive.current) return;
        setState("unreachable");
        setDetail(
          err instanceof Error && err.name === "AbortError"
            ? "The server did not answer within eight seconds."
            : null,
        );
      } finally {
        clearTimeout(timer);
      }
    })();
  }, []);

  return { state, detail, check };
}
