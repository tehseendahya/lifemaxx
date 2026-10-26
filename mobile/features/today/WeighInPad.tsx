import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { NumberPad } from "@/components/ui";
import {
  WEIGHT_UNITS, equivalentLabel, type WeightUnit,
} from "@/components/ui/weight-entry";
import { apiPost } from "@/lib/api";
import { queryKeys } from "@/lib/query";
import { tapError, tapSave, tapSelect } from "@/lib/haptics";
import { weightFromPadIn } from "@/features/settings/model";

/**
 * The bodyweight pad, shared by Today's Weigh-in mark and You's LOG WEIGHT.
 *
 * Moved out of You's `WeighInCard` so the daily mark on Today can open it in
 * place — weighing in is the habit maintenance is built on, and making it a
 * tab switch away from the screen that asks for it was a tap the owner paid
 * every morning.
 *
 * ── COMMITTED BEFORE THE SERVER ANSWERS ────────────────────────────────────
 *
 * The pad closes and `onCommitted` fires on DONE, before the POST returns.
 * Holding the pad open on a spinner would advertise latency on the one write in
 * this app that has none worth showing: `POST /api/weight` upserts on
 * (user, date), so a retry after a lost response overwrites rather than
 * duplicating. If it does fail, `onFailed` lets the caller roll back the figure
 * it showed, and the typed number stays in the pad for a retry.
 *
 * Not the outbox, deliberately: `OutboxKind` is the live session's pipe, and
 * this is a write that happens at home, on wifi, once a morning. A visible
 * error with the number still in the pad is a better retry than a silent queue.
 *
 * ── UNITS ──────────────────────────────────────────────────────────────────
 *
 * The lb/kg toggle relabels, never rescales (see `weight-entry.ts`). The wire
 * stays `{ weightLb }` and storage stays kg — the server converts once.
 */
export function WeighInPad({
  visible,
  onClose,
  onCommitted,
  onFailed,
}: {
  visible: boolean;
  onClose: () => void;
  /** The weight, in lb, the moment DONE accepts it. */
  onCommitted?: (weightLb: number) => void;
  /** The POST failed. The message is ready to show. */
  onFailed?: (message: string) => void;
}) {
  const client = useQueryClient();

  /**
   * The raw pad string. Not cleared when the pad opens — only on a successful
   * save — so a failed save can be retried by reopening the pad with the
   * number still in it.
   */
  const [raw, setRaw] = useState("");
  const [unit, setUnit] = useState<WeightUnit>("lb");
  /** A validation message, shown in the pad's own equivalent line. */
  const [invalid, setInvalid] = useState<string | null>(null);

  function done() {
    const entry = weightFromPadIn(raw, unit);

    if (!entry.ok) {
      // A null reason is an untouched pad: DONE just closes it.
      if (entry.reason === null) { onClose(); return; }
      tapError();
      setInvalid(entry.reason);
      return;
    }

    tapSave();
    setInvalid(null);
    onCommitted?.(entry.weightLb);
    onClose();

    void (async () => {
      try {
        await apiPost("/api/weight", { weightLb: entry.weightLb });
        setRaw("");
        // A weigh-in feeds the TDEE regression and the Today marks, so the
        // whole dashboard can change from this one write.
        await client.invalidateQueries({ queryKey: queryKeys.bootstrap });
      } catch (err) {
        tapError();
        onFailed?.(
          `${err instanceof Error ? err.message : "Could not save that weight."} `
          + "Your number is still in the pad — try again.",
        );
      }
    })();
  }

  const typed = raw === "" ? null : Number(raw);

  return (
    <NumberPad
      visible={visible}
      value={raw}
      label="Bodyweight"
      unit={unit}
      allowDecimal
      units={{
        options: WEIGHT_UNITS,
        value: unit,
        onChange: (next) => {
          tapSelect();
          setInvalid(null);
          // Relabel, never rescale. See `weight-entry.ts`.
          setUnit(next as WeightUnit);
        },
      }}
      equivalent={invalid ?? equivalentLabel(typed, unit)}
      onChange={(next) => { tapSelect(); setInvalid(null); setRaw(next); }}
      onDone={done}
      onCancel={() => { setInvalid(null); onClose(); }}
    />
  );
}
