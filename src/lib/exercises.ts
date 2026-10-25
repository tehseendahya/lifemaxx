import { db } from "@/db";
import { exercises, exerciseAliases, exerciseMuscles, type Muscle } from "@/db/schema";
import { lbToKg } from "@/lib/domain/units";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

/**
 * Exercise resolution, and creating the ones that do not exist yet.
 *
 * This is the part that quietly breaks these apps: "bench", "bp", "barbell
 * bench press" and "flat bench" must all land on one row, or the trend charts
 * fragment into confetti and every progression calculation is wrong.
 *
 * Three tiers, cheapest first — the model is a last resort, not a first step.
 *
 * ── THE THIRD OUTCOME ──────────────────────────────────────────────────────
 *
 * Resolution used to answer a yes/no question: is this a row I already have?
 * "No" was a dead end — the owner typed "preacher curls", got an unmatched
 * chip, opened the picker, searched, found nothing, and had nowhere to go.
 * There was no path to creating an exercise anywhere in the app, even though
 * `exercises.user_id` has been nullable for exactly this since the schema was
 * written.
 *
 * So "no" is now two answers:
 *
 *   **new**       nothing resembles this. Create it, silently, zero taps.
 *   **near_miss** something resembles it closely enough that this is probably
 *                 a typo. Ask, because silently creating a second "Bench
 *                 Press" from "bnch pres" splits a year of history in half and
 *                 nothing afterwards can tell they were the same lift.
 *
 * The two are told apart by the trigram score that tier 2 already computes,
 * against two thresholds — see `FUZZY_MATCH_SCORE` and `NEAR_MISS_SCORE`,
 * which carry the measurements that chose them.
 */

export interface ResolvedExercise {
  id: string;
  name: string;
  slug: string;
  incrementKg: number;
  equipment: string;
  confidence: "exact" | "fuzzy" | "none";
}

/**
 * Above this trigram score, a near match is taken as THE match with no
 * question asked.
 *
 * **Unchanged at 0.45.** It is the number tier 2 has always used, and raising
 * it would silently turn resolutions that work today into questions — a
 * regression in three other call paths (`parseSetsText`, `/api/voice/
 * transcribe`, `scripts/verify-db.ts`, which asserts that "benh pres" ->
 * barbell-bench-press and scores exactly 0.467).
 *
 * Measured against the seeded 147-exercise catalogue, 31 realistic typos of
 * catalogue names that are NOT already aliases scored: min 0.538, p10 0.545,
 * median 0.643. Every one of them clears this bar, so a misspelling of a lift
 * the catalogue knows about resolves without a question being asked at all.
 *
 * KNOWN LIMITATION, and it is the one worth reading. Trigram similarity
 * measures shared characters, not shared meaning, so a DIFFERENT movement that
 * borrows a head noun also clears this bar. Against the same catalogue: "JM
 * press" (0.667), "Tate press" (0.545) and "viking press" (0.462) all match
 * Overhead Press, and "kang squat" (0.545) and "zombie squat" (0.462) both
 * match Back Squat. Those are five different lifts filed as two.
 *
 * The bar is not raised to fix that, for two reasons. The honest cut-off would
 * be ~0.72 — above the worst wrong match measured — and at that height two
 * thirds of ordinary typos become questions. And it would break the assertion
 * in `scripts/verify-db.ts`, which checks that "benh pres" resolves to
 * barbell-bench-press on a score of exactly 0.467; `parseSetsText` and
 * `/api/voice/transcribe` both depend on the same behaviour.
 *
 * What did fix the owner's five lines is the catalogue work done in parallel.
 * Re-measured after it landed, "incline smith press", "pec deck", "preacher
 * curls" and "cable rope hammer curls" all resolve EXACTLY at tier 1 and never
 * reach this tier at all. The residual cases above are obscure lifts the
 * catalogue still lacks; the only real fix for each is an alias. This threshold
 * is a named constant so that the decision stays one line to revisit.
 */
export const FUZZY_MATCH_SCORE = 0.45;

