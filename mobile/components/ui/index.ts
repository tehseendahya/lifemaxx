/**
 * The design system. Everything a screen needs, in one import:
 *
 *     import { Screen, Card, Label, Stat, Button, NumberPad } from "@/components/ui";
 *
 * These are a port of `src/components/ui.tsx` and `src/app/globals.css`, not a
 * redesign. The user did not complain about how the app looks — they complained
 * about how it feels, how many taps it costs and how hard it is to get to. So
 * the colours, radii, type scale and the mono micro-label voice are the web
 * app's, transcribed; what changed is that tap targets grew, dropdowns became
 * sheets, and numbers are typed on a pad instead of a keyboard.
 *
 * ── THE SIX RULES ──────────────────────────────────────────────────────────
 *
 * 1. EVERY NUMBER RENDERS WITH TABULAR NUMERALS. Spread `...tnum` into the
 *    style, or use a component that already does (`Stat`, `Pill`, `MacroBar`,
 *    `NumberPad`). A column of weights that twitches sideways as it updates is
 *    the most visible possible regression from the web app.
 *
 * 2. MICRO-LABELS ARE `<Label>`, never an ad-hoc styled `Text`. There are a
 *    dozen on a screen and they must all be the same 10pt Menlo at the same
 *    tracking.
 *
 * 3. NO COLOUR LITERALS OUTSIDE `tokens.ts`. If a colour you need is not in
 *    `color`, it is not in `globals.css` either, and the answer is to use one
 *    that is — not to pick a hex. (The two `#000000` backdrops in `Sheet` and
 *    `NumberPad` are the exception: a dimming scrim is not a surface colour.)
 *
 * 4. NO `Alert.alert`, NO `confirm`. Use `<Sheet>`. Nothing the user does on
 *    purpose gets confirmed by a system dialog in a system typeface.
 *
 * 5. NO `TextInput` FOR NUMBERS, EVER — ON A TOUCH SCREEN. Use `<NumberPad>`.
 *    Not one numeric field on the phone opens the system keyboard — that is
 *    the direct fix for the keyboard, tap-latency and layout-displacement
 *    complaints, and a `keyboardType="numeric"` there is a regression.
 *
 *    The laptop is the exception, and the only one: it has a real keyboard,
 *    and making someone click digits on a pad with a mouse is the same
 *    complaint in reverse. So on a wide web window (`useIsWide()`) the pad's
 *    readout is a typed field and the set card's weight and reps are typed
 *    fields. Both are gated on that hook, which is false on every native
 *    render.
 *
 *    A `TextInput` for *text* is fine, and there are nine of them. The rule
 *    was first written as "exactly two places" and that was wrong within a
 *    week, so here is the real list, which is also the test: every one of
 *    these is prose the user composes, never a figure.
 *
 *      exercise search · coach composer · spoken/typed set entry ·
 *      meal note · meal item name · set note · goals · email · password ·
 *      the API base URL
 *
 *    Adding a tenth is a decision, not a violation; adding a numeric one is a
 *    violation.
 *
 * 6. MINIMUM TAP TARGET 44pt (`hit.min`). The primary action in a flow is 56
 *    (`hit.big`) or 72 (`hit.huge`) — `<Button size="lg">` or `size="hero"`.
 *
 * ── AND ONE MORE ───────────────────────────────────────────────────────────
 *
 * No component in this folder fires a haptic. `Button` and `NumberPad` cannot
 * know whether a press saved a set, opened a sheet or cancelled something, and
 * those must not feel alike. Call `tapSelect` / `tapSave` / `tapDone` from
 * `lib/haptics` in your own handler.
 *
 * Nothing here imports from outside `react-native`, `react-native-safe-area-
 * context`, `./tokens` and `@/lib/layout` (the laptop breakpoint, which is
 * itself `react-native` plus arithmetic). Keep it that way: this layer has to
 * be usable from any screen without dragging the API client, the outbox or the
 * query cache into the bundle behind it.
 *
 * ── ON A LAPTOP ────────────────────────────────────────────────────────────
 *
 * The same components serve the laptop browser (`useIsWide()` in
 * `lib/layout.ts`). `Screen` centres its column, `Sheet` and `NumberPad`
 * become centred dialogs, `Overlay` turns a full-screen picker into a panel,
 * and `Columns` puts two stacks of cards side by side. Below the breakpoint,
 * and always on the phone, every one of them renders exactly what it did.
 */

export { Button } from "./Button";
export { Card } from "./Card";
export { Columns } from "./Columns";
/**
 * The chart primitives. Added for the Today dashboard; `features/exercise` and
 * `features/runs` both render a trend as text today and want the same shapes.
 * Built on `react-native-svg`, which was already a dependency.
 */
export { BarSeries, Chart, Sparkline } from "./charts";
export { Empty } from "./Empty";
export { Label, microLabel } from "./Label";
export { MacroBar } from "./MacroBar";
export { NumberPad } from "./NumberPad";
export { Overlay } from "./Overlay";
export { Pill } from "./Pill";
/**
 * A value against a target band. Deliberately not exported from `charts.tsx`:
 * that file forbids status colour ("a line is not a state") and this *is* a
 * state, so it is a meter rather than a chart and the two do not share a file.
 */
export { RangeBar } from "./RangeBar";
export { Screen } from "./Screen";
/**
 * One question, every answer visible, one tap. Lives here rather than beside a
 * feature because two of them need it: the confirmation sheet's RPE and set
 * kind, and the session card's set kind — which is the same pair of flags and
 * had to stop being two independent toggles.
 */
export { Segmented } from "./Segmented";
export type { Segment, SegmentTone } from "./Segmented";
export { Sheet } from "./Sheet";
/**
 * `Sheet`'s height cap, as a pure function of the window and the top inset.
 *
 * Exported because it is part of the contract rather than an implementation
 * detail: a caller whose panel can exceed the cap has to make its scrolling
 * child `flexShrink: 1` (NOT `flex: 1`), and anything laying out against the
 * panel needs the same number the panel used. It was withheld from this barrel
 * in the round that added it, only to avoid two workstreams editing this file
 * at once.
 */
export { SHEET_MIN_HEIGHT, SHEET_TOP_GAP, sheetMaxHeight } from "./sheet-size";
export { Spinner } from "./Spinner";
export { Stat } from "./Stat";
export { Toggle } from "./Toggle";

export { BACKSPACE, MAX_LENGTH, applyKey, displayValue, padKeys } from "./keypad";
export type { PadKey } from "./keypad";

export { SCROLL_BOTTOM_INSET, color, font, hit, radius, space, tnum } from "./tokens";
