import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";
import type { LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

import { Label, microLabel } from "./Label";
import { linePath, xFractions, yDomain } from "./scales";
import { color, space, tnum } from "./tokens";

/**
 * The three chart shapes this app draws, and the one place their rules live.
 *
 * Today needs five charts, the exercise screen wants an e1RM trend and the runs
 * screen wants weekly mileage — and three features hand-rolling SVG is three
 * different stroke widths, three different empty states and three different
 * ideas about what to do with a gap in the data. `react-native-svg` is already
 * a dependency and is bundled in Expo Go, so this needs no new package and no
 * config plugin.
 *
 * ── THE INVARIANTS, BAKED IN SO NO FEATURE CAN GET THEM WRONG ──────────────
 *
 *  - 2pt strokes. One series per panel. A second measure gets a second panel,
 *    never a second y-axis: weight in lb against kcal on one pair of axes is
 *    the single most common charting mistake and these cost 20pt to avoid.
 *  - NO gridlines, NO tick marks, NO axis lines, ever. A reference line is
 *    allowed because it encodes a number the reader is comparing against
 *    (maintenance calories, the 8-week median); an axis is decoration.
 *  - NO interpolation across a gap. `values` is dense by contract, and
 *    `mode="dots"` exists precisely so that a series of irregular observations
 *    can be drawn as marks without a line implying the days between them.
 *  - NO hover, NO tooltip, NO tap-to-inspect. There is no pointer on this
 *    device, and a 32pt sparkline is a worse place to read an exact number than
 *    the detail screen one tap away. That is why every chart here carries
 *    direct end labels instead — `Chart`'s `left` and `right`.
 *  - Colours from `tokens.ts` only. `accent` is the series, `lineStrong` is a
 *    reference line or a raw observation, `muted` is a secondary panel. Status
 *    colours (`good`/`warn`/`bad`) never appear here: a line is not a state.
 */

const STROKE = 2;
const BAR_GAP = 4;
const BAR_RADIUS = 2;
const DOT_R = 2.5;
const LAST_DOT_R = 3.5;
const END_DOT_R = 3;

/**
 * Vertical and horizontal breathing room inside the measured box.
 *
 * Without it a value sitting on the domain edge has half its 2pt stroke clipped
 * and the terminal dot loses its right half, which reads as a rendering bug
 * rather than as a data point at the limit.
 */
const PAD = LAST_DOT_R + STROKE / 2;

const styles = StyleSheet.create({
  block: { marginBottom: space.md },
  empty: { color: color.muted, fontSize: 13, lineHeight: 19 },
  ends: {
    height: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.xs,
  },
  end: { ...microLabel, ...tnum },
});

const strokeFor = (tone: "accent" | "muted"): string =>
  tone === "muted" ? color.muted : color.accent;

/**
 * The frame: a micro-label, a measured plot area, and direct end labels.
 *
 * `children` is a render prop rather than an element because it is not called
 * until the width has actually been measured. Nothing in this app hard-codes a
 * chart width or reads `Dimensions`: a chart sized from the window is wrong
 * inside a `Card`, and wrong by a different amount on every phone.
 *
 * The label is the chart's title AND names the series, which is what lets every
 * chart here ship without a legend.
 */
export function Chart({ label, height, empty, left, right, children }: {
  /**
   * Omitted only where the chart is already titled by the row it sits in — the
   * strength sparklines, whose exercise name is on the line above. Everywhere
   * else it is required reading, because it is what replaces a legend.
   */
  label?: string;
  height: number;
  /**
   * Rendered instead of the plot. Nothing in this app draws an empty axis
   * frame — a chart with no data says so in words.
   */
  empty?: string;
  left?: string;
  right?: string;
  children: (width: number, height: number) => ReactNode;
}) {
  const [width, setWidth] = useState(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const measured = Math.floor(e.nativeEvent.layout.width);
    // Guarded because `onLayout` fires on every re-layout with the same number,
    // and an unconditional `setWidth` would re-render the whole card each time.
    setWidth((previous) => (previous === measured ? previous : measured));
  }, []);

  const title = label !== undefined && label !== "" ? <Label>{label}</Label> : null;

  if (empty !== undefined) {
    return (
      <View style={styles.block}>
        {title}
        <Text style={styles.empty}>{empty}</Text>
      </View>
    );
  }

  return (
    <View style={styles.block}>
      {title}
      <View style={{ height }} onLayout={onLayout}>
        {width > 0 ? children(width, height) : null}
      </View>
      {(left !== undefined || right !== undefined) && (
        <View style={styles.ends}>
          <Text style={styles.end}>{left ?? ""}</Text>
          <Text style={styles.end}>{right ?? ""}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * One series, as a line or as bare marks.
 *
 * `values` must be dense — nulls are the caller's problem, because only the
 * caller knows whether a missing day should close the gap, split the series or
 * be dropped. Guessing here is how a chart comes to interpolate across a
 * fortnight of not weighing in.
 *
 * `xs` / `domainX` are what let a date series be drawn on a calendar axis
 * rather than at even index spacing. Two weigh-ins eight days apart are not
 * two adjacent samples, and index spacing would draw them as though they were.
 * Omit both and the points are spread evenly, which is correct for a sparkline
 * of consecutive sessions.
 *
 * `mode="dots"` draws the observations and no connecting line. It exists for
 * the bodyweight panel, where the fitted regression is the only continuous mark
 * on the chart — because the fit is a model and a line through the raw readings
 * would be a second, worse one.
 */
export function Sparkline({
  values,
  width,
  height,
  tone = "accent",
  reference = null,
  dots = false,
  domain,
  xs,
  domainX,
  mode = "line",
  endDot = true,
}: {
  values: number[];
  width: number;
  height: number;
  tone?: "accent" | "muted";
  /** A 1pt dashed `lineStrong` horizontal at this value, in the series' units. */
  reference?: number | null;
  /** Raw observations as `r=2.5` `lineStrong` circles; the last is `r=3.5`. */
  dots?: boolean;
  /** Fixed y domain. Omitted = the series' own min/max padded 4%. */
  domain?: [number, number];
  /** x positions in data units, one per value. Omitted = even index spacing. */
  xs?: number[];
  /** Fixed x domain, in the same units as `xs`. */
  domainX?: [number, number];
  mode?: "line" | "dots";
  /** Mark where the series ends with an `r=3` dot in `tone`. Line mode only. */
  endDot?: boolean;
}) {
  if (values.length === 0 || width <= 0 || height <= 0) return null;

  const stroke = strokeFor(tone);
  const [y0, y1] = domain
    ? (domain[1] > domain[0] ? domain : [domain[0] - 1, domain[1] + 1] as [number, number])
    : yDomain(values, reference);
  const inner = Math.max(1, height - PAD * 2);
  const span = Math.max(1, width - PAD * 2);

  const yAt = (v: number): number => PAD + (1 - (v - y0) / (y1 - y0)) * inner;

  const positions = xFractions(values.length, xs, domainX);
  const xAt = (i: number): number => PAD + positions[i] * span;

  const points = values.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
  const last = points[points.length - 1];

  return (
    <Svg width={width} height={height}>
      {reference !== null && reference >= y0 && reference <= y1 && (
        <Line
          x1={0}
          x2={width}
          y1={yAt(reference)}
          y2={yAt(reference)}
          stroke={color.lineStrong}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}

      {mode === "line" && points.length > 1 && (
        <Path
          d={linePath(points)}
          stroke={stroke}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}

      {(mode === "dots" || dots) && points.map((p, i) => (
        <Circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={i === points.length - 1 ? LAST_DOT_R : DOT_R}
          fill={color.lineStrong}
        />
      ))}

      {/*
        The terminal dot. On a one-point series it is the entire mark, which is
        the honest rendering: a two-point line drawn from one session would be a
        fabrication, and the feature says so in words beside it.
      */}
      {mode === "line" && (endDot || points.length === 1) && !dots && (
        <Circle cx={last.x} cy={last.y} r={END_DOT_R} fill={stroke} />
      )}
    </Svg>
  );
}

/**
 * Weekly buckets, anchored to a baseline.
 *
 * Bars rather than a line because the buckets are discrete and comparable: a
 * line between week 3 and week 4 would imply a Thursday in between, and there
 * isn't one.
 *
 * `partialIndex` is not cosmetic. Comparing a Tuesday against seven complete
 * weeks is the easiest false signal on a dashboard, so the incomplete bucket is
 * drawn at 70% and the caller labels it.
 */
export function BarSeries({
  values,
  width,
  height,
  tone = "accent",
  reference = null,
  partialIndex = null,
}: {
  values: number[];
  width: number;
  height: number;
  tone?: "accent" | "muted";
  /** A 1pt dashed `lineStrong` horizontal — the 8-week median, usually. */
  reference?: number | null;
  /** Index drawn at 70% opacity: an incomplete bucket must not read as a complete one. */
  partialIndex?: number | null;
}) {
  const n = values.length;
  if (n === 0 || width <= 0 || height <= 0) return null;

  const fill = strokeFor(tone);
  const barW = Math.max(1, (width - BAR_GAP * (n - 1)) / n);
  const ceiling = Math.max(...values, reference ?? 0);
  const inner = Math.max(1, height - STROKE);

  const scale = (v: number): number => (ceiling <= 0 ? 0 : (v / ceiling) * inner);

  return (
    <Svg width={width} height={height}>
      {values.map((v, i) => {
        // A zero bucket draws a 2pt baseline tick rather than nothing, so a
        // missed week reads as *zero* instead of as missing data. The whole
        // point of the panel is that a skipped week is visible.
        const h = Math.max(STROKE, scale(v));
        return (
          <Rect
            key={i}
            x={i * (barW + BAR_GAP)}
            y={height - h}
            width={barW}
            height={h}
            rx={BAR_RADIUS}
            fill={fill}
            opacity={i === partialIndex ? 0.7 : 1}
          />
        );
      })}

      {reference !== null && ceiling > 0 && (
        <Line
          x1={0}
          x2={width}
          y1={height - scale(reference)}
          y2={height - scale(reference)}
          stroke={color.lineStrong}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}
    </Svg>
  );
}
