/*
 * Imports are relative rather than `@/lib/...` so this module runs under
 * `mobile/vitest.config.ts`, which is a plain node environment with no path
 * alias configured — the same convention the Today, Runs and Food models
 * follow. Nothing here imports `react-native`, which is what makes it testable
 * at all.
 */
import { kgToLb, lbToKg } from "../../lib/shared/units";
import {
  KCAL_PER_KG_BODY_MASS, proposeTargets, proteinTargetG, weightTrend,
} from "../../lib/shared/tdee";
import type { Bootstrap } from "../../lib/types";
import type { WeightUnit } from "../../components/ui/weight-entry";
import { TRAJECTORY_DAYS, formatShortDate, shiftIso, withinDays } from "../today/model";

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
  /**
   * The target in force, when it is one of the three. Null while calibrating
   * (no kcal target yet) — the chips then read as a first choice, not a change.
   */
  current: ProposalKey | null;
  /** What saving does, in one line. */
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
      /**
       * The three targets, whenever maintenance is measured. It used to appear
       * only until a target existed, because it could not save — it was a
       * preview with "set it on the laptop" under it. Now that the chips save
       * (`POST /api/mobile/target`) they stay, with the one in force marked.
       */
      proposal: TargetProposal;
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
    proposal: buildProposal(b.tdee.tdee, b.tdee.currentKg, currentMode(b)),
  };
}

/** Which chip is in force, read from the active target's mode. */
function currentMode(b: Bootstrap): ProposalKey | null {
  if (b.target.kcal === null) return null;
  const mode = b.target.mode;
  return mode === "cut" || mode === "maintain" || mode === "bulk" ? mode : null;
}

/**
 * The three options, from measured maintenance.
 *
 * `proposeTargets` is deliberately conservative — roughly 0.5% of bodyweight a
 * week either way — so the deltas below are small, and that is the point
 * rather than a bug to tune.
 *
 * The kcal on each chip is for reading only. What saves is the MODE: the server
 * recomputes the number from its own TDEE when the POST lands, so a chip that
 * was rendered from a bootstrap an hour old cannot write an hour-old target.
 */
function buildProposal(tdee: number, currentKg: number, current: ProposalKey | null): TargetProposal {
  const targets = proposeTargets(tdee, currentKg);

  const chips: ProposalChip[] = [
    { key: "cut", label: "CUT", kcal: targets.cut, detail: rateLine(targets.cut, tdee) },
    { key: "maintain", label: "MAINTAIN", kcal: targets.maintain, detail: rateLine(targets.maintain, tdee) },
    { key: "bulk", label: "LEAN BULK", kcal: targets.bulk, detail: rateLine(targets.bulk, tdee) },
  ];

  return {
    chips,
    proteinG: proteinTargetG(currentKg),
    current,
    note: current === null
      ? "Maintenance is measured. Pick one and save it — Food switches from calibrating "
        + "to that number."
      : "Saving another replaces it from today. Earlier days keep the target they had.",
  };
}

/**
 * What the save button says for a picked chip, or null when there is nothing
 * to save — no pick, or a pick of the target already in force.
 */
