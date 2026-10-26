import { StyleSheet, View } from "react-native";

import { color } from "./tokens";

/**
 * A meter, not a chart.
 *
 * It lives here rather than in `charts.tsx` because it breaks that file's one
 * invariant on purpose. `charts.tsx` says a line is not a state and therefore
 * never carries status colour: a trend that turns red is the chart telling you
 * what to think about a number you can already read. This is the other thing
 * entirely — a single value against a named productive range, where "under",
 * "in range" and "over" ARE the content. Colour is the reading.
 *
 * Why `under` is accent rather than something quieter: accent means *act*,
 * `good` means *done*, `warn` means *too much*. The row you most need to do
 * something about must not be the quietest row on the card.
 *
 * Percentage widths throughout, so there is no `onLayout`, no measured width
 * and no first-frame flash at zero — which also means a column of these all
 * agree about where the band sits before anything has been laid out.
 *
 * Non-interactive and unlabelled by design: the row that contains it supplies
 * the muscle name and the figure, and a progress-bar role would make a screen
 * reader read the same value twice.
 */

const TRACK_H = 8;

const styles = StyleSheet.create({
  track: {
    flex: 1,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: color.line,
    overflow: "hidden",
  },
  /** The productive range. Below the fill, so the fill reads as the measurement. */
  band: { position: "absolute", top: 0, bottom: 0, backgroundColor: color.accentSoft },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0 },
  /** The range's two edges, so the band is legible where the fill covers it. */
  tick: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: color.lineStrong },
});

const FILL: Record<RangeStatus, string> = {
  under: color.accent,
  in_range: color.good,
  over: color.warn,
};

export type RangeStatus = "under" | "in_range" | "over";

/** `0.35` → `"35%"`, clamped. React Native takes a percentage string verbatim. */
const pct = (n: number): `${number}%` => `${Math.max(0, Math.min(1, n)) * 100}%`;

export function RangeBar({ value, min, max, domainMax, status }: {
  /** The measurement. Fractional — a bench press is half a front-delt set. */
  value: number;
  /** The bottom of the productive range. `WEEKLY_SET_TARGET.min`. */
  min: number;
  /** The top of it. `WEEKLY_SET_TARGET.max`. */
  max: number;
  /**
   * The top of the x domain, computed by the caller across every row so the
   * column shares one scale. Never less than `max`, or the band runs off the
   * end of its own track.
   */
  domainMax: number;
  /** From `volumeStatus(value)`. Never derived here: one function owns that rule. */
  status: RangeStatus;
}) {
  // A zero domain would divide every position by nothing. It cannot happen with
  // a sane caller, and a card of invisible bars beats a crash if it does.
  const top = domainMax > 0 ? domainMax : 1;

  return (
    <View style={styles.track}>
      <View style={[styles.band, { left: pct(min / top), width: pct((max - min) / top) }]} />
      {/*
        No fill at zero. The empty track plus the band is the message — a 1pt
        sliver of accent would read as "nearly nothing" rather than "nothing",
        and those are different things on this card.
      */}
      {value > 0 && (
        <View style={[styles.fill, { width: pct(value / top), backgroundColor: FILL[status] }]} />
      )}
      <View style={[styles.tick, { left: pct(min / top) }]} />
      {/*
        The upper edge is positioned from the RIGHT. In the common case nothing
        exceeds the range, `domainMax === max`, and `left: "100%"` would put a
        1pt view flush past the track's last pixel — where `overflow: hidden`
        clips it away entirely and the band loses the edge that matters most.
      */}
      <View style={[styles.tick, { right: pct(1 - max / top) }]} />
    </View>
  );
}