/**
 * At or above this score — and at or below `FUZZY_MATCH_SCORE` — the typed text
 * is close enough to something that already exists to be worth one question
 * before a new row is written. Below it, nothing resembles the text and it is
 * created with no interruption.
 *
 * **0.40**, and the narrowness of the band is the finding rather than a
 * compromise. Three measurements against the seeded catalogue chose it:
 *
 *  1. Typos of CATALOGUE lifts do not land in this band at all — they scored
 *     min 0.538 and matched outright. With a complete catalogue the match bar
 *     is already doing that job.
 *  2. Typos of a user's OWN custom exercise are the case that still needs
 *     catching, because such a row has one or two aliases rather than six and
 *     therefore scores lower. Over 20 of those: median 0.688, p10 0.444, min
 *     0.318, and 16 of 20 cleared the match bar on their own. Of the four that
 *     did not, 0.40 catches three (0.444, 0.444, 0.438 — "zorbax" against
 *     "zorbax thruster" is the shape of them) and lets one through: "zorbx
 *     thrstr" at 0.318, which is three characters of damage in two words.
 *  3. Genuinely new movements scored p25 0.304, median 0.421. At 0.40, eight of
 *     nineteen are created with zero taps and four are asked about; dropping to
 *     0.30 would have asked about nine of them while catching exactly one extra
 *     typo. The owner asked for zero taps on a genuinely new lift, so the band
 *     is kept as tight as the typo evidence allows rather than as wide as
 *     possible.
 *
 * The asymmetry is still respected where it costs something: answering "no,
 * it's new" is one tap and is immediately correct, whereas a wrongly created
 * duplicate is silent and corrupts every trend, e1RM and progression number for
 * that lift from then on. That is why the band is not closed entirely, which
 * the evidence above would otherwise support.
 */
export const NEAR_MISS_SCORE = 0.4;

/**
 * What resolution actually answers.
 *
 * `near_miss` carries the candidate so the caller can name it in the question
 * ("Did you mean Barbell Curl?") rather than asking an abstract one.
 */
export type ExerciseResolution =
  | { kind: "match"; exercise: ResolvedExercise }
  | { kind: "near_miss"; candidate: ResolvedExercise; score: number }
  | { kind: "new" }
  /** The query held no letters. Never create from this. */
  | { kind: "blank" };

const normalise = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");

const row = {
  id: exercises.id,
  name: exercises.name,
  slug: exercises.slug,
  incrementKg: exercises.incrementKg,
  equipment: exercises.equipment,
};

/**
 * The full answer: matched, suspiciously close, or genuinely new.
 *
 * Two queries at most, same as before — the second one's threshold moved down
 * from `FUZZY_MATCH_SCORE` to `NEAR_MISS_SCORE` so that the band is visible to
 * this function at all. It reads the same index (`exercise_aliases_alias_trgm_idx`)
 * over the same few hundred rows.
 */
export async function resolveExerciseOutcome(
  query: string,
  userId: string,
): Promise<ExerciseResolution> {
  const alias = normalise(query);
  if (!alias) return { kind: "blank" };

  // 1. Exact alias match — covers the overwhelming majority of entries.
  //
  // ORDER BY is load-bearing, not tidiness. This matches both the global row
  // (user_id NULL) and the user's own row for the same spelling, and LIMIT 1
  // without an order makes the winner a property of the query plan. Measured:
  // with the alias index in play the user's row came back 20/20; with
  // enable_indexscan off — a legitimate plan Postgres will pick as statistics
  // change — the global row came back 10/10. That is a user who re-points
  // "bench" at their own lift, sees it stick, and finds it silently reverted
  // later. `learnAlias` only means something if the row it writes wins.
  //
  // `user_id IS NULL` sorts false before true, so the user's own row is first.
  const exact = await db
    .select(row)
    .from(exerciseAliases)
    .innerJoin(exercises, eq(exercises.id, exerciseAliases.exerciseId))
    .where(and(
      eq(exerciseAliases.alias, alias),
      or(isNull(exerciseAliases.userId), eq(exerciseAliases.userId, userId)),
    ))
    .orderBy(sql`${exerciseAliases.userId} is null`)
    .limit(1);

  if (exact.length > 0) {
    return { kind: "match", exercise: { ...exact[0], confidence: "exact" } };
  }

  // 2. Trigram similarity. Catches typos and word-order variation without a
  //    round trip. A wrong match silently corrupts history, which is worse
  //    than asking — so the top candidate is only returned as a match above
  //    FUZZY_MATCH_SCORE, and merely as a question above NEAR_MISS_SCORE.
  const near = await db
    .select({ ...row, score: sql<number>`similarity(${exerciseAliases.alias}, ${alias})` })
    .from(exerciseAliases)
    .innerJoin(exercises, eq(exercises.id, exerciseAliases.exerciseId))
    .where(and(
      sql`similarity(${exerciseAliases.alias}, ${alias}) >= ${NEAR_MISS_SCORE}`,
      or(isNull(exerciseAliases.userId), eq(exerciseAliases.userId, userId)),
    ))
    // Same reason as tier 1, one step weaker: similarity alone is not a total
    // order, so two aliases that tie — the user's own spelling and a global
    // one — would again be separated by the plan. The user's row breaks the tie.
    .orderBy(sql`similarity(${exerciseAliases.alias}, ${alias}) DESC`, sql`${exerciseAliases.userId} is null`)
    .limit(1);

  // 3. Nothing within reach. The caller creates it.
  if (near.length === 0) return { kind: "new" };

  const { score, ...candidate } = near[0];
  // `score` arrives from postgres as a float4; `Number` guards against the
  // driver handing back a string for a numeric, which would make every
  // comparison below false and turn every near match into a new exercise.
  const value = Number(score);

  if (value > FUZZY_MATCH_SCORE) {
    return { kind: "match", exercise: { ...candidate, confidence: "fuzzy" } };
  }
  return { kind: "near_miss", candidate: { ...candidate, confidence: "none" }, score: value };
}

