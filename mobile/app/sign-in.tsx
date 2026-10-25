import { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { signIn, signUp, isSupabaseConfigured } from "@/lib/auth";
import { apiBaseUrl, isApiBaseConfigured } from "@/lib/config";
import { shell, microLabel } from "@/lib/shell-theme";
import { tapSave, tapError } from "@/lib/haptics";

/**
 * Email and password.
 *
 * Deliberately not a magic link: a link means leaving the app, registering a
 * scheme and handling a cold-start deep link, and the web app already has
 * password auth. The session that comes out of this is what every API request
 * then carries as a bearer token.
 *
 * This is one of exactly two screens where the system keyboard is the right
 * answer (the other is the coach's message field). Everything numeric in the
 * app uses the custom number pad instead.
 */
export default function SignIn() {
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ready = email.trim() !== "" && password !== "" && !busy;

  async function submit() {
    if (!ready) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === "in") {
        await signIn(email, password);
      } else {
        await signUp(email, password);
        // With email confirmation switched on there is no session yet, so the
        // gate in the root layout will not move. Say why, rather than leaving
        // the screen looking stuck.
        setNotice("Account created. If it asks you to confirm your email, do that and sign in.");
      }
      tapSave();
      // No navigation here: the gate in app/_layout.tsx owns that, and it
      // reacts to the auth state change. Two things navigating on sign-in is
      // how you get a double push.
    } catch (err) {
      tapError();
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: shell.ground }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ ...microLabel, color: shell.muted }}>lifemaxx</Text>
        <Text style={{ color: shell.ink, fontSize: 30, fontWeight: "600", marginTop: 6, marginBottom: 28 }}>
          {mode === "in" ? "Sign in" : "Create an account"}
        </Text>

        {!isSupabaseConfigured() && (
          <Blocker text="Supabase is not configured in this build. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, or fill in expo.extra in app.json, then restart the bundler." />
        )}
        {!isApiBaseConfigured() && (
          <Blocker text="No API URL is set in this build. Set EXPO_PUBLIC_API_BASE_URL or expo.extra.apiBaseUrl in app.json, then restart the bundler." />
        )}

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          textContentType={mode === "in" ? "password" : "newPassword"}
          onSubmitEditing={submit}
          returnKeyType="go"
        />

        {error && <Text style={{ color: shell.bad, fontSize: 13, marginTop: 14 }}>{error}</Text>}
        {notice && <Text style={{ color: shell.muted, fontSize: 13, marginTop: 14 }}>{notice}</Text>}

        <Pressable
          onPress={submit}
          disabled={!ready}
          style={{
            marginTop: 24,
            height: 52,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: ready ? shell.accent : shell.line,
          }}
        >
          {busy ? (
            <ActivityIndicator color={shell.ground} />
          ) : (
            <Text style={{ ...microLabel, color: ready ? shell.ground : shell.muted, fontSize: 12 }}>
              {mode === "in" ? "Sign in" : "Create account"}
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => { setMode(mode === "in" ? "up" : "in"); setError(null); setNotice(null); }}
          style={{ marginTop: 20, paddingVertical: 8 }}
        >
          <Text style={{ color: shell.accent, fontSize: 14 }}>
            {mode === "in" ? "No account yet? Create one →" : "Already have an account? Sign in →"}
          </Text>
        </Pressable>

        {/* Which server this build is talking to. Worth showing here because a
            sign-in failure and a wrong API URL look identical otherwise. */}
        <Text style={{ ...microLabel, color: shell.muted, marginTop: 40 }}>API</Text>
        <Text style={{ color: shell.muted, fontSize: 12, fontFamily: "Menlo", marginTop: 4 }}>
          {isApiBaseConfigured() ? apiBaseUrl() : "not set"}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Blocker({ text }: { text: string }) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: shell.bad,
        borderRadius: 10,
        padding: 12,
        marginBottom: 20,
      }}
    >
      <Text style={{ color: shell.bad, fontSize: 13, lineHeight: 19 }}>{text}</Text>
    </View>
  );
}

type FieldProps = React.ComponentProps<typeof TextInput> & { label: string };

function Field({ label, ...rest }: FieldProps) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ ...microLabel, color: shell.muted, marginBottom: 6 }}>{label}</Text>
      <TextInput
        {...rest}
        placeholderTextColor={shell.muted}
        style={{
          backgroundColor: shell.surface,
          borderWidth: 1,
          borderColor: shell.line,
          borderRadius: 10,
          color: shell.ink,
          // 16pt minimum: iOS zooms the page for anything smaller in a web
          // view, and the same floor keeps the two clients consistent.
          fontSize: 16,
          paddingHorizontal: 14,
          height: 50,
        }}
      />
    </View>
  );
}
