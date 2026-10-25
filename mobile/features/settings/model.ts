/*
 * Imports are relative rather than `@/lib/...` so this module runs under
 * `mobile/vitest.config.ts`, which is a plain node environment with no path
 * alias configured — the same convention the Today, Runs and Food models
 * follow. Nothing here imports `react-native`, which is what makes it testable
 * at all.
 */
import { kgToLb } from "../../lib/shared/units";
import { KCAL_PER_KG_BODY_MASS, proposeTargets, proteinTargetG } from "../../lib/shared/tdee";
import type { Bootstrap } from "../../lib/types";

/**
 * `bootstrap` → the three figures on the You screen that are not simply echoed
 * from the payload, as plain data.
 *
 * Split out from the component because this is the part with rules in it: when
 * a maintenance number may be shown at all, what the proposal chips say, and
 * what a number pad string is allowed to become. None of that is observable in
 * this container — there is no simulator — so it is asserted here instead.
 *
 * Nothing below recomputes TDEE or a target. `proposeTargets` and
 * `proteinTargetG` are the same functions the web app's calibration page calls;
 * a second implementation is how the two clients start disagreeing about a
 * number the user can read on both.
 */

// --------------------------------------------------------------- maintenance

export type ProposalKey = "cut" | "maintain" | "bulk";

export interface ProposalChip {
  key: ProposalKey;
  /** "CUT", "MAINTAIN", "LEAN BULK" */
  label: string;
  kcal: number;
  /** "2,150 kcal · −0.9 lb/wk" — what picking it actually commits to. */
  detail: string;
}

export interface TargetProposal {
  chips: ProposalChip[];
  proteinG: number;
  /** Why this is appearing now, and why picking one here does not save it. */
  note: string;
}

export type MaintenanceView =
  | { status: "insufficient"; note: string }
  | {
      status: "ok";
      /** The kcal figure, as a string so the component never formats a number. */
      tdee: string;
      /** "±11 kcal · from 13 weigh-ins" */
      hint: string;
      /** "−0.36 lb/wk", always signed. */
      trend: string;
      /** Present only at the end of calibration: measured TDEE, no target set yet. */
      proposal: TargetProposal | null;
    };

/**
 * Maintenance, or an admission that it is not measurable yet.
 *
 * Below the weigh-in floor there is deliberately no number at all — not a
 * greyed-out one, not an estimate from height and weight. An adaptive TDEE is
 * only worth anything because it came from this person's own data, and a figure
 * invented before there is enough of that will be believed and then quietly
 * contradicted a fortnight later.
 *
 * The strings here match `features/today/model.ts` exactly where they overlap.
 * The same maintenance number appears on both screens, and two different
 * roundings of one figure is the kind of thing a user notices immediately and
 * can never unsee.
 */
export function buildMaintenance(b: Bootstrap): MaintenanceView {
  if (b.tdee.status !== "ok") {
    return {
      status: "insufficient",
      note:
        `Not enough weigh-ins for a reliable number — ${b.tdee.weighIns} of ${b.tdee.needed}. `
        + "Weigh in most mornings and this fills itself in.",
    };
  }

  const lbPerWeek = kgToLb(b.tdee.trendKgPerWeek);

  return {
    status: "ok",
    tdee: `${b.tdee.tdee}`,
    hint: `±${b.tdee.marginKcal} kcal · from ${plural(b.tdee.weighIns, "weigh-in")}`,
    // Signed on purpose: "0.4 lb/wk" is ambiguous in the one direction that
    // matters, and the sign is the entire content of the figure.
    trend: `${lbPerWeek > 0 ? "+" : ""}${lbPerWeek.toFixed(1)} lb/wk`,
    proposal: b.target.kcal === null ? buildProposal(b.tdee.tdee, b.tdee.currentKg) : null,
  };
}

/**
 * The three options at the end of the three-week calibration.
 *
 * They appear exactly once: measured maintenance exists and no target has been
 * set against it. `proposeTargets` is deliberately conservative — roughly 0.5%
 * of bodyweight a week either way — so the deltas below are small, and that is
 * the point rather than a bug to tune.
 */
function buildProposal(tdee: number, currentKg: number): TargetProposal {
  const targets = proposeTargets(tdee, currentKg);

  const chips: ProposalChip[] = [
    { key: "cut", label: "CUT", kcal: targets.cut, detail: rateLine(targets.cut, tdee) },
    { key: "maintain", label: "MAINTAIN", kcal: targets.maintain, detail: rateLine(targets.maintain, tdee) },
    { key: "bulk", label: "LEAN BULK", kcal: targets.bulk, detail: rateLine(targets.bulk, tdee) },
  ];

  return {
    chips,
    proteinG: proteinTargetG(currentKg),
    // Honest about the dead end. There is no endpoint that writes a `targets`
    // row — the web app's calibration page writes it directly from a server
    // action — so tapping one of these can only show what it would mean.
    note: "Three weeks of weigh-ins is enough to set a real target. "
      + "Picking one here only shows what it would mean; set it on the laptop to save it.",
  };
}

/**
 * What a kcal target does to the scale, from the one number that is measured.
 *
 * `KCAL_PER_KG_BODY_MASS` is imported rather than written as 7700: it is the
 * constant the TDEE estimate itself divides by, and the rate shown here has to
 * be the inverse of that same arithmetic or the chip would promise a rate the
 * estimate would then contradict.
 *
 * No thousands separator, matching the maintenance figure on Today. It also
 * avoids depending on `toLocaleString` with a locale argument, which needs full
 * Intl and silently ignores the locale on a Hermes build without it.
 */
