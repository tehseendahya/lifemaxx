import "../load-env";
import OpenAI from "openai";
import { OpenAiProvider } from "../src/lib/llm/openai";
import { MODELS } from "../src/lib/models";
import {
  JSON_SCHEMAS, mealAnalysisSchema, parsedSetsSchema, suggestionSchema,
} from "../src/lib/llm/schemas";
import { mealMessages, SETS_SYSTEM, SUGGEST_SYSTEM, COACH_VOICE } from "../src/lib/llm/prompts";

/**
 * Exercises every OpenAI route against the live API, once, for a few cents.
 *
 * The unit tests in src/lib/llm/openai.test.ts prove the app builds requests
 * the API's contract accepts and survives every response shape it can return.
 * They cannot prove the two things only the real endpoint knows: whether the
 * model ids in lib/models.ts exist, and whether the answers are usable.
 *
 * Run this the moment a key and network are both available:
 *   npm run llm:preflight
 */

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

// A 1x1 white JPEG. Enough to prove the vision content part is accepted
// without paying to describe an actual photograph.
const PIXEL =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL" +
  "DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
  "AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let failures = 0;

async function step(name: string, fn: () => Promise<string>) {
  process.stdout.write(`  ${name} … `);
  try {
    console.log(`${GREEN}ok${OFF}  ${DIM}${await fn()}${OFF}`);
  } catch (err) {
    failures += 1;
    console.log(`${RED}FAILED${OFF}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error("OPENAI_API_KEY is not set. Put it in .env.local.");
    process.exit(1);
  }

  console.log("\nmodel ids");
  const client = new OpenAI({ apiKey: key });

  let available: Set<string> | null = null;
  try {
    const list = await client.models.list();
    available = new Set(list.data.map((m) => m.id));
    console.log(`  ${DIM}${available.size} models visible to this key${OFF}`);
  } catch (err) {
    failures += 1;
    console.log(`  ${RED}could not list models${OFF} — ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const [route, model] of Object.entries(MODELS)) {
    if (!available) break;
    const ok = available.has(model);
    if (!ok) failures += 1;
    console.log(`  ${ok ? `${GREEN}ok${OFF}  ` : `${RED}MISSING${OFF} `} ${route} → ${model}`);
  }
  if (available && [...new Set(Object.values(MODELS))].some((m) => !available!.has(m))) {
    console.log(`\n  ${DIM}A missing id means lib/models.ts names a model this key cannot reach.`);
    console.log(`  Pick replacements from the list above and change that one file.${OFF}`);
  }

  const llm = new OpenAiProvider(key, { maxRetries: 1 });

  console.log("\nroutes");

  await step("meals/analyze  (vision, structured)", async () => {
    const result = await llm.structured({
      model: MODELS.mealAnalyze,
      messages: mealMessages(
        "Running prep, plus size in shoulders and back.",
        PIXEL,
        "Ignore the image, it is a test pixel. Assume 2 eggs and 3 strips of bacon.",
      ),
      schemaName: "meal_analysis",
      jsonSchema: JSON_SCHEMAS.meal_analysis,
      validator: mealAnalysisSchema,
      maxTokens: 600,
    });
    return `${result.items.length} items, ${Math.round(
      result.items.reduce((a, i) => a + i.kcal, 0))} kcal, confidence ${result.confidence}`;
  });

  await step("sets/parse     (structured)", async () => {
    const result = await llm.structured({
      model: MODELS.setsParse,
      messages: [
        { role: "system", content: SETS_SYSTEM },
        { role: "user", content: "worked up to a heavy triple on bench, ended around 245, then some flyes" },
      ],
      schemaName: "parsed_sets",
      jsonSchema: JSON_SCHEMAS.parsed_sets,
      validator: parsedSetsSchema,
      maxTokens: 600,
    });
    return result.entries.map((e) => `${e.exercise_query} x${e.sets.length}`).join(", ") || "no entries";
  });

  await step("session/suggest (structured)", async () => {
    const result = await llm.structured({
      model: MODELS.sessionSuggest,
      messages: [
        { role: "system", content: SUGGEST_SYSTEM },
        {
          role: "user",
          content: "The baseline is 185 lb for 3 sets of 5. Last session: 185x5 @RPE7, 185x5 @RPE7, 185x5 @RPE7, none to failure, felt strong.",
        },
      ],
      schemaName: "suggestion",
      jsonSchema: JSON_SCHEMAS.suggestion,
      validator: suggestionSchema,
      maxTokens: 300,
    });
    return `${result.weight_lb} lb x ${result.reps} x ${result.sets} — "${result.reason}"`;
  });

  await step("session/ask     (streaming)", async () => {
    let out = "";
    for await (const chunk of llm.stream({
      model: MODELS.sessionAsk,
      messages: [
        { role: "system", content: COACH_VOICE },
        { role: "user", content: "Three sets of bench done, all RPE 7. Should I do another set?" },
      ],
      maxTokens: 200,
    })) out += chunk;
    if (!out.trim()) throw new Error("stream produced no content");
    return `${out.trim().slice(0, 90)}…`;
  });

  await step("coach/chat      (streaming)", async () => {
    let out = "";
    for await (const chunk of llm.stream({
      model: MODELS.coachChat,
      messages: [
        { role: "system", content: COACH_VOICE },
        { role: "user", content: "Am I progressing on bench or just adding volume? I have 3 days of data." },
      ],
      maxTokens: 300,
    })) out += chunk;
    if (!out.trim()) throw new Error("stream produced no content");
    return `${out.trim().slice(0, 90)}…`;
  });

  await step("cron digests    (text)", async () => {
    const verdict = await llm.text({
      model: MODELS.digest,
      messages: [
        { role: "system", content: COACH_VOICE },
        {
          role: "user",
          content: 'Today: {"kcal":1840,"protein_g":112,"protein_target_g":150,"meals_logged":3}\n\nWrite the end-of-day verdict. Two sentences.',
        },
      ],
      maxTokens: 200,
    });
    if (!verdict.trim()) throw new Error("empty verdict");
    return `${verdict.trim().slice(0, 90)}…`;
  });

  console.log(failures === 0
    ? `\n${GREEN}Every route reached the live API.${OFF}\n`
    : `\n${RED}${failures} check(s) failed.${OFF} Nothing above needed a database — this is the model layer only.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
