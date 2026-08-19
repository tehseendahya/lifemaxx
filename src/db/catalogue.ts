import type { Muscle } from "./schema";

/**
 * The built-in exercise catalogue.
 *
 * Muscle contributions are the load-bearing part: 1.0 primary, 0.5 secondary.
 * They drive weekly volume, session auto-naming and the homepage ranking, so
 * they're worth getting roughly right rather than exactly right — the ranking
 * cares about which muscle is furthest behind, not about decimals.
 *
 * incrementKg is the smallest jump that's actually loadable on that equipment.
 * Barbells step in 5lb (a 2.5lb pair); dumbbells jump 5lb per hand at best.
 */

export interface CatalogueEntry {
  name: string;
  slug: string;
  equipment: "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight";
  isUnilateral?: boolean;
  incrementLb: number;
  aliases: string[];
  muscles: Partial<Record<Muscle, number>>;
}

export const CATALOGUE: CatalogueEntry[] = [
  // ---- horizontal push
  { name: "Barbell Bench Press", slug: "barbell-bench-press", equipment: "barbell", incrementLb: 5,
    aliases: ["bench", "bp", "barbell bench", "flat bench", "bench press"],
    muscles: { chest: 1, front_delt: 0.5, tricep: 0.5 } },
  { name: "Incline Barbell Press", slug: "incline-barbell-press", equipment: "barbell", incrementLb: 5,
    aliases: ["incline bench", "incline press", "incline barbell"],
    muscles: { chest: 1, front_delt: 0.5, tricep: 0.5 } },
  { name: "Incline Dumbbell Press", slug: "incline-dumbbell-press", equipment: "dumbbell", incrementLb: 5,
    aliases: ["incline db press", "incline dumbbell", "incline db"],
    muscles: { chest: 1, front_delt: 0.5, tricep: 0.5 } },
  { name: "Dumbbell Bench Press", slug: "dumbbell-bench-press", equipment: "dumbbell", incrementLb: 5,
    aliases: ["db bench", "dumbbell bench", "db press"],
    muscles: { chest: 1, front_delt: 0.5, tricep: 0.5 } },
  { name: "Dips", slug: "dips", equipment: "bodyweight", incrementLb: 5,
    aliases: ["dip", "chest dips"],
    muscles: { chest: 1, tricep: 0.5, front_delt: 0.5 } },
  { name: "Cable Fly", slug: "cable-fly", equipment: "cable", incrementLb: 5,
    aliases: ["fly", "flys", "flies", "pec fly", "cable flies"],
    muscles: { chest: 1 } },

  // ---- vertical push
  { name: "Overhead Press", slug: "overhead-press", equipment: "barbell", incrementLb: 5,
    aliases: ["ohp", "military press", "shoulder press", "press"],
    muscles: { front_delt: 1, side_delt: 0.5, tricep: 0.5 } },
  { name: "Dumbbell Shoulder Press", slug: "dumbbell-shoulder-press", equipment: "dumbbell", incrementLb: 5,
    aliases: ["db shoulder press", "db ohp", "seated db press"],
    muscles: { front_delt: 1, side_delt: 0.5, tricep: 0.5 } },
  { name: "Lateral Raise", slug: "lateral-raise", equipment: "dumbbell", incrementLb: 5,
    aliases: ["lat raise", "side raise", "laterals", "side delt raise"],
    muscles: { side_delt: 1 } },
  { name: "Rear Delt Fly", slug: "rear-delt-fly", equipment: "dumbbell", incrementLb: 5,
    aliases: ["rear delt", "reverse fly", "rear fly", "rear delts"],
    muscles: { rear_delt: 1, upper_back: 0.5 } },

  // ---- vertical pull
  { name: "Pull-Up", slug: "pull-up", equipment: "bodyweight", incrementLb: 5,
    aliases: ["pullup", "pullups", "pull ups", "pull-ups"],
    muscles: { lat: 1, bicep: 0.5, upper_back: 0.5 } },
  { name: "Chin-Up", slug: "chin-up", equipment: "bodyweight", incrementLb: 5,
    aliases: ["chinup", "chinups", "chin ups"],
    muscles: { lat: 1, bicep: 0.5 } },
  { name: "Lat Pulldown", slug: "lat-pulldown", equipment: "cable", incrementLb: 5,
    aliases: ["pulldown", "pulldowns", "lat pull"],
    muscles: { lat: 1, bicep: 0.5, upper_back: 0.5 } },

  // ---- horizontal pull
  { name: "Barbell Row", slug: "barbell-row", equipment: "barbell", incrementLb: 5,
    aliases: ["bb row", "row", "rows", "bent over row", "pendlay row"],
    muscles: { upper_back: 1, lat: 0.5, bicep: 0.5, rear_delt: 0.5 } },
  { name: "Dumbbell Row", slug: "dumbbell-row", equipment: "dumbbell", isUnilateral: true, incrementLb: 5,
    aliases: ["db row", "one arm row", "single arm row"],
    muscles: { upper_back: 1, lat: 0.5, bicep: 0.5 } },
  { name: "Seated Cable Row", slug: "seated-cable-row", equipment: "cable", incrementLb: 5,
    aliases: ["cable row", "seated row"],
    muscles: { upper_back: 1, lat: 0.5, bicep: 0.5, rear_delt: 0.5 } },
  { name: "Face Pull", slug: "face-pull", equipment: "cable", incrementLb: 5,
    aliases: ["facepull", "face pulls"],
    muscles: { rear_delt: 1, upper_back: 0.5, trap: 0.5 } },
  { name: "Shrug", slug: "shrug", equipment: "barbell", incrementLb: 5,
    aliases: ["shrugs", "barbell shrug"],
    muscles: { trap: 1 } },

  // ---- squat pattern
  { name: "Back Squat", slug: "back-squat", equipment: "barbell", incrementLb: 5,
    aliases: ["squat", "squats", "bb squat", "barbell squat"],
    muscles: { quad: 1, glute: 0.5, lower_back: 0.5, adductor: 0.5 } },
  { name: "Front Squat", slug: "front-squat", equipment: "barbell", incrementLb: 5,
    aliases: ["front squats"],
    muscles: { quad: 1, glute: 0.5, abs: 0.5 } },
  { name: "Leg Press", slug: "leg-press", equipment: "machine", incrementLb: 10,
    aliases: ["legpress"],
    muscles: { quad: 1, glute: 0.5 } },
  { name: "Bulgarian Split Squat", slug: "bulgarian-split-squat", equipment: "dumbbell", isUnilateral: true, incrementLb: 5,
    aliases: ["bss", "split squat", "bulgarians"],
    muscles: { quad: 1, glute: 1 } },
  { name: "Leg Extension", slug: "leg-extension", equipment: "machine", incrementLb: 5,
    aliases: ["leg extensions", "quad extension"],
    muscles: { quad: 1 } },

  // ---- hinge pattern
  { name: "Deadlift", slug: "deadlift", equipment: "barbell", incrementLb: 5,
    aliases: ["dl", "deadlifts", "conventional deadlift"],
    muscles: { hamstring: 1, glute: 1, lower_back: 1, trap: 0.5, upper_back: 0.5 } },
  { name: "Romanian Deadlift", slug: "romanian-deadlift", equipment: "barbell", incrementLb: 5,
    aliases: ["rdl", "rdls", "romanian"],
    muscles: { hamstring: 1, glute: 1, lower_back: 0.5 } },
  { name: "Hip Thrust", slug: "hip-thrust", equipment: "barbell", incrementLb: 5,
    aliases: ["hip thrusts", "glute bridge"],
    muscles: { glute: 1, hamstring: 0.5 } },
  { name: "Leg Curl", slug: "leg-curl", equipment: "machine", incrementLb: 5,
    aliases: ["leg curls", "hamstring curl"],
    muscles: { hamstring: 1 } },

  // ---- arms, calves, core
  { name: "Barbell Curl", slug: "barbell-curl", equipment: "barbell", incrementLb: 5,
    aliases: ["curl", "curls", "bb curl", "bicep curl"],
    muscles: { bicep: 1, forearm: 0.5 } },
  { name: "Dumbbell Curl", slug: "dumbbell-curl", equipment: "dumbbell", incrementLb: 5,
    aliases: ["db curl", "db curls", "hammer curl"],
    muscles: { bicep: 1, forearm: 0.5 } },
  { name: "Tricep Pushdown", slug: "tricep-pushdown", equipment: "cable", incrementLb: 5,
    aliases: ["pushdown", "pushdowns", "tricep extension", "rope pushdown"],
    muscles: { tricep: 1 } },
  { name: "Skullcrusher", slug: "skullcrusher", equipment: "barbell", incrementLb: 5,
    aliases: ["skullcrushers", "lying tricep extension"],
    muscles: { tricep: 1 } },
  { name: "Calf Raise", slug: "calf-raise", equipment: "machine", incrementLb: 5,
    aliases: ["calf raises", "calves", "standing calf raise"],
    muscles: { calf: 1 } },
  { name: "Hanging Leg Raise", slug: "hanging-leg-raise", equipment: "bodyweight", incrementLb: 5,
    aliases: ["leg raise", "leg raises", "hanging leg raises"],
    muscles: { abs: 1 } },
  { name: "Cable Crunch", slug: "cable-crunch", equipment: "cable", incrementLb: 5,
    aliases: ["crunch", "crunches", "ab crunch"],
    muscles: { abs: 1 } },
  { name: "Plank", slug: "plank", equipment: "bodyweight", incrementLb: 5,
    aliases: ["planks"],
    muscles: { abs: 1, lower_back: 0.5 } },
];

export const bySlug = new Map(CATALOGUE.map((e) => [e.slug, e]));