export function targetSaveLabel(p: TargetProposal, picked: ProposalKey | null): string | null {
  if (picked === null || picked === p.current) return null;
  const chip = p.chips.find((c) => c.key === picked);
  return chip === undefined ? null : `SET ${chip.label} · ${chip.kcal} KCAL`;
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
 * In order of preference, and labelled as what it is:
 *
 *  1. A weight typed on this phone a moment ago, until the next `bootstrap`
 *     lands — a weight that does not appear after you type it reads as a save
 *     that did not happen, and the trend will not move much from one reading.
 *  2. The server's fitted trend weight, once TDEE is measured.
 *  3. Before that, the same `weightTrend` fit run on the phone over the last
 *     28 days, from two weigh-ins — the number Today's Body card prints.
 *  4. One weigh-in: that reading, named as a reading with its date.
 *  5. None: a dash and the one instruction that fixes it.
 *
 * "Trend weight" is only ever said of a fitted value. Calling a fitted value a
 * reading — or a reading a trend — is a lie the user can catch by comparing it
 * to their scale.
 */
export function buildWeighIn(b: Bootstrap, justLogged: number | null): WeighInView {
  if (justLogged !== null) {
    return { figure: formatLb(justLogged), hint: "logged just now" };
  }

  if (b.tdee.status === "ok") {
    return {
      figure: formatLb(kgToLb(b.tdee.currentKg)),
      hint: `trend weight · from ${plural(b.tdee.weighIns, "weigh-in")}`,
    };
  }

  const recent = withinDays(b.history.days, b.today, TRAJECTORY_DAYS)
    .filter((d) => d.weightLb !== null);
  // Fed pounds, which is sound: OLS is scale-equivariant, so the fitted value
  // comes back in the unit that went in.
  const fit = weightTrend(recent.map((d) => ({ localDate: d.date, weightKg: d.weightLb as number })));
  if (fit !== null) {
    return {
      figure: formatLb(fit.currentKg),
      hint: `trend weight · from ${plural(recent.length, "weigh-in")}`,
    };
  }

  const all = b.history.days.filter((d) => d.weightLb !== null);
  if (all.length > 0) {
    const last = all[all.length - 1];
    return {
      figure: formatLb(last.weightLb as number),
      hint: `last weigh-in · ${last.date === b.today ? "today" : formatShortDate(last.date)}`,
    };
  }

  return { figure: "—", hint: "No weigh-in yet. Weigh in tomorrow morning, before food." };
}

/** The strip's length: two weeks is long enough to see a habit forming. */
export const STRIP_DAYS = 14;

export interface StripDay {
  date: string;
  /** A weigh-in that day. */
  on: boolean;
  /** Outlined, so a not-yet-weighed today reads as "still open", not missed. */
  today: boolean;
}

/**
 * Fourteen days of "did I weigh in", oldest first, ending today.
 *
 * The calibration habit, made visible. Maintenance needs eight weigh-ins in a
 * window, and a row of dots that fills is the one thing on You that improves
 * every single morning — including the first fortnight, when there is no
 * number to show yet.
 */
export function weighInStrip(b: Bootstrap): StripDay[] {
  const weighed = new Set(b.history.days.filter((d) => d.weightLb !== null).map((d) => d.date));
  return Array.from({ length: STRIP_DAYS }, (_, i) => {
    const date = shiftIso(b.today, i - (STRIP_DAYS - 1));
    return { date, on: weighed.has(date), today: date === b.today };
  });
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

/**
 * A number pad string in either unit → a weight worth sending, or why not.
 *
 * `lb` is exactly `weightFromPad`. `kg` relabels rather than converts what was
 * typed (see `weight-entry.ts`): "82.5" with kg selected is 82.5 kg. The range
 * check is done in kg with kg in the message, because telling someone who
 * typed kilograms to "enter a weight between 50 and 700 lb" makes them do the
 * conversion the toggle exists to spare them.
 *
 * The kg path is NOT rounded to a tenth of a pound. The server converts the lb
 * straight back with `lbToKg`, so full precision round-trips exactly — 82.5 kg
 * is stored as 82.5 kg, not as 82.51.
 */
export function weightFromPadIn(raw: string, unit: WeightUnit): WeightEntry {
  if (unit === "lb") return weightFromPad(raw);
  if (raw.trim() === "") return { ok: false, reason: null };

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, reason: "That is not a weight." };
  }

  const minKg = Math.ceil(lbToKg(MIN_WEIGHT_LB));
  const maxKg = Math.floor(lbToKg(MAX_WEIGHT_LB));
  if (value < minKg || value > maxKg) {
    return { ok: false, reason: `Enter a weight between ${minKg} and ${maxKg} kg.` };
  }

  return { ok: true, weightLb: kgToLb(value) };
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
