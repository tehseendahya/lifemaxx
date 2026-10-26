import { epley, isReliableForStrength } from "@/lib/shared/e1rm";
import { isE1rmLift } from "@/lib/shared/big-lifts";
import type { ExerciseHistory, HistorySet } from "@/lib/types";

import { fmtWeight } from "../lift/logic";
import type { GoalClaim } from "../today/goals";

/**
 * The Exercise detail view model.
 *
 * Written at integration time as a port of `src/app/exercise/[slug]/page.tsx`,
 * then reshaped around one decision: THE RIGHT METRIC FOR THE LIFT. An e1RM is
 * drawn only for the barbell main lifts (`isE1rmLift`). Every other lift shows
 * the top set it actually did, and a lift done at zero load shows its best rep
 * count — because an Epley figure for a preacher curl is a number nobody will
 * ever lift and nobody is chasing.
 *
 * Pure, so it is unit-testable without a renderer. No `react-native` import.
 */

/**
 * OMITTED: the web page's `computeBaseline()` card.
 *
 * `computeBaseline` takes kilograms, and `GET /api/mobile/exercise` returns
 * `weightLb` already rounded to 0.1 by `displayLb`. Converting back with
 * `lbToKg` would feed the progression rule a value that is not the one in the
 * database, so the phone could recommend 182.5 where the laptop recommends 180
 * — two clients disagreeing about the same rule, which is worse than the phone
 * not showing it. The live session already surfaces the same number through
 * `/api/mobile/session`'s `suggestion`, computed server-side from kilograms,
 * so nothing is lost. If this card is wanted here, the fix is server-side:
 * have the route return the baseline it can compute correctly.
 */

/**
 * What a session is worth on this lift.
 *
 *  - `e1rm`: Epley over the reliable working sets. Barbell main lifts only.
 *  - `topSet`: the heaviest working set, reps as the tie-break.
 *  - `reps`: the most reps in one working set, for lifts done at zero load.
 */
export type Metric = "e1rm" | "topSet" | "reps";

type Session = ExerciseHistory["history"][number];

export interface TopSet {
  weightLb: number;
  reps: number;
}

export interface ProgressPoint {
  date: string;
  /** e1RM lb, top-set weight lb, or reps — whatever the metric measures. */
  value: number;
  /** The set behind the value, so the newest point can be printed as a figure. */
  top: TopSet;
}

export interface SessionView {
  /** Opens that workout. Absent from a server that predates the field. */
  workoutId: string | null;
  date: string;
  /** Short weekday/month/day, formatted from the ISO date, never from the clock. */
  label: string;
  /** Every set in order, warmups included — the screen dims them with a "W". */
  sets: HistorySet[];
  /** Working sets only. A warmup is not training volume. */
  workingSets: number;
  volumeLb: number;
  /** "4 sets · 3,700 lb", or "Warmups only". */
  summary: string;
  /** This session's metric beat every earlier session in the window. */
  pr: boolean;
}

/**
 * The progress card. Never an empty frame: zero sessions draws nothing (the
 * history says so), one usable point is a sentence, and only two or more draw
 * a chart.
 */
export type ProgressView =
  | { kind: "none" }
  | { kind: "single"; label: string; line: string }
  | {
      kind: "chart";
      label: string;
      /** "231 lb" · "50 × 10" · "12 reps". */
      best: string;
      /** First point to last, signed, or null when it did not move. */
      change: { text: string; up: boolean } | null;
      /** "over 6 sessions" for e1RM, "since Sep 3" otherwise. */
      span: string;
      values: number[];
      left: string;
      right: string;
      /** "Last top set 185 × 5". The chart's end label in words. */
      last: string;
      /** A dashed line at the owner's goal. e1RM lifts with a lift goal only. */
      reference: number | null;
      accessibilityLabel: string;
    };

