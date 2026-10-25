import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform } from "react-native";
import type { LayoutChangeEvent } from "react-native";

/**
 * Whether the user has asked the system to cut animation down.
 *
 * `globals.css` already honours `prefers-reduced-motion` by collapsing every
 * duration to 0.01ms, and the port has to honour the same setting or the native
 * client becomes the one surface that ignores it. Read once and then watched,
 * because it can be toggled while the app is open.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (live) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  return reduced;
}

/**
 * The rise-from-the-bottom animation shared by `NumberPad` and `Sheet`.
 *
 * Hand-animated rather than `<Modal animationType="slide">`, which is the
 * obvious choice and looks wrong here. A transparent modal slides its *whole*
 * content, dimming backdrop included — so a 60%-black full-screen panel travels
 * up the screen as a visible rising edge instead of the backdrop fading while
 * only the panel moves. Driving the two separately is the difference between
 * "an overlay appeared" and "a black rectangle slid up".
 *
 * Both animated properties are `opacity` and `transform`, so this runs entirely
 * on the native driver: it does not stutter while the JS thread is busy writing
 * a set to SQLite, which is exactly when the pad is being dismissed.
 *
 * `mounted` lags `visible` on the way out so the exit animation can finish
 * before the `Modal` unmounts. Callers render nothing while it is false.
 */
export function useSlideIn(visible: boolean) {
  const [mounted, setMounted] = useState(visible);
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;

  /**
   * How far the panel travels, measured rather than guessed.
   *
   * A fixed distance has to be larger than any panel, which makes a short sheet
   * spend the first half of its animation still off-screen — it reads as lag.
   * The fallback is only used for the very first frame of the very first open;
   * after that the measured height is cached for the life of the component.
   */
  const [travel, setTravel] = useState(560);

  const onPanelLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) setTravel((current) => (Math.abs(current - h) > 1 ? h : current));
  }, []);

  useEffect(() => {
    if (visible) setMounted(true);

    const anim = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      // Out faster than in. A dismissal that takes as long as a presentation
      // feels like the app is arguing with you. Both collapse to a single frame
      // when the user has asked for reduced motion — the overlay still appears
      // and still dismisses, it just does not travel.
      duration: reduced ? 0 : visible ? 190 : 140,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      // react-native-web has no native animated module and warns loudly on
      // every open. The web target exists only as a rough visual smoke test,
      // so it falls back to the JS driver rather than filling that console
      // with a warning that does not apply to the real target.
      useNativeDriver: Platform.OS !== "web",
    });

    anim.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });

    return () => anim.stop();
  }, [visible, progress, reduced]);

  return {
    mounted,
    onPanelLayout,
    backdropStyle: {
      opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] }),
    },
    panelStyle: {
      transform: [
        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [travel, 0] }) },
      ],
    },
  };
}
