import { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text,
  TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import { Button, Card, Label, Spinner, color, font, radius, space } from "@/components/ui";
import {
  ensureProfileForCurrentUser, isSupabaseConfigured, requestPasswordReset, signIn, signUp,
  useSession,
} from "@/lib/auth";
import { apiBaseUrl } from "@/lib/config";
import { tapError, tapSave, tapSelect } from "@/lib/haptics";
import { useIsWide } from "@/lib/layout";

import { ConnectionCard, useReachability } from "./ConnectionCard";
import { passwordResetRedirect } from "./model";

/**
 * Email and password.
 *
 * Deliberately not a magic link: a link means leaving the app, registering a
 * scheme and handling a cold-start deep link, and the web app already has
 * password auth. The session this produces is what every API request then
 * carries as `Authorization: Bearer <jwt>` — a native client has no cookies, so
 * without it every screen in the app renders empty.
 *
 * This is one of exactly two screens where the system keyboard is the right
 * answer; the other is the coach's message field. Everything numeric in this
 * app uses `NumberPad` instead.
 *
 * "Forgot password?" emails a reset link. The link opens in a browser on the
 * server's own `/auth/callback` and `/reset-password` pages — the new password
 * is set there, not in this app, which keeps the deep-link problem out of it —
 * and then the user signs in here as normal. The old web login page was the
 * only other place to ask for one, and it is gone.
 *
 * On a laptop the form is a centred column rather than stretching across the
 * window; the phone layout is unchanged.
 */

const styles = StyleSheet.create({
  brand: {
    fontFamily: font.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: color.muted,
  },
  title: {
    color: color.ink,
    fontSize: 30,
    fontWeight: "600",
    letterSpacing: -0.6,
    marginTop: space.xs,
    marginBottom: space.xxl,
  },

  input: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    color: color.ink,
    // 16pt floor: smaller is uncomfortable to proof-read a typed password
    // against, and it is the same floor the coach's composer uses.
    fontSize: 16,
    paddingHorizontal: space.md,
    height: 50,
  },
  field: { marginBottom: space.lg },

  error: { color: color.bad, fontSize: 13, lineHeight: 19, marginTop: space.md },
  notice: { color: color.muted, fontSize: 13, lineHeight: 19, marginTop: space.md },

  switcher: { paddingVertical: space.md, marginTop: space.lg },
  switcherText: { color: color.accent, fontSize: 14 },

  blockerText: { color: color.bad, fontSize: 13, lineHeight: 19 },
  forgot: { paddingVertical: space.sm, alignSelf: "flex-start" },

  busy: { alignItems: "center", justifyContent: "center", height: 56 },

  /** The laptop: a narrow centred form, a little way down the window. */
  wide: { width: "100%", maxWidth: 420, alignSelf: "center" },
});