/**
 * The yes/no form, for the three callers that have no way to ask a question.
 *
 * A near miss is `null` here, NOT the candidate: `parseSetsText` puts a null
 * into `unresolved`, which the phone draws as an unmatched chip the user can
 * fix — whereas returning the candidate would file the set against a lift the
 * user never did, which is the failure this whole file is written to avoid.
 * Callers that can ask should call `resolveExerciseOutcome` instead.
 */
export async function resolveExercise(
  query: string,
  userId: string,
): Promise<ResolvedExercise | null> {
  const outcome = await resolveExerciseOutcome(query, userId);
  return outcome.kind === "match" ? outcome.exercise : null;
}

/**
 * Remember a resolution so the same wording is free next time.
 *
 * On conflict it REPOINTS rather than doing nothing. The unique index is
 * (alias, user_id), so a second correction of the same phrase used to be
 * silently discarded — the user re-filed "weighted pull ups" onto the right
 * row, the write was swallowed, and the next transcript resolved to the wrong
 * one again. A correction the user made twice has to stick.
 */
export async function learnAlias(exerciseId: string, alias: string, userId: string) {
  const normalised = normalise(alias);
  if (!normalised) return;

  await db.insert(exerciseAliases)
    .values({ exerciseId, alias: normalised, userId })
    .onConflictDoUpdate({
      target: [exerciseAliases.alias, exerciseAliases.userId],
      set: { exerciseId },
    });
}

export async function musclesFor(exerciseIds: string[]) {
  if (exerciseIds.length === 0) return new Map<string, { muscle: Muscle; contribution: number }[]>();
  /*
   * `inArray`, not sql`… = ANY(${ids})`.
   *
   * drizzle's sql template expands a JS array into a parameter *list*, so
   * Postgres received `= ANY(($1, $2, …))` and errored with `op ANY/ALL
   * (array) requires array on right side` (SQLSTATE 42809) — this function
   * could never return a row. It had no caller until the native bootstrap
   * route was written, which is why it had never fired.
   */
  const rows = await db.select().from(exerciseMuscles)
    .where(inArray(exerciseMuscles.exerciseId, exerciseIds));
  const map = new Map<string, { muscle: Muscle; contribution: number }[]>();
  for (const r of rows) {
    const list = map.get(r.exerciseId) ?? [];
    list.push({ muscle: r.muscle, contribution: r.contribution });
    map.set(r.exerciseId, list);
  }
  return map;
}

// ------------------------------------------------------------------ creating

/** Longest name worth storing. Past this it is a sentence, not a lift. */
export const MAX_EXERCISE_NAME = 60;

/**
 * Every created exercise steps in 5lb.
 *
 * Stored as the kg this converts to, so `displayLb` renders exactly "5" at the
 * edge. Using the column default (2.5 kg) instead would put "5.5 lb" on the
 * stepper of every custom exercise, which is the rounding complaint the owner
 * already made about kg input.
 */
export const DEFAULT_INCREMENT_LB = 5;

