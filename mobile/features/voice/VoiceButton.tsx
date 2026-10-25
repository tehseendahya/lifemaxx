import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  AudioQuality,
  IOSOutputFormat,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { File } from "expo-file-system";
import { useKeepAwake } from "expo-keep-awake";
import { useNetworkState } from "expo-network";

import { color, hit, radius, space, tnum } from "@/components/ui";
import { microLabel } from "@/components/ui/Label";
import { ApiError } from "@/lib/api";
import { tapError, tapSave, tapSelect } from "@/lib/haptics";
import type { TranscribeResponse } from "@/lib/types";

import { transcribeAudio } from "./requests";
import { COUNTDOWN_MS, MAX_RECORD_MS, countdownLabel, elapsedLabel, meterLevel } from "./model";

const BARS = 5;
const DIAMETER = hit.big;

/**
 * Voice-tuned, not music-tuned.
 *
 * 16 kHz mono at 24 kbps is roughly a tenth of `RecordingPresets.HIGH_QUALITY`
 * and loses nothing a transcriber uses — speech is almost entirely under 8 kHz
 * and a gym has one person talking into one microphone. The result is about
 * 45 KB for the full fifteen seconds, which uploads on bad cell data in about a
 * second instead of ten. Metering is on because the level meter is the only
 * honest proof the microphone is live.
 */
const RECORDING_OPTIONS = {
  extension: ".m4a",
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 24_000,
  isMeteringEnabled: true,
  android: { outputFormat: "mpeg4", audioEncoder: "aac" },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: "audio/webm", bitsPerSecond: 24_000 },
} as const;

const styles = StyleSheet.create({
  root: { alignItems: "center", justifyContent: "center" },
  button: {
    width: DIAMETER,
    height: DIAMETER,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  recording: { backgroundColor: color.accent, borderColor: color.accent },
  working: { borderColor: color.accent },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 },

  glyph: { color: color.ink, fontSize: 20 },
  glyphRecording: { color: color.accentInk, fontSize: 14, fontWeight: "700" },
  glyphWorking: { color: color.accent, fontSize: 11, fontWeight: "700" },

  readout: { position: "absolute", top: DIAMETER + 4, alignItems: "center", width: 96 },
  clock: { ...microLabel, ...tnum, marginBottom: 0 },
  clockUrgent: { color: color.warn },

  meter: { flexDirection: "row", gap: 2, marginTop: 3 },
  bar: { width: 3, height: 8, borderRadius: 1, backgroundColor: color.line },
  barLit: { backgroundColor: color.accent },
});

type Phase = "idle" | "recording" | "uploading";

/**
 * Speak a set.
 *
 * This is the SECOND way into the confirmation sheet, and it is built to be
 * removable: the typed path beside it posts to `/api/sets/parse` and needs no
 * transcription model, no microphone permission and no recording. When this
 * button cannot work — no signal, permission refused, `OPENAI_TRANSCRIBE_MODEL`
 * unset on the server — it says so in one inline line and the typed path is
 * untouched. Nothing here is on the critical path.
 *
 * **Tap to start, tap to stop — not hold-to-talk.** With chalk or sweat on a
 * finger a press can lift without the user noticing, and a hold that drops
 * mid-sentence truncates the recording *silently*: you find out when you read
 * half a transcript. A toggle also lets the phone sit on the bench while you
 * talk. The cost is one extra tap, which is the right trade.
 *
 * No silence detection in v1. Metering-based voice activity detection is a
 * guess, and a guess that ends your sentence early is worse than a second tap.
 */
