import { describe, expect, it } from "vitest";

import {
  PLACEHOLDER_EMPTY, PLACEHOLDER_WITH_PHOTO,
  analyzeInput, canLog, logButtonLabel, placeholderFor, savePayload, sourceFor,
  type ComposePhoto,
} from "./compose";
import type { AnalyzedItem } from "./model";

const PHOTO: ComposePhoto = { dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg" };

const ITEMS: AnalyzedItem[] = [
  { name: "Chicken thigh", qty: 200, unit: "g", kcal: 410, protein_g: 46, carbs_g: 0, fat_g: 24 },
  { name: "Protein shake", qty: 1, unit: "scoop", kcal: 120, protein_g: 24, carbs_g: 3, fat_g: 1.5 },
];

describe("canLog", () => {
  it("needs a photo or a caption, and either alone is enough", () => {
    expect(canLog({ caption: "", photo: null })).toBe(false);
    expect(canLog({ caption: "two eggs", photo: null })).toBe(true);
    expect(canLog({ caption: "", photo: PHOTO })).toBe(true);
    expect(canLog({ caption: "plus a protein shake", photo: PHOTO })).toBe(true);
  });

  it("does not count whitespace as a caption", () => {
    expect(canLog({ caption: "   \n ", photo: null })).toBe(false);
  });
});

describe("analyzeInput — one call, everything composed", () => {
  it("sends the photo and the caption together", () => {
    expect(analyzeInput({ caption: "  plus a protein shake ", photo: PHOTO })).toEqual({
      imageDataUrl: PHOTO.dataUrl,
      note: "plus a protein shake",
    });
  });

  it("omits whichever half is missing rather than sending it empty", () => {
    expect(analyzeInput({ caption: "", photo: PHOTO })).toEqual({ imageDataUrl: PHOTO.dataUrl });
    expect("note" in analyzeInput({ caption: "  ", photo: PHOTO })).toBe(false);
    expect(analyzeInput({ caption: "rice", photo: null })).toEqual({ note: "rice" });
    expect("imageDataUrl" in analyzeInput({ caption: "rice", photo: null })).toBe(false);
  });
});

describe("sourceFor", () => {
  it("is a photo estimate whenever a photo went up, caption or not", () => {
    expect(sourceFor(PHOTO)).toBe("photo");
    expect(sourceFor(null)).toBe("text");
  });
});

describe("placeholderFor", () => {
  it("asks for what the photo cannot show once there is one", () => {
    expect(placeholderFor(false)).toBe(PLACEHOLDER_EMPTY);
    expect(placeholderFor(true)).toBe(PLACEHOLDER_WITH_PHOTO);
  });
});

describe("savePayload — meal photos are never persisted", () => {
  const base = {
    slot: "lunch" as const,
    caption: " grilled, no oil ",
    source: "photo" as const,
    confidence: 0.7,
    localDate: null,
    items: ITEMS,
  };

  it("has no image field, by any name", () => {
    const payload = savePayload(base);
    const keys = Object.keys(payload);
    expect(keys.some((k) => /image|photo|dataurl|base64|uri/i.test(k))).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("data:image");
  });

  it("does not carry the photo along even when the caller's object holds it", () => {
    // The composer state is the likeliest thing to be passed in wholesale. A
    // spread inside `savePayload` would write the data URL to the database.
    const leaky = { ...base, photo: PHOTO, imageDataUrl: PHOTO.dataUrl };
    const payload = savePayload(leaky);
    expect(JSON.stringify(payload)).not.toContain("data:image");
    expect("imageDataUrl" in payload).toBe(false);
    expect("photo" in payload).toBe(false);
  });

  it("does not carry an image smuggled onto an item", () => {
    const items = ITEMS.map((i) => ({ ...i, imageDataUrl: PHOTO.dataUrl })) as AnalyzedItem[];
    expect(JSON.stringify(savePayload({ ...base, items }))).not.toContain("data:image");
  });

  it("is exactly the POST /api/meals body", () => {
    expect(savePayload(base)).toEqual({
      slot: "lunch",
      note: "grilled, no oil",
      source: "photo",
      confidence: 0.7,
      items: ITEMS,
    });
  });

  it("sends a date only when the user is back-filling an earlier day", () => {
    expect("localDate" in savePayload(base)).toBe(false);
    expect(savePayload({ ...base, localDate: "2026-10-25" }).localDate).toBe("2026-10-25");
  });
});

describe("logButtonLabel", () => {
  it("reads while busy", () => {
    expect(logButtonLabel(false)).toBe("Log meal");
    expect(logButtonLabel(true)).toBe("Reading…");
  });
});