/**
 * The suffix that keeps a user's slugs out of the catalogue's namespace.
 *
 * The unique index is (slug, user_id), and Postgres treats NULLs as distinct,
 * so a custom "preacher-curl" and a catalogue "preacher-curl" can both exist —
 * the database would never complain, and the user would simply see the same
 * name twice in the picker with their history split across the two rows.
 *
 * Reserving a suffix makes that impossible by construction rather than by
 * timing: a custom exercise created today cannot collide with a catalogue slug
 * added next week, because no catalogue slug ends in `-custom`. There is a test
 * asserting that over `CATALOGUE`, so the invariant fails loudly if anyone adds
 * one.
 *
 * It is never shown to anyone. The picker searches slugs by substring, so
 * `preacher-curl-custom` still matches a search for "preacher".
 */
export const CUSTOM_SLUG_SUFFIX = "custom";

/** Words that read as initialisms rather than as words when title-cased. */
const ACRONYMS = new Set([
  "db", "bb", "ez", "jm", "ohp", "rdl", "sldl", "dl", "ghr", "bss", "rpe", "bw",
]);

/**
 * `"  today did PREACHER curls "` -> `"Preacher Curl"`.
 *
 * Three jobs, in order: strip what cannot be part of a name, title-case so the
 * row sits next to "Barbell Curl" rather than shouting, and singularise the
 * last word so a repeat of the same lift typed as "preacher curl" is the same
 * exercise rather than its twin.
 *
 * Whatever the user actually typed is learned as an alias regardless, so no
 * transformation here can lose their wording.
 */
