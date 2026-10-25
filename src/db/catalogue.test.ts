import { describe, it, expect } from "vitest";
import { CATALOGUE, aliasesFor, bySlug, type CatalogueEntry } from "./catalogue";
import { MUSCLES } from "./schema";

/**
 * The catalogue is seeded, not type-checked, so the things that can go wrong
 * with it go wrong at runtime in Postgres — or, worse, not at all.
 *
 * A duplicate alias is the dangerous one. `exercise_aliases` has a unique
 * index on (alias, user_id) and the seed inserts with onConflictDoNothing, so
 * a collision doesn't fail the seed: the alias silently belongs to whichever
 * entry happened to seed first, and the other exercise is unreachable by that
 * name forever. That is exactly the failure that sent "cable rope hammer
 * curls" to Dumbbell Curl.
 */

const MUSCLE_SET = new Set<string>(MUSCLES);

describe("exercise catalogue", () => {
  it("has a slug and a name for every entry", () => {
    for (const e of CATALOGUE) {
      expect(e.slug, e.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(e.name.trim()).toBe(e.name);
      expect(e.name.length).toBeGreaterThan(0);
    }
  });

  it("has unique slugs", () => {
    const seen = new Map<string, string>();
    for (const e of CATALOGUE) {
      expect(seen.has(e.slug), `slug "${e.slug}" used by both "${seen.get(e.slug)}" and "${e.name}"`).toBe(false);
      seen.set(e.slug, e.name);
    }
    expect(bySlug.size).toBe(CATALOGUE.length);
  });

  /**
   * Covers the derived aliases too — the slug-with-spaces and the lowercased
   * name that the seed adds on top of the hand-written list. Those collide
   * just as destructively and are easier to miss.
   */
  it("has globally unique aliases, derived ones included", () => {
    const owner = new Map<string, string>();
    const collisions: string[] = [];
    for (const e of CATALOGUE) {
      for (const alias of aliasesFor(e)) {
        const prev = owner.get(alias);
        if (prev && prev !== e.slug) collisions.push(`"${alias}": ${prev} vs ${e.slug}`);
        else owner.set(alias, e.slug);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("writes aliases already normalised", () => {
    for (const e of CATALOGUE) {
      for (const alias of e.aliases) {
        expect(alias, `${e.slug}: "${alias}"`).toBe(alias.toLowerCase().trim());
        expect(alias, `${e.slug}: "${alias}"`).not.toMatch(/\s{2,}/);
        expect(alias.length, `${e.slug}: "${alias}"`).toBeGreaterThan(1);
      }
    }
  });

  it("only uses muscles from the MUSCLES enum", () => {
    for (const e of CATALOGUE) {
      const entries = Object.entries(e.muscles);
      expect(entries.length, `${e.slug} has no muscles`).toBeGreaterThan(0);
      for (const [muscle, contribution] of entries) {
        expect(MUSCLE_SET.has(muscle), `${e.slug}: unknown muscle "${muscle}"`).toBe(true);
        expect([0.5, 1], `${e.slug}: ${muscle} = ${contribution}`).toContain(contribution);
      }
      const primaries = entries.filter(([, c]) => c === 1);
      expect(primaries.length, `${e.slug} has no primary muscle`).toBeGreaterThan(0);
    }
  });

  it("uses an increment the equipment can actually load", () => {
    // Plate-loaded bars step in 2.5lb pairs; a selectorised stack is one pin.
    const allowed: Record<CatalogueEntry["equipment"], number[]> = {
      barbell: [5],
      dumbbell: [5],
      cable: [5],
      bodyweight: [5],
      machine: [5, 10],
    };
    for (const e of CATALOGUE) {
      expect(allowed[e.equipment], `${e.slug}`).toContain(e.incrementLb);
    }
    // Smith machines are barbells on rails — 5lb, not a 10lb pin.
    for (const e of CATALOGUE.filter((x) => x.slug.startsWith("smith-machine-"))) {
      expect(e.incrementLb, e.slug).toBe(5);
    }
  });

  /**
   * The exact lifts the owner typed on the first real session. Every one of
   * these either came back unmatched or matched to a different machine, so
   * they're pinned here by the words that were actually typed.
   */
  it("resolves the wording that failed in the gym", () => {
    const byAlias = new Map<string, string>();
    for (const e of CATALOGUE) for (const a of aliasesFor(e)) byAlias.set(a, e.slug);

    const expected: Record<string, string> = {
      "bench": "barbell-bench-press",
      "incline smith press": "smith-machine-incline-press",
      "smith incline": "smith-machine-incline-press",
      "pec deck": "pec-deck",
      "pecdeck": "pec-deck",
      "chest fly machine": "pec-deck",
      "preacher curl": "preacher-curl",
      "preacher curls": "preacher-curl",
      "ez preacher": "preacher-curl",
      "cable rope hammer curls": "cable-hammer-curl",
      "rope hammer curl": "cable-hammer-curl",
      "cable hammer curls": "cable-hammer-curl",
      "hammer curl": "hammer-curl",
      "hammer curls": "hammer-curl",
    };
    for (const [alias, slug] of Object.entries(expected)) {
      expect(byAlias.get(alias), `"${alias}"`).toBe(slug);
    }
  });

  it("covers the commercial-gym surface the owner trains on", () => {
    const slugs = new Set(CATALOGUE.map((e) => e.slug));
    for (const slug of [
      // Smith variants
      "smith-machine-bench-press", "smith-machine-incline-press",
      "smith-machine-shoulder-press", "smith-machine-row", "smith-machine-squat",
      "smith-machine-calf-raise",
      // chest fly / pec deck
      "pec-deck", "reverse-pec-deck",
      // preacher and arm machines
      "preacher-curl", "machine-preacher-curl", "tricep-extension-machine",
      // cable and rope attachments
      "cable-hammer-curl", "cable-curl", "cable-crossover", "cable-woodchop",
      "straight-arm-pulldown", "cable-pull-through", "overhead-tricep-extension",
      // hammer curls
      "hammer-curl",
      // machine rows and presses
      "seated-machine-row", "chest-supported-row", "machine-chest-press",
      "incline-machine-press", "machine-shoulder-press", "machine-lat-pulldown",
      // leg machines
      "hack-squat", "pendulum-squat", "belt-squat", "seated-leg-curl",
      "lying-leg-curl", "hip-abduction-machine", "hip-adduction-machine",
      "single-leg-press", "machine-hip-thrust",
    ]) {
      expect(slugs.has(slug), `missing ${slug}`).toBe(true);
    }
  });

  /** Shipped slugs are identity: `sets.exercise_id` points at them. */
  it("keeps every slug that has already shipped", () => {
    const shipped = [
      "barbell-bench-press", "incline-barbell-press", "incline-dumbbell-press",
      "dumbbell-bench-press", "dips", "cable-fly", "overhead-press",
      "dumbbell-shoulder-press", "lateral-raise", "rear-delt-fly", "pull-up",
      "chin-up", "lat-pulldown", "barbell-row", "dumbbell-row", "seated-cable-row",
      "face-pull", "shrug", "back-squat", "front-squat", "leg-press",
      "bulgarian-split-squat", "leg-extension", "deadlift", "romanian-deadlift",
      "hip-thrust", "leg-curl", "barbell-curl", "dumbbell-curl", "tricep-pushdown",
      "skullcrusher", "calf-raise", "hanging-leg-raise", "cable-crunch", "plank",
    ];
    for (const slug of shipped) expect(bySlug.has(slug), `lost ${slug}`).toBe(true);
    expect(shipped.length).toBe(35);
  });

  it("is big enough to be worth searching", () => {
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(140);
    const aliasCount = CATALOGUE.reduce((n, e) => n + aliasesFor(e).length, 0);
    expect(aliasCount).toBeGreaterThanOrEqual(700);
  });
});
