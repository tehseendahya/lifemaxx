import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "@/lib/query";
import { loadApiBaseOverride } from "@/lib/config";
import { setUnauthorizedHandler } from "@/lib/api";
import { startOutbox } from "@/lib/outbox";
import { useSession } from "@/lib/auth";
import { shell } from "@/lib/shell-theme";

/**
 * The root of the app: boot order, the session gate, and the stack.
 *
 * Boot order is the part that is easy to get wrong. `loadApiBaseOverride()`
 * reads the stored API base URL from SecureStore, and `apiBaseUrl()` is
 * synchronous because every request needs it — so nothing may make a request
 * until that read has finished. If the outbox started first it would flush
 * against the bundled default and a user pointing the app at a LAN dev server
 * would watch their queued sets fail against production.
 */
export default function RootLayout() {
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    let stopOutbox: (() => void) | undefined;

    void (async () => {
      await loadApiBaseOverride();
      // Only now is it safe to put a request on the wire.
      stopOutbox = startOutbox();
      setBooted(true);
    })();

    return () => stopOutbox?.();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: shell.ground }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          {booted ? <Gate /> : <Booting />}
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Booting() {
  return (
    <View style={{ flex: 1, backgroundColor: shell.ground, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color={shell.accent} />
    </View>
  );
}

/**
 * Sends a signed-out user to sign-in, and a signed-in user away from it.
 *
 * This runs in an effect rather than rendering a `<Redirect>` because the
 * navigator has to be mounted before it can be navigated: redirecting during
 * the first render of the root layout is a "navigate before mount" warning and,
 * intermittently, a no-op. Gating on `loading` matters too — the stored session
 * is read from the keychain asynchronously, so for the first frame after a cold
 * launch there is legitimately no session yet, and acting on that would bounce
 * an already-signed-in user to the sign-in screen on every launch.
 */
function Gate() {
  const { session, loading } = useSession();
  const segments = useSegments();
  const router = useRouter();

  const onSignIn = segments[0] === "sign-in";

  useEffect(() => {
    // A 401 from any request means the token is gone for good; `api.ts` has
    // already cleared the session by the time this fires.
    setUnauthorizedHandler(() => router.replace("/sign-in"));
    return () => setUnauthorizedHandler(null);
  }, [router]);

  useEffect(() => {
    if (loading) return;
    if (!session && !onSignIn) router.replace("/sign-in");
    else if (session && onSignIn) router.replace("/");
  }, [session, loading, onSignIn, router]);

  if (loading) return <Booting />;

  return (
    <Stack
      screenOptions={{
        // Every screen draws its own header: the web app's headers carry a
        // label, a figure and an action, which a platform title bar cannot.
        headerShown: false,
        contentStyle: { backgroundColor: shell.ground },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="sign-in" options={{ animation: "fade" }} />
      <Stack.Screen name="runs" />
      <Stack.Screen name="exercise" />
      <Stack.Screen name="coach" options={{ presentation: "modal" }} />
      <Stack.Screen name="exercise-picker" options={{ presentation: "modal" }} />
    </Stack>
  );
}