export function VoiceButton({
  exerciseName,
  onTranscribed,
  onNotice,
}: {
  /** Sent as the decoding hint, to bias toward e.g. "weighted pull up". */
  exerciseName: string | null;
  onTranscribed: (parsed: TranscribeResponse) => void;
  /**
   * One inline line of explanation. Never an `Alert`.
   *
   * `bad` separates "this will not work and here is what to do instead" from
   * "here is what just happened", rather than the caller inferring a tone from
   * the wording.
   */
  onNotice: (message: string | null, bad?: boolean) => void;
}) {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const state = useAudioRecorderState(recorder, 100);
  const network = useNetworkState();

  const [phase, setPhase] = useState<Phase>("idle");

  /**
   * The recording is kept after a failed upload.
   *
   * Retrying re-uploads the same audio instead of asking someone in a gym to
   * repeat a sentence they already said. It is deleted on a successful parse or
   * an explicit discard, and never written anywhere but the OS cache — same
   * rule as meal photos.
   */
  const pending = useRef<string | null>(null);

  useKeepAwake();

  /**
   * Drops the local recording.
   *
   * Only touches the ref, so it is stable for the lifetime of the component and
   * safe to call from the unmount cleanup as well as from the success path.
   */
  const discard = useCallback(() => {
    const uri = pending.current;
    pending.current = null;
    if (uri === null) return;
    try {
      // Synchronous in the new expo-file-system API. A throw here means the OS
      // already reclaimed the cache entry, which is the outcome we wanted.
      new File(uri).delete();
    } catch {
      /* Nothing to clean up. */
    }
  }, []);

  /**
   * `isInternetReachable` is tri-state: `true`, `false`, or `undefined` while
   * the probe is still out. Treating `undefined` as offline would grey the
   * button out for a second on every mount, so only an explicit `false` counts.
   */
  const offline = network.isConnected === false || network.isInternetReachable === false;

  const stopAndUpload = useCallback(async () => {
    tapSave();
    setPhase("uploading");

    let uri = pending.current;
    try {
      await recorder.stop();
      uri = recorder.uri ?? uri;
    } catch (err) {
      console.error("[voice] the recorder would not stop", err);
    }

    if (uri === null || uri === undefined) {
      setPhase("idle");
      onNotice("Nothing was recorded. Tap the mic again, or type it.", true);
      return;
    }
    pending.current = uri;

    try {
      const parsed = await transcribeAudio(uri, exerciseName ?? undefined);
      discard();
      setPhase("idle");
      onTranscribed(parsed);
    } catch (err) {
      tapError();
      setPhase("idle");
      onNotice(describeFailure(err), true);
    }
  }, [recorder, exerciseName, onTranscribed, onNotice, discard]);

  /** Auto-stop at the cap. A phone recording in a pocket is not a feature. */
  useEffect(() => {
    if (phase !== "recording") return;
    if (state.durationMillis < MAX_RECORD_MS) return;
    void stopAndUpload();
  }, [phase, state.durationMillis, stopAndUpload]);

  /**
   * Leaving the screen mid-recording.
   *
   * Without this the recorder keeps the audio session — and therefore the
   * microphone indicator — after the component is gone, which looks exactly
   * like an app recording in the background.
   */
  useEffect(() => () => {
    void recorder.stop().catch(() => {
      /* Already stopped, or never started. */
    });
    discard();
  }, [recorder, discard]);

  const start = useCallback(async () => {
    onNotice(null);

    const existing = await getRecordingPermissionsAsync();
    const granted = existing.granted
      ? true
      : (await requestRecordingPermissionsAsync()).granted;

    if (!granted) {
      // One line, not an alert, and not a trip to Settings. The typed path is
      // right next to this button and needs no permission at all.
      onNotice("No microphone access. Type it instead — it goes to the same place.", true);
      return;
    }

    try {
      // Must come before `prepareToRecordAsync`: on iOS the recording category
      // is what makes the input route available, and preparing first leaves the
      // session configured for playback.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      tapSelect();
      setPhase("recording");
    } catch (err) {
      console.error("[voice] could not start recording", err);
      tapError();
      onNotice("The microphone would not start. Type it instead.", true);
    }
  }, [recorder, onNotice]);

  const press = useCallback(() => {
    if (phase === "uploading") {
      // Retry with the audio already in hand, rather than re-recording.
      if (pending.current !== null) void stopAndUpload();
      return;
    }
    if (phase === "recording") {
      void stopAndUpload();
      return;
    }
    if (offline) {
      /*
       * Queueing the audio for later transcription is deliberately rejected.
       * The result needs confirming, and asking someone to confirm a sentence
       * they said forty minutes ago in the car park is worse than a one-tap
       * manual log — they cannot remember what they said, so they cannot check
       * it, so they confirm it blind. Logging by hand works offline and is
       * right here.
       */
      onNotice("No signal. Speaking needs the server; typing and the pad work offline.", true);
      return;
    }
    void start();
  }, [phase, offline, start, stopAndUpload, onNotice]);

  const lit = phase === "recording" ? meterLevel(state.metering, BARS) : 0;
  const urgent = phase === "recording" && MAX_RECORD_MS - state.durationMillis <= COUNTDOWN_MS;
  const countdown = phase === "recording" ? countdownLabel(state.durationMillis) : null;

  return (
    <View style={styles.root}>
      <Pressable
        onPress={press}
        // Chalky thumbs miss a 56pt circle more often than they miss a 56pt
        // rectangle, because the corners are not there to catch them.
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={
          phase === "recording"
            ? "Stop recording"
            : phase === "uploading"
              ? "Transcribing. Tap to retry."
              : offline
                ? "Speaking needs a connection"
                : "Speak a set"
        }
        accessibilityState={{ disabled: offline && phase === "idle" }}
        style={({ pressed }) => [
          styles.button,
          phase === "recording" && styles.recording,
          phase === "uploading" && styles.working,
          offline && phase === "idle" && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        {phase === "recording" ? (
          <Text style={styles.glyphRecording}>STOP</Text>
        ) : phase === "uploading" ? (
          <Text style={styles.glyphWorking}>···</Text>
        ) : (
          <Text style={styles.glyph}>◉</Text>
        )}
      </Pressable>

      <View style={styles.readout} pointerEvents="none">
        {phase === "recording" && (
          <>
            <Text style={[styles.clock, urgent && styles.clockUrgent]}>
              {countdown ?? elapsedLabel(state.durationMillis)}
            </Text>
            <View style={styles.meter}>
              {Array.from({ length: BARS }, (_, i) => (
                <View key={i} style={[styles.bar, i < lit && styles.barLit]} />
              ))}
            </View>
          </>
        )}
        {phase === "uploading" && <Text style={styles.clock}>TRANSCRIBING…</Text>}
        {phase === "idle" && offline && <Text style={styles.clock}>NEEDS SIGNAL</Text>}
      </View>
    </View>
  );
}

/**
 * What to say when the upload fails, in the user's terms.
 *
 * The 503 is its own case because it is not a failure the user can retry: the
 * server has no transcription model configured, so the mic will not work until
 * somebody sets one. Telling them to try again would be a lie.
 */
function describeFailure(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503) return "Speaking isn’t set up yet — type it instead.";
    if (err.status === 400 || err.status === 413 || err.status === 415) return err.message;
    return "Didn’t come back. Tap to retry, or type it instead.";
  }
  return "Didn’t come back. Tap to retry, or type it instead.";
}
