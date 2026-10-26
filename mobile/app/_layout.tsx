import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient, startFocusTracking } from "@/lib/query";
import { loadApiBaseOverride } from "@/lib/config";
import { setUnauthorizedHandler } from "@/lib/api";
import { startOutbox } from "@/lib/outbox";
import { useSession } from "@/lib/auth";
import { shell } from "@/lib/shell-theme";
import { useIsWide } from "@/lib/layout";
import { installWebStyles } from "@/lib/web-styles";
import { Sidebar } from "@/components/shell/Sidebar";

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
    // Hover, focus rings and the dark scrollbar on the laptop. A no-op on the
    // phone; see lib/web-styles.ts.
    installWebStyles();

    let stopOutbox: (() => void) | undefined;
    // Bridges AppState to react-query's focus manager, which otherwise waits
    // for a DOM event that never arrives. Started here, before the first
    // query mounts, and torn down with everything else.
    const stopFocus = startFocusTracking();

    void (async () => {
      await loadApiBaseOverride();
      // Only now is it safe to put a request on the wire.
      stopOutbox = startOutbox();
      setBooted(true);
    })();

    return () => {
      stopOutbox?.();
      stopFocus();
    };
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
  const wide = useIsWide();

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

  const stack = (
    <Stack
      screenOptions={{
        // Every screen draws its own header: the web app's headers carry a
        // label, a figure and an action, which a platform title bar cannot.
        headerShown: false,
        contentStyle: { backgroundColor: shell.ground },
        // On the laptop a sidebar click is going somewhere, not drilling in,
        // and a page that slides in from the right reads as the latter.
        ...(wide ? { animation: "none" as const } : null),
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="sign-in" options={{ animation: "fade" }} />
      <Stack.Screen name="runs" />
      <Stack.Screen name="exercise" />
      {/* A past workout, every set editable. Pushed from Lift and from Exercise. */}
      <Stack.Screen name="workout" />
      {/*
        A modal on the phone, where the coach is a task opened from Today. On
        the laptop it is one of the six places in the sidebar, so it is a page
        like the others rather than a card sliding up over one.
      */}
      <Stack.Screen name="coach" options={{ presentation: wide ? "card" : "modal" }} />
      {/*
        There is no `exercise-picker` route. The scaffold reserved one as a
        modal, but both callers — the live session and the voice confirmation
        sheet — render `ExercisePicker` inline inside their own overlay,
        because the component takes `onPick`/`onCancel` callbacks and a route
        cannot be handed a callback. A route rendering a placeholder that
        nothing navigates to is worse than no route, so it was deleted at
        integration.
      */}
    </Stack>
  );

  /*
   * The laptop shell: the sidebar beside the whole stack, so it stays put
   * while Runs, Coach and the drill-downs come and go beside it. Not on the
   * sign-in screen, where there is nowhere to go yet. The phone never gets
   * the sidebar, so it sees the stack exactly as before.
   *
   * The wrappers are rendered at every width rather than only on a wide one,
   * so the tree has the same shape on both sides of the breakpoint. Swapping
   * between `stack` and a wrapped `stack` would remount the navigator every
   * time a browser window was dragged across 900px.
   */
  const sidebar = wide && !onSignIn && session !== null;

  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: shell.ground }}>
      {sidebar && <Sidebar />}
      <View style={{ flex: 1 }}>{stack}</View>
    </View>
  );
}