function rateLine(kcal: number, tdee: number): string {
  const lbPerWeek = kgToLb(((kcal - tdee) * 7) / KCAL_PER_KG_BODY_MASS);
  if (Math.abs(lbPerWeek) < 0.05) return `${kcal} kcal · hold`;
  return `${kcal} kcal · ${lbPerWeek > 0 ? "+" : ""}${lbPerWeek.toFixed(1)} lb/wk`;
}

// ------------------------------------------------------------------- weigh-in

export interface WeighInView {
  /** The big figure, or "—" when nothing is known. */
  figure: string;
  /** What that figure is, and from when. */
  hint: string;
}

/**
 * What to show above the LOG WEIGHT button.
 *
 * `bootstrap` carries no last weigh-in — the nearest thing in the payload is
 * `tdee.currentKg`, which is the regression's *fitted* weight at the most
 * recent weigh-in date rather than a reading, and it only exists once there are
 * eight of them. So this is labelled "trend weight" rather than "last weight",
 * because calling a fitted value a reading would be a lie the user could catch
 * by comparing it to their scale.
 *
 * `justLogged` is the weight entered on this phone a moment ago. It takes
 * precedence until the next `bootstrap` lands, because a weight that does not
 * appear after you type it reads as a save that did not happen — and the trend
 * genuinely will not move much from one reading.
 */
export function buildWeighIn(b: Bootstrap, justLogged: number | null): WeighInView {
  if (justLogged !== null) {
    return { figure: formatLb(justLogged), hint: "logged just now" };
  }

  if (b.tdee.status === "ok") {
    return {
      figure: formatLb(kgToLb(b.tdee.currentKg)),
      // Named as the fitted value it is. A single morning reading is noise; the
      // trend is the number the TDEE estimate is actually built on.
      hint: `trend weight · from ${plural(b.tdee.weighIns, "weigh-in")}`,
    };
  }

  if (b.tdee.weighIns === 0) {
    return { figure: "—", hint: "No weigh-in on record yet." };
  }

  return {
    figure: "—",
    // No figure below the floor, for the same reason there is no TDEE: the
    // trend is what this card reports, and there is not enough data for one.
    hint: `${plural(b.tdee.weighIns, "weigh-in")} so far · ${b.tdee.needed} needed for a trend`,
  };
}

/** One decimal, and none at all when it is a whole number. Matches `formatWeight` in the domain layer. */
function formatLb(lb: number): string {
  const rounded = Math.round(lb * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// ---------------------------------------------------------------- pad entry

/**
 * The widest range a human bodyweight can be, in lb.
 *
 * `NumberPad` is pure and never validates — it emits the raw digit string and
 * the caller converts — so this is where a fat-fingered "1855" is caught. The
 * bounds are deliberately generous: the job is to catch a missing or doubled
 * keypress, not to have an opinion about anybody's body. A wrong weight does
 * real damage here, because every weigh-in feeds the regression behind the TDEE
 * estimate and one outlier skews the trend for a fortnight.
 */
export const MIN_WEIGHT_LB = 50;
export const MAX_WEIGHT_LB = 700;

/**
 * `weightLb` only — there is deliberately no kg field here.
 *
 * `POST /api/weight` takes lb and converts at the server edge, which is the
 * same single-conversion rule the whole `/api/mobile/*` surface follows. A kg
 * value on the client would be a second place the conversion happens, and
 * converting twice is how a 0.3 lb drift appears in a trend nobody can explain.
 */
export type WeightEntry =
  | { ok: true; weightLb: number }
  | { ok: false; reason: string | null };

/**
 * A number pad string → a weight worth sending, or why not.
 *
 * `reason` is null for an untouched pad, because "" is not an error the user
 * made — it is the state the pad opens in, and the DONE button is simply inert
 * until something is typed.
 */
export function weightFromPad(raw: string): WeightEntry {
  if (raw.trim() === "") return { ok: false, reason: null };

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, reason: "That is not a weight." };
  }
  if (value < MIN_WEIGHT_LB || value > MAX_WEIGHT_LB) {
    return {
      ok: false,
      reason: `Enter a weight between ${MIN_WEIGHT_LB} and ${MAX_WEIGHT_LB} lb.`,
    };
  }

  // Rounded to a tenth before it goes anywhere: the server stores kg, and
  // sending 182.40000000000003 would put that noise in the regression.
  const weightLb = Math.round(value * 10) / 10;
  return { ok: true, weightLb };
}

// -------------------------------------------------------------- reachability

export type Reachability = "unknown" | "checking" | "connected" | "unreachable";

export interface ReachabilityView {
  text: string;
  tone: "good" | "bad" | "muted";
}

export function describeReachability(state: Reachability, baseUrl: string): ReachabilityView {
  if (baseUrl === "") return { text: "NO URL SET", tone: "bad" };

  switch (state) {
    case "connected":
      return { text: "CONNECTED", tone: "good" };
    case "unreachable":
      return { text: "UNREACHABLE", tone: "bad" };
    case "checking":
      return { text: "CHECKING", tone: "muted" };
    default:
      return { text: "NOT CHECKED", tone: "muted" };
  }
}

// -------------------------------------------------------------------- shared

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
