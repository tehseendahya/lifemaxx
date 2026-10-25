import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File } from "expo-file-system";

import { resizeForLongestEdge } from "./model";

/**
 * Camera → a base64 JPEG data URL, and nothing else.
 *
 * ── THE RULE THIS FILE EXISTS TO ENFORCE ────────────────────────────────────
 *
 * A meal photo is never persisted. Not to the documents directory, not to the
 * photo library, not to a server, not as a thumbnail, not into a react-query
 * cache, not into a log line. The whole app has no object storage precisely so
 * that this layer cannot exist, and `POST /api/meals/analyze` holds the image
 * in memory for one request and drops it.
 *
 * Two files have to be cleaned up, not one. The picker writes the captured
 * photo into the app's cache directory, and `ImageRef.saveAsync` writes the
 * *resized* copy there as well — so a naive implementation leaves two full
 * meal photos on disk per capture, which is exactly the thing that is not
 * supposed to be possible. Both are deleted in a `finally`, so the error path
 * cleans up too.
 *
 * This function never returns a file URI and never logs one. The only thing
 * that escapes it is the data URL, which the caller holds in React state and
 * drops on save or cancel.
 */

/** 1024px at q0.8 lands around 120KB. */
const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.8;

export type CaptureOutcome =
  | { status: "ok"; imageDataUrl: string }
  | { status: "cancelled" }
  | { status: "denied" }
  | { status: "failed"; message: string };

export async function captureMealPhoto(): Promise<CaptureOutcome> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return { status: "denied" };

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    // Quality 1 from the camera, compression applied after the resize. Letting
    // the picker compress first would mean encoding JPEG artifacts at full
    // resolution and then re-encoding them smaller — worse pixels for the same
    // bytes, and the model is reading this.
    quality: 1,
    // No EXIF: it carries a GPS tag and a capture timestamp, neither of which
    // the analysis needs, and the less of it that exists the less there is to
    // accidentally keep.
    exif: false,
    // The resize is ours, so there is nothing for the picker's base64 to do but
    // hold a 4MB string in memory for no reason.
    base64: false,
    // The system camera, with no crop step. A crop is one more screen between
    // the user and a logged meal, and the model does not need the plate
    // centred.
    allowsEditing: false,
  });

  if (result.canceled) return { status: "cancelled" };

  const asset = result.assets[0];
  if (!asset) return { status: "failed", message: "The camera returned no photo." };

  // Everything written to disk during this capture, deleted unconditionally
  // below. The picker's file is already on disk by the time we get here, so it
  // goes in before anything can throw.
  const scratch: string[] = [asset.uri];

  try {
    const resize = resizeForLongestEdge(asset.width, asset.height, MAX_EDGE);

    // The non-deprecated contextual API. `manipulateAsync` still works but is
    // deprecated in SDK 58 in favour of this, and it is the same three calls.
    const context = ImageManipulator.manipulate(asset.uri);
    try {
      if (resize) context.resize(resize);
      const image = await context.renderAsync();
      try {
        const out = await image.saveAsync({
          compress: JPEG_QUALITY,
          format: SaveFormat.JPEG,
          base64: true,
        });
        scratch.push(out.uri);

        if (!out.base64) {
          return { status: "failed", message: "The photo could not be encoded." };
        }
        return { status: "ok", imageDataUrl: `data:image/jpeg;base64,${out.base64}` };
      } finally {
        // Native memory, not JavaScript memory — a decoded 12MP bitmap is tens
        // of megabytes and the GC has no idea it is holding it.
        image.release();
      }
    } finally {
      context.release();
    }
  } finally {
    for (const uri of scratch) discard(uri);
  }
}

/**
 * Delete a temp file, and never let the attempt break a meal log.
 *
 * Guarded on `file://` for two reasons: only a local file can be deleted at
 * all, and on the react-native-web smoke target the picker hands back a
 * `blob:`/`data:` URL while `new File()` warns that expo-file-system has no web
 * implementation. Nothing is logged on failure — not even the URI — because a
 * leftover temp file is a smaller problem than a meal photo's path in a log.
 */
function discard(uri: string): void {
  if (!uri.startsWith("file://")) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    /* Already gone, or not ours to delete. Either way there is nothing to do. */
  }
}