export function canonicalExerciseName(raw: string): string {
  const cleaned = raw
    // Keep letters, digits, spaces and the punctuation that appears inside
    // real names: "pull-up", "21s", "cross-body".
    .replace(/[^\p{L}\p{N}\s'\-/]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_EXERCISE_NAME)
    .trim();

  if (cleaned === "") return "";

  const words = cleaned.split(" ");
  const last = words.length - 1;
  words[last] = singularise(words[last]);

  return words.map(titleCase).filter((w) => w !== "").join(" ");
}

/**
 * Only the obvious plurals, and only on the final word.
 *
 * `ss`/`es`/`is`/`us` endings are left alone, which is what keeps "press" from
 * becoming "pres" and "crunches" from becoming "crunche". Short words are left
 * alone too, so "abs" survives.
 */
function singularise(word: string): string {
  if (word.length < 4) return word;
  if (!/s$/i.test(word)) return word;
  if (/(ss|es|is|us)$/i.test(word)) return word;
  return word.slice(0, -1);
}

function titleCase(word: string): string {
  return word
    .split("-")
    .map((part) => {
      if (part === "") return part;
      if (ACRONYMS.has(part.toLowerCase())) return part.toUpperCase();
      return part[0].toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("-");
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/**
 * The slugs to try, in order, for one user's new exercise.
 *
 * The first is `<name>-custom`. The rest exist for the same user creating two
 * exercises whose names slugify identically — "Pec Deck" and "Pec-Deck" — which
 * the unique index would otherwise reject.
 */
export function customSlugCandidates(name: string, max = 8): string[] {
  const root = slugify(name) || "exercise";
  const first = `${root}-${CUSTOM_SLUG_SUFFIX}`;
  const out = [first];
  for (let n = 2; n <= max; n += 1) out.push(`${first}-${n}`);
  return out;
}

/**
 * Equipment, where the name says it outright.
 *
 * `""` rather than a guess when it does not. The column defaults to "barbell",
 * which would put "BARBELL" under "Pec Deck" in the picker — and the picker
 * already renders nothing for an empty string, which is the honest answer.
 */
export function inferEquipment(name: string): string {
  const n = ` ${name.toLowerCase().replace(/[-/]/g, " ").replace(/\s+/g, " ")} `;
  const has = (re: RegExp) => re.test(n);

  if (has(/ (smith|machine|pec deck|hack|sled|pendulum|hammer strength) /)) return "machine";
  if (has(/ (cable|rope|pulldown|pushdown|pulley|crossover) /)) return "cable";
  if (has(/ (dumbbell|dumbell|dumbbells|db) /)) return "dumbbell";
  if (has(/ (barbell|bb|ez bar|trap bar|landmine|safety bar) /)) return "barbell";
  if (has(/ (bodyweight|pull up|pullup|chin up|chinup|dip|dips|push up|pushup|plank) /)) {
    return "bodyweight";
  }
  return "";
}

/** Only where the user said it. Never inferred from the movement. */
export function inferUnilateral(name: string): boolean {
  return / (single|one|1) (arm|leg|sided?) |unilateral|bulgarian|pistol/.test(
    ` ${name.toLowerCase().replace(/[-/]/g, " ")} `,
  );
}

/**
 * Which muscles a name unambiguously implies — and nothing more.
 *
 * ── WHY THIS IS CONSERVATIVE ───────────────────────────────────────────────
 *
 * `exercise_muscles` is not decoration. It is the join that produces weekly
 * hard sets per muscle, which produces the muscle-debt ranking, which is what
 * the homepage, the coach's suggestions and the picker's "owed this week"
 * block are all built on. A wrong mapping does not look wrong: it tells the
 * owner for weeks that their chest is behind because a row machine was filed
 * as a press.
 *
 * So this maps only names whose meaning is not in question, and leaves
 * everything else unmapped. "JM press" and "Tate press" are tricep lifts and
 * both come back empty, because nothing in those words says so.
 *
 * UNMAPPED IS A REAL STATE WITH REAL CONSEQUENCES, and it is not an error.
 * `getMuscleVolume` INNER JOINs `exercise_muscles`, so sets on an unmapped
 * exercise are invisible to it: they are in the session, in the history, in
 * every e1RM and in every per-exercise trend, and they contribute zero to
 * weekly volume, to the debt ranking, to "days since trained" and to session
 * auto-naming. Nothing double counts and nothing breaks — the lift simply does
 * not pay down any muscle's debt until it is mapped. The create route reports
 * this per exercise so the UI can say so instead of leaving the owner to
 * discover it from a ranking that will not move.
 *
 * First match wins, so the list runs specific -> general: "leg curl" must be
 * read before "curl", and "split squat" before "squat".
 */
const MUSCLE_RULES: { when: RegExp; muscles: Partial<Record<Muscle, number>> }[] = [
  // ---- hamstring/forearm curls, before the bicep catch-all
  { when: / (leg|hamstring|nordic|glute ham|ghr|seated leg|lying leg) \w*\s?curl/,
    muscles: { hamstring: 1 } },
  { when: / (wrist|reverse) \w*\s?curl/, muscles: { forearm: 1 } },
  { when: /curl/, muscles: { bicep: 1, forearm: 0.5 } },

  // ---- delts
  { when: / (lateral|side) (raise|delt)|lat raise/, muscles: { side_delt: 1 } },
  { when: / rear (delt|fly)| reverse (fly|flye)/, muscles: { rear_delt: 1, upper_back: 0.5 } },
  { when: / face pull/, muscles: { rear_delt: 1, upper_back: 0.5, trap: 0.5 } },
  { when: / front raise/, muscles: { front_delt: 1 } },

  // ---- back
  { when: / shrug/, muscles: { trap: 1 } },
  { when: / (pulldown|pull down|pull up|pullup|chin up|chinup)/,
    muscles: { lat: 1, bicep: 0.5, upper_back: 0.5 } },
  { when: / row/, muscles: { upper_back: 1, lat: 0.5, bicep: 0.5, rear_delt: 0.5 } },

  // ---- legs
  { when: / (calf|calves)/, muscles: { calf: 1 } },
  { when: / (leg|quad) extension/, muscles: { quad: 1 } },
  { when: / (hip thrust|glute bridge|glute kickback|hip extension)/,
    muscles: { glute: 1, hamstring: 0.5 } },
  { when: / (deadlift|rdl|sldl|good morning)/,
    muscles: { hamstring: 1, glute: 1, lower_back: 0.5 } },
  { when: / (back extension|hyperextension|reverse hyper)/,
    muscles: { lower_back: 1, glute: 0.5, hamstring: 0.5 } },
  { when: / (lunge|step up|split squat)/, muscles: { quad: 1, glute: 1 } },
  { when: / (squat|leg press)/, muscles: { quad: 1, glute: 0.5 } },
  { when: / (hip )?abduction/, muscles: { abductor: 1 } },
  { when: / (hip )?adduction/, muscles: { adductor: 1 } },

  // ---- core
  { when: / (crunch|sit up|situp|plank|ab wheel|ab rollout|leg raise|knee raise|hollow|dead bug|woodchop)/,
    muscles: { abs: 1 } },

  // ---- push
  { when: / dip/, muscles: { chest: 1, tricep: 0.5, front_delt: 0.5 } },
  { when: / (pushdown|push down|skullcrusher|skull crusher|tricep|triceps|overhead extension|kickback)/,
    muscles: { tricep: 1 } },
  { when: / (push up|pushup)/, muscles: { chest: 1, tricep: 0.5, front_delt: 0.5 } },
  { when: / (bench|chest|incline|decline|pec)\b.*press|press.*\b(chest|pec)\b/,
    muscles: { chest: 1, front_delt: 0.5, tricep: 0.5 } },
  { when: / (pec (deck|fly)|chest fly|fly|flye|flyes)/, muscles: { chest: 1 } },
  { when: / (overhead|shoulder|military|arnold|landmine|viking|z) press| ohp/,
    muscles: { front_delt: 1, side_delt: 0.5, tricep: 0.5 } },
];

export function inferMuscles(name: string): { muscle: Muscle; contribution: number }[] {
  // Padded and de-punctuated so ` row ` cannot match inside "rower" and
  // "pull-up" is read the same as "pull up".
  const n = ` ${name.toLowerCase().replace(/[-/]/g, " ").replace(/\s+/g, " ").trim()} `;

  for (const rule of MUSCLE_RULES) {
    if (!rule.when.test(n)) continue;
    return Object.entries(rule.muscles).map(([muscle, contribution]) => ({
      muscle: muscle as Muscle,
      contribution: contribution as number,
    }));
  }
  return [];
}

export interface CreatedExercise extends ResolvedExercise {
  muscles: { muscle: Muscle; contribution: number }[];
  /** False when nothing in the name said which muscles it works. */
  musclesInferred: boolean;
}

/**
 * Write a new exercise, owned by this user.
 *
 * `user_id` is the user, never null. Null is the shared catalogue, which is
 * readable by everyone and writable by nobody — `write_own_exercises` in
 * drizzle/0001 has `WITH CHECK (user_id = app.current_user_id())`, so an
 * attempt to write a null-owner row from inside a request raises rather than
 * quietly adding a lift to everybody else's app. Must be called inside
 * `withUser()`; `route()` already provides that.
 *
 * The typed wording is learned as an alias in the same breath, which is what
 * makes this a one-time cost: the owner types "preacher curls" once and every
 * later occurrence resolves exactly, with no query, no model and no question.
 */
export async function createUserExercise(
  typed: string,
  userId: string,
  nameOverride?: string,
): Promise<CreatedExercise> {
  const name = canonicalExerciseName(nameOverride ?? typed);
  if (name === "") throw new Error("An exercise needs a name with a letter in it.");

  const equipment = inferEquipment(name);
  const muscles = inferMuscles(name);

  let created: ResolvedExercise | null = null;
  for (const slug of customSlugCandidates(name)) {
    /*
     * `onConflictDoNothing` plus the returning check, rather than looking the
     * slug up first. Two phones logging the same new lift at the same moment
     * would both read "free" and one insert would then fail — here the loser
     * simply gets an empty `returning()` and moves on to the next candidate.
     */
    const [inserted] = await db.insert(exercises)
      .values({
        userId,
        name,
        slug,
        equipment,
        isUnilateral: inferUnilateral(name),
        incrementKg: lbToKg(DEFAULT_INCREMENT_LB),
      })
      .onConflictDoNothing()
      .returning(row);

    if (inserted) {
      created = { ...inserted, confidence: "exact" };
      break;
    }
  }

  if (!created) {
    throw new Error(`Could not find a free slug for "${name}". Rename it and try again.`);
  }
  // Bound to a const so the narrowing survives into the callback below:
  // TypeScript widens a captured `let` back to its declared type inside one.
  const exercise = created;

  if (muscles.length > 0) {
    await db.insert(exerciseMuscles)
      .values(muscles.map((m) => ({
        exerciseId: exercise.id,
        muscle: m.muscle,
        contribution: m.contribution,
      })))
      .onConflictDoNothing();
  }

  // The typed wording first, because that is the one that has to be free next
  // time. The canonical name second, so typing it back in full also resolves
  // exactly — when the two normalise to the same string it is one write.
  await learnAlias(exercise.id, typed, userId);
  if (normalise(name) !== normalise(typed)) {
    await learnAlias(exercise.id, name, userId);
  }

  return { ...exercise, muscles, musclesInferred: muscles.length > 0 };
}
