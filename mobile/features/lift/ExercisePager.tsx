import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import type { ReactNode } from "react";

/**
 * The horizontal pager over today's exercises.
 *
 * This component is the replacement for the web app's exercise `<select>`, and
 * it is the gesture the user asked for by name. Moving between exercises costs
 * one swipe instead of a tap, a scroll through a 35-item list and a second tap.
 *
 * Hand-rolled on gesture-handler and reanimated rather than taken from a pager
 * library, for two reasons that are not about preference: every pager package is
 * a native module and so cannot exist in Expo Go, and `ScrollView` with
 * `pagingEnabled` cannot be driven programmatically and declaratively at the
 * same time without the two fighting — which is exactly what adding an exercise
 * from the picker and then focusing its page needs to do.
 *
 * The drag runs entirely on the UI thread: `offset` is a shared value, the
 * gesture callbacks are worklets, and the only hop back to JavaScript is the
 * single `runOnJS` that commits a page change. That is the difference between a
 * swipe that tracks the thumb and one that stutters behind it while React
 * re-renders a card full of numbers.
 */

/** Snappy rather than bouncy: this is a control, not a toy. */
const SPRING = { damping: 22, stiffness: 220, mass: 0.7 } as const;

/**
 * How far past the end the track can be dragged, as a fraction of the drag.
 * Without it, a swipe at the last page feels like the screen has frozen.
 */
const RUBBER = 0.3;

/**
 * Where a flick is deemed to have been heading. 0.12s of travel at the release
 * velocity, which turns a short fast swipe into a page change without needing
 * to drag halfway across the screen.
 */
const PROJECTION_S = 0.12;

const styles = StyleSheet.create({
  // `overflow: hidden` is what makes this a pager rather than a wide row:
  // the off-screen pages are clipped at the viewport edge instead of spilling
  // over the screen's 16pt gutter.
  viewport: { flex: 1, overflow: "hidden" },
  track: { flex: 1, flexDirection: "row" },
});

export function ExercisePager({
  count,
  page,
  onPageChange,
  renderPage,
}: {
  /** Total pages, including the trailing add-exercise page. */
  count: number;
  page: number;
  onPageChange: (next: number) => void;
  renderPage: (index: number) => ReactNode;
}) {
  const [width, setWidth] = useState(0);

  const offset = useSharedValue(0);
  const dragStart = useSharedValue(0);
  // A UI-thread mirror of `page`. The worklet needs to know whether it is
  // changing pages without reading React state, which it cannot do.
  const current = useSharedValue(0);

  // Follows `page` whenever it moves from JavaScript — adding an exercise and
  // focusing its page, or being pushed back a page when one disappears.
  useEffect(() => {
    current.value = page;
    if (width > 0) offset.value = withSpring(-page * width, SPRING);
  }, [page, width, offset, current]);

  const pan = usePanGesture({
    // Only claim the touch once the movement is clearly sideways. Both numbers
    // exist so a vertical scroll inside a page is not stolen by the pager and a
    // tap on a 72pt button is not read as a one-pixel swipe.
    activeOffsetX: [-20, 20],
    failOffsetY: [-24, 24],

    onBegin: () => {
      "worklet";
      dragStart.value = offset.value;
    },

    onUpdate: (e) => {
      "worklet";
      if (width === 0) return;
      const min = -(count - 1) * width;
      let next = dragStart.value + e.translationX;
      if (next > 0) next *= RUBBER;
      else if (next < min) next = min + (next - min) * RUBBER;
      offset.value = next;
    },

    // `onDeactivate` rather than `onFinalize`: only the deactivate event
    // carries the extended pan data, and without `velocityX` a flick would have
    // to cross half the screen to turn a page.
    onDeactivate: (e) => {
      "worklet";
      if (width === 0) return;

      const projected = offset.value + e.velocityX * PROJECTION_S;
      const target = Math.min(count - 1, Math.max(0, Math.round(-projected / width)));

      offset.value = withSpring(-target * width, SPRING);

      if (target !== current.value) {
        current.value = target;
        runOnJS(onPageChange)(target);
      }
    },
  });

  const trackStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  return (
    <View
      style={styles.viewport}
      onLayout={(e) => {
        const next = e.nativeEvent.layout.width;
        // Guarded: `onLayout` fires on every re-layout, and setting state
        // unconditionally re-renders every page on each one.
        if (next > 0 && next !== width) setWidth(next);
      }}
    >
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.track, { width: width * count }, trackStyle]}>
          {width > 0
            ? Array.from({ length: count }, (_, i) => (
              <View key={i} style={{ width }}>
                {/*
                  Current page ±1 only. Every page holds a card with a
                  suggestion, a stepper row and a pill list, and mounting eight
                  of those makes the first swipe of the session the slowest.
                  One page either side is enough that the neighbour is already
                  laid out before the thumb gets there.
                */}
                {Math.abs(i - page) <= 1 ? renderPage(i) : null}
              </View>
            ))
            : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
