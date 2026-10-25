import { epley, isReliableForStrength } from "@/lib/shared/e1rm";
import type { ExerciseHistory, HistorySet } from "@/lib/types";

/**
 * The Exercise detail view model.
 *
 * Written at integration time: `app/exercise.tsx` pushes from the live session
 * (`HISTORY →` under each page's pills) and from nowhere else, and no feature
 * workstream owned it — so the route was still rendering a placeholder while
 * being the destination of a real tap. This is the port of
 * `src/app/exercise/[slug]/page.tsx`, minus its "Next time — the rule" card:
 * see `OMITTED` below.
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

export interface TrendPoint {
  date: string;
  /**
   * Epley is homogeneous in weight — `e1rm(w, r) = w · (1 + r/30)` — so
   * feeding it pounds yields pounds. That is why `epley` is reused here rather
   * than reimplemented, even though its parameter is named `weightKg`.
   */
  e1rmLb: number;
}

export interface SessionView {
  date: string;
  /** Short weekday/month/day, formatted from the ISO date, never from the clock. */
  label: string;
  /** Working sets only; warmups are not part of the history read. */
  sets: HistorySet[];
  volumeLb: number;
}

export interface ExerciseView {
  title: string;
  subtitle: string;
  trend: TrendPoint[];
  peakE1rmLb: number | null;
  /** Percent change from the oldest to the newest point, or null under two points. */
  changePct: number | null;
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

/** Tonnage. Weight × reps, so pounds in gives pound-volume out. */
function volumeOf(sets: HistorySet[]): number {
  return sets.reduce((sum, s) => sum + s.weightLb * s.reps, 0);
}

export function buildExerciseView(data: ExerciseHistory): ExerciseView {
  const sessions: SessionView[] = data.history.map((h) => {
    const working = h.sets.filter((s) => !s.isWarmup);
    return {
      date: h.date,
      label: formatDay(h.date),
      sets: working,
      volumeLb: Math.round(volumeOf(working)),
    };
  });

  /**
   * Oldest first. The route returns newest first (so the history list reads
   * the right way round) but a trend that runs right-to-left is a trend read
   * backwards, which is the one mistake that makes a chart actively lie.
   */
  const trend: TrendPoint[] = data.history
    .map((h) => {
      const strength = h.sets.filter((s) => !s.isWarmup && isReliableForStrength(s.reps));
      if (strength.length === 0) return null;
      return {
        date: h.date,
        e1rmLb: Math.max(...strength.map((s) => epley(s.weightLb, s.reps))),
      };
    })
    .filter((p): p is TrendPoint => p !== null)
    .reverse();

  const peak = trend.length > 0 ? Math.max(...trend.map((p) => p.e1rmLb)) : null;

  const first = trend[0];
  const last = trend[trend.length - 1];
  const changePct =
    trend.length > 1 && first !== undefined && last !== undefined && first.e1rmLb !== 0
      ? ((last.e1rmLb - first.e1rmLb) / first.e1rmLb) * 100
      : null;

  return {
    title: data.exercise.name,
    subtitle: `${data.exercise.equipment} · ${data.exercise.incrementLb} lb increment`,
    trend,
    peakE1rmLb: peak,
    changePct,
    sessions,
  };
}

/**
 * Bar height as a percentage of the tallest bar, floored at 8 so a genuinely
 * small value is still a visible mark rather than nothing at all. Ported from
 * the web page's inline `Math.max(8, …)`.
 */
export function barHeightPct(e1rmLb: number, peakLb: number | null): number {
  if (peakLb === null || peakLb <= 0) return 8;
  return Math.max(8, (e1rmLb / peakLb) * 100);
}