export interface ExerciseView {
  title: string;
  subtitle: string;
  /**
   * The carry-forward cue pinned to this lift, or null.
   *
   * Read from THIS response rather than from `bootstrap.cues`: a screen that
   * can show a value has to read it from the request that rendered it, or it
   * shows whichever of two caches answered last.
   */
  cue: string | null;
  metric: Metric;
  progress: ProgressView;
  sessions: SessionView[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * `YYYY-MM-DD` → `Sat, Oct 25`.
 *
 * Built from the parts rather than `toLocaleDateString`, for the same reason
 * the Today header does it: the device clock and locale disagree with the
 * user's profile timezone on a travelling phone, and Hermes' ICU build decides
 * what a locale string even looks like.
 */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  // Noon UTC, so a timezone offset either way cannot roll the weekday over.
  const weekday = DAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
  return `${weekday}, ${MONTHS[m - 1]} ${d}`;
}

/** `YYYY-MM-DD` → `Oct 25`. The short form for end labels and sentences. */
export function formatShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}`;
}

const working = (sets: HistorySet[]): HistorySet[] => sets.filter((s) => !s.isWarmup);

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * `3700` → `3,700`. By hand rather than `toLocaleString`, whose output depends
 * on which ICU build Hermes shipped with — the same reason dates are built
 * from parts.
 */
export function groupThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Tonnage. Weight × reps, so pounds in gives pound-volume out. */
function volumeOf(sets: HistorySet[]): number {
  return sets.reduce((sum, s) => sum + s.weightLb * s.reps, 0);
}

/**
 * The heaviest working set; on equal weight, the one with more reps.
 *
 * Reps break the tie because 185 × 8 after 185 × 5 is progress at the same
 * load, and picking whichever came first would hide it. Null with no working
 * sets — a warmups-only session has no top set.
 */
export function topSetOf(sets: HistorySet[]): TopSet | null {
  let top: TopSet | null = null;
  for (const s of working(sets)) {
    if (top === null || s.weightLb > top.weightLb || (s.weightLb === top.weightLb && s.reps > top.reps)) {
      top = { weightLb: s.weightLb, reps: s.reps };
    }
  }
  return top;
}

/**
 * Which metric this lift is measured by.
 *
 * The list decides e1RM, never the data: a barbell bench logged once at 20
 * reps is still a bench. Otherwise, a lift whose every working set is at 0 lb
 * (push-ups, unweighted pull-ups) is measured in reps, because a "top set" of
 * 0 × 12 plotted as weight is a flat line at zero. One weighted session flips
 * it back to top set — the weight is then the thing that moved.
 */
export function metricFor(exercise: { slug: string }, sessions: Session[]): Metric {
  if (isE1rmLift(exercise.slug)) return "e1rm";
  const all = sessions.flatMap((s) => working(s.sets));
  if (all.length > 0 && all.every((s) => s.weightLb === 0)) return "reps";
  return "topSet";
}

/** A session's value under a metric, or null when that session has none. */
function pointFor(metric: Metric, session: Session): ProgressPoint | null {
  const top = topSetOf(session.sets);
  if (top === null) return null;

  if (metric === "e1rm") {
    /*
     * Epley is homogeneous in weight — `e1rm(w, r) = w · (1 + r/30)` — so
     * feeding it pounds yields pounds. That is why `epley` is reused rather
     * than reimplemented, even though its parameter is named `weightKg`.
     */
    const strength = working(session.sets).filter((s) => isReliableForStrength(s.reps));
    if (strength.length === 0) return null;
    return {
      date: session.date,
      value: Math.max(...strength.map((s) => epley(s.weightLb, s.reps))),
      top,
    };
  }

  if (metric === "reps") {
    const reps = Math.max(...working(session.sets).map((s) => s.reps));
    return { date: session.date, value: reps, top: { weightLb: 0, reps } };
  }

  return { date: session.date, value: top.weightLb, top };
}

/**
 * One point per session that has one, OLDEST FIRST.
 *
 * The route returns newest first (so the history list reads the right way
 * round) but a trend that runs right-to-left is a trend read backwards, which
 * is the one mistake that makes a chart actively lie.
 */
export function progressSeries(metric: Metric, sessions: Session[]): ProgressPoint[] {
  return sessions
    .map((s) => pointFor(metric, s))
    .filter((p): p is ProgressPoint => p !== null)
    .reverse();
}

/** `a` is strictly better than `b`. A top set compares weight, then reps. */
function beats(metric: Metric, a: ProgressPoint, b: ProgressPoint): boolean {
  if (metric === "topSet") {
    return a.top.weightLb > b.top.weightLb
      || (a.top.weightLb === b.top.weightLb && a.top.reps > b.top.reps);
  }
  return a.value > b.value;
}

/**
 * Which sessions were a PR, as indices into `sessions` (newest first, as sent).
 *
 * A PR beats EVERY earlier session in the window, strictly — matching the best
 * is not a record. The oldest session is never one: with nothing before it,
 * "beat everything earlier" is vacuously true, and a PR chip on the first
 * session ever logged says nothing.
 */
export function prSessions(metric: Metric, sessions: Session[]): Set<number> {
  const prs = new Set<number>();
  let best: ProgressPoint | null = null;

  for (let i = sessions.length - 1; i >= 0; i -= 1) {
    const point = pointFor(metric, sessions[i]);
    if (point === null) continue;
    if (best !== null && beats(metric, point, best)) prs.add(i);
    if (best === null || beats(metric, point, best)) best = point;
  }
  return prs;
}

const setText = (metric: Metric, top: TopSet): string =>
  metric === "reps" ? `${top.reps} reps` : `${fmtWeight(top.weightLb)} × ${top.reps}`;

/** The one-session state: a figure and a sentence, never a one-dot chart. */
export function firstSessionLine(metric: Metric, point: ProgressPoint): string {
  return `First logged ${formatShort(point.date)}: ${setText(metric, point.top)}. `
    + "Your trend starts with the next session.";
}

const LABELS: Record<Metric, string> = {
  e1rm: "Estimated 1RM",
  topSet: "Top set",
  reps: "Best set",
};

/**
 * The goal line for this lift, in lb, or null.
 *
 * Only a weight target (`kind: "lift"`) — a rep target is not on the same axis.
 * When the owner wrote two ("205 by December, 225 by May") the nearest deadline
 * wins, the same rule as the Lift tab's goal chip, so the two screens draw the
 * same number. An undated target ranks after every dated one.
 */
export function goalTargetLb(exerciseId: string, claims: GoalClaim[]): number | null {
  let held: { targetLb: number; byDate: string | null } | null = null;
  for (const c of claims) {
    if (c.kind !== "lift" || c.exerciseId !== exerciseId) continue;
    if (held === null || sooner(c.byDate, held.byDate)) held = c;
  }
  return held?.targetLb ?? null;
}

const sooner = (a: string | null, b: string | null): boolean =>
  a !== null && (b === null || a < b);

function progressView(
  metric: Metric,
  points: ProgressPoint[],
  goalLb: number | null,
): ProgressView {
  const label = LABELS[metric];
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return { kind: "none" };
  if (points.length === 1) return { kind: "single", label, line: firstSessionLine(metric, first) };

  // The best point, by the same comparison the PR chip uses, so the headline
  // and the chips can never name different sessions as the best.
  const peak = points.reduce((a, b) => (beats(metric, b, a) ? b : a));

  const delta = metric === "e1rm" ? Math.round(last.value - first.value) : last.value - first.value;
  const unit = metric === "reps" ? " reps" : " lb";
  const change = delta === 0
    ? null
    : { text: `${delta > 0 ? "+" : "−"}${fmtWeight(Math.abs(delta))}${unit}`, up: delta > 0 };

  const best = metric === "e1rm"
    ? `${Math.round(peak.value)} lb`
    : setText(metric, peak.top);

  return {
    kind: "chart",
    label,
    best,
    change,
    span: metric === "e1rm" ? `over ${points.length} sessions` : `since ${formatShort(first.date)}`,
    values: points.map((p) => p.value),
    left: formatShort(first.date),
    right: formatShort(last.date),
    last: `Last ${metric === "reps" ? "best set" : "top set"} ${setText(metric, last.top)}`,
    // A goal is a weight, so it is drawn only on a weight axis — and of the
    // two weight metrics, only against e1RM, which is what the goal measures.
    reference: metric === "e1rm" ? goalLb : null,
    accessibilityLabel: `${label} per session, oldest to newest, ${formatShort(first.date)} to ${formatShort(last.date)}`,
  };
}

export function buildExerciseView(
  data: ExerciseHistory,
  claims: GoalClaim[] = [],
): ExerciseView {
  const metric = metricFor(data.exercise, data.history);
  const prs = prSessions(metric, data.history);

  const sessions: SessionView[] = data.history.map((h, i) => {
    const work = working(h.sets);
    const volumeLb = Math.round(volumeOf(work));
    return {
      workoutId: h.workoutId ?? null,
      date: h.date,
      label: formatDay(h.date),
      sets: h.sets,
      workingSets: work.length,
      volumeLb,
      summary: work.length === 0
        ? "Warmups only"
        : volumeLb === 0
          // Bodyweight: tonnage is 0 and saying "0 lb" reads as nothing done.
          ? plural(work.length, "set")
          : `${plural(work.length, "set")} · ${groupThousands(volumeLb)} lb`,
      pr: prs.has(i),
    };
  });

  return {
    title: data.exercise.name,
    subtitle: `${data.exercise.equipment} · ${fmtWeight(data.exercise.incrementLb)} lb steps`,
    /*
     * `?? null` because the field is optional on the type: a server that
     * predates the cue backend sends no `cue` at all, and that has to render as
     * "no cue" rather than as `undefined` reaching a `<Text>`. An empty string
     * is folded in too — the server never stores one (absence is its only
     * representation of "no cue"), so if one ever arrives it means the same
     * thing and must not draw an empty block.
     */
    cue: data.cue === undefined || data.cue === null || data.cue === "" ? null : data.cue,
    metric,
    progress: progressView(
      metric,
      progressSeries(metric, data.history),
      goalTargetLb(data.exercise.id, claims),
    ),
    sessions,
  };
}