type Mode = "in" | "up";

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const wide = useIsWide();
  const client = useQueryClient();
  const probe = useReachability();
  const { session } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<Mode>("in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { check } = probe;
  useEffect(() => { check(); }, [check]);

  const ready = email.trim() !== "" && password !== "" && !busy && isSupabaseConfigured();

  const submit = useCallback(async () => {
    if (!ready) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === "in") {
        await signIn(email, password);
        /*
         * Every screen in the app reads the `profiles` row, so a signed-in user
         * without one is authenticated and invisible. `signUp` already does
         * this when confirmation is off, but the case that matters is the
         * other one: the account was created, the email was confirmed, and
         * this first real sign-in is the first moment there is a token to
         * create the row with.
         */
        await ensureProfileForCurrentUser();
        // Nothing of the previous user's may survive into this session.
        client.clear();
        tapSave();
      } else {
        await signUp(email, password);
        tapSave();
        /*
         * With email confirmation switched on, `signUp` returns a user and no
         * session — so the gate in app/_layout.tsx will not move, and
         * navigating anyway would push a screen that bounces straight back
         * here. Say what has to happen instead, and drop them into sign-in
         * mode so the next tap is the right one.
         */
        setMode("in");
        setPassword("");
        setNotice("Check your email to confirm the account, then sign in.");
      }
      // No navigation on success. The gate in app/_layout.tsx owns that and
      // reacts to the auth state change; two things navigating is a double push.
    } catch (err) {
      tapError();
      // Inline, never an Alert. A system dialog in a system typeface for a
      // mistyped password is the app interrupting the user about their own
      // action.
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }, [ready, mode, email, password, client]);

  /*
   * The link has to land on the server: the page's own origin in a browser
   * (the app and the API are one site there), the API base URL on the phone.
   */
  const forgot = useCallback(async () => {
    if (busy) return;
    if (email.trim() === "") {
      setNotice(null);
      setError("Type your email above first, then tap Forgot password.");
      return;
    }
    const origin = Platform.OS === "web" && typeof window !== "undefined"
      ? window.location.origin
      : apiBaseUrl();
    const redirectTo = passwordResetRedirect(origin);
    if (redirectTo === null) {
      setNotice(null);
      setError("No server is set, so there is nowhere for the reset link to go. Set one below.");
      return;
    }

    tapSelect();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await requestPasswordReset(email, redirectTo);
      setNotice("Check your email for a link to set a new password, then sign in here.");
    } catch (err) {
      tapError();
      setError(err instanceof Error ? err.message : "Could not send the reset email.");
    } finally {
      setBusy(false);
    }
  }, [busy, email]);

  const switchMode = useCallback(() => {
    tapSelect();
    setMode((m) => (m === "in" ? "up" : "in"));
    setError(null);
    setNotice(null);
  }, []);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.ground }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          {
            paddingHorizontal: space.lg,
            paddingTop: wide ? 96 : insets.top + 48,
            paddingBottom: insets.bottom + space.xxl,
          },
          wide && styles.wide,
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.brand}>lifemaxx</Text>
        <Text style={styles.title}>{mode === "in" ? "Sign in" : "Create an account"}</Text>

        {!isSupabaseConfigured() && (
          <Blocker>
            Supabase is not configured in this build. Set EXPO_PUBLIC_SUPABASE_URL
            and EXPO_PUBLIC_SUPABASE_ANON_KEY, or fill in expo.extra in app.json,
            then restart the bundler.
          </Blocker>
        )}

        <View style={styles.field}>
          <Label>Email</Label>
          <TextInput
            value={email}
            onChangeText={setEmail}
            style={styles.input}
            placeholderTextColor={color.muted}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            accessibilityLabel="Email"
          />
        </View>

        <View style={styles.field}>
          <Label>Password</Label>
          <TextInput
            value={password}
            onChangeText={setPassword}
            style={styles.input}
            placeholderTextColor={color.muted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            textContentType={mode === "in" ? "password" : "newPassword"}
            returnKeyType="go"
            onSubmitEditing={() => { void submit(); }}
            accessibilityLabel="Password"
          />
        </View>

        {error !== null && <Text style={styles.error}>{error}</Text>}
        {notice !== null && <Text style={styles.notice}>{notice}</Text>}

        {busy ? (
          <View style={styles.busy}><Spinner size="large" /></View>
        ) : (
          <Button
            size="lg"
            onPress={() => { void submit(); }}
            disabled={!ready}
            style={{ marginTop: space.xl }}
          >
            {mode === "in" ? "SIGN IN" : "CREATE ACCOUNT"}
          </Button>
        )}

        <Pressable onPress={switchMode} style={styles.switcher} accessibilityRole="link">
          <Text style={styles.switcherText}>
            {mode === "in" ? "No account yet? Create one →" : "Already have an account? Sign in →"}
          </Text>
        </Pressable>

        {mode === "in" && (
          <Pressable
            onPress={() => { void forgot(); }}
            disabled={busy || !isSupabaseConfigured()}
            style={styles.forgot}
            accessibilityRole="link"
          >
            <Text style={styles.switcherText}>Forgot password?</Text>
          </Pressable>
        )}

        {/*
          The same connection editor as the You screen, and the reason it is
          here is that this is where it is needed most: a wrong API base URL and
          a wrong password fail identically from the outside, and on a first run
          the URL is by far the more likely of the two. A user staring at
          UNREACHABLE cannot sign in until they can fix it, and they cannot
          reach the You screen until they sign in.
        */}
        <View style={{ marginTop: space.xxl }}>
          <ConnectionCard
            reachability={probe.state}
            detail={probe.detail}
            onRecheck={probe.check}
            onChanged={() => client.clear()}
          />
        </View>

        {/* Only reachable in the window between a successful sign-in and the
            gate's redirect, so it says what is happening rather than nothing. */}
        {session !== null && <Text style={styles.notice}>Signed in. Loading your data…</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Blocker({ children }: { children: React.ReactNode }) {
  return (
    <Card style={{ borderColor: color.bad }}>
      <Text style={styles.blockerText}>{children}</Text>
    </Card>
  );
}
