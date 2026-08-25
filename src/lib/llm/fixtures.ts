import type { LlmProvider, StructuredRequest, TextRequest, Message } from "./provider";
import { parseShorthand } from "./shorthand";

/**
 * Offline provider.
 *
 * Set LLM_PROVIDER=fixtures and the entire app works with no API key and no
 * network: meals get plausible macros, sets parse for real via the shorthand
 * parser, suggestions echo the mechanical baseline, and the coach answers from
 * templates. Useful for development, for tests, and as the degraded mode when
 * the network is gone.
 *
 * Nothing here pretends to be intelligent — the point is that every screen
 * renders with realistic data so the UI can be built and reviewed honestly.
 */

function lastUserText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    const text = m.content.filter((p) => p.type === "text").map((p) => (p as any).text).join("\n");
    if (text) return text;
  }
  return "";
}

/** Stable pseudo-random from a string, so fixtures don't flicker between runs. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const MEAL_TEMPLATES = [
  { name: "Grilled chicken breast", qty: 6, unit: "oz", kcal: 280, protein_g: 52, carbs_g: 0, fat_g: 7 },
  { name: "White rice", qty: 1.5, unit: "cups", kcal: 310, protein_g: 6, carbs_g: 68, fat_g: 1 },
  { name: "Broccoli", qty: 1, unit: "cup", kcal: 55, protein_g: 4, carbs_g: 11, fat_g: 1 },
  { name: "Olive oil", qty: 1, unit: "tbsp", kcal: 120, protein_g: 0, carbs_g: 0, fat_g: 14 },
];

export class FixtureProvider implements LlmProvider {
  readonly name = "fixtures";

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const input = lastUserText(req.messages);
    const seed = hash(input);
    let payload: unknown;

    switch (req.schemaName) {
      case "meal_analysis": {
        const count = 2 + (seed % 3);
        const items = MEAL_TEMPLATES.slice(0, count);
        payload = {
          items,
          confidence: 0.55 + (seed % 30) / 100,
          note: "Estimated offline — no model was called.",
        };
        break;
      }
      case "parsed_sets": {
        payload = { entries: parseShorthand(input) };
        break;
      }
      case "suggestion": {
        // Echo the baseline embedded in the prompt rather than inventing one.
        const m = input.match(/baseline[^0-9]*(\d+(?:\.\d+)?)\s*lb[^0-9]*(\d+)\s*(?:sets?|×|x)\s*(\d+)/i);
        payload = {
          weight_lb: m ? Number(m[1]) : 0,
          sets: m ? Number(m[2]) : 3,
          reps: m ? Number(m[3]) : 5,
          reason: "Offline — showing the mechanical baseline with no model adjustment.",
        };
        break;
      }
      case "exercise_match": {
        const name = input.trim().slice(0, 60) || "Unknown Exercise";
        payload = {
          matched_slug: null,
          is_new: true,
          canonical_name: name.replace(/\b\w/g, (c) => c.toUpperCase()),
          equipment: "barbell",
          muscles: [{ muscle: "chest", contribution: 1 }],
        };
        break;
      }
      default:
        throw new Error(`No fixture for schema ${String(req.schemaName)}`);
    }

    return req.validator.parse(payload);
  }

  async text(req: TextRequest): Promise<string> {
    const q = lastUserText(req.messages).toLowerCase();
    if (q.includes("another set")) {
      return "Offline mode — no coach available. Your last set's RPE is the thing to go on: below 8, do another.";
    }
    if (q.includes("protein")) {
      return "Offline mode — no coach available. Check the Today screen for your protein total against target.";
    }
    return "Offline mode — the coach needs a network connection and an OPENAI_API_KEY. Everything else still works.";
  }

  async *stream(req: TextRequest): AsyncIterable<string> {
    const full = await this.text(req);
    for (const word of full.split(" ")) yield `${word} `;
  }
}
