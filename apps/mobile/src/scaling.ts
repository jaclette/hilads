/**
 * Global responsive down-scaling for narrow phones.
 *
 * The app is authored in fixed dp for a large phone (~448dp / Pixel 8 Pro).
 * dp is the SAME physical size on every device, so on a narrower phone the same
 * layout eats a bigger share of the screen and "looks big" / fits less content
 * (e.g. Pixel 4a is 393dp vs 448dp). The vast majority of sizes are hard-coded
 * `fontSize: 16` etc. across ~300 style blocks, so scaling a shared constant
 * doesn't help - we have to catch them all.
 *
 * The clean way: patch `StyleSheet.create` ONCE, before any component styles are
 * registered, and scale the text + spacing numbers in every style object. This
 * covers hard-coded values and the FontSizes/Spacing constants alike, with no
 * per-file churn.
 *
 * MUST be imported before any module that calls StyleSheet.create - it's the
 * first import in the app entry (index.js). Idempotent (guards against
 * Fast-Refresh re-wrapping) and a no-op on reference-width+ screens.
 */
import { Dimensions, StyleSheet } from 'react-native';

const GUIDELINE_WIDTH = 448; // large-phone reference (Pixel 8 Pro); stays 1.0
const FLOOR = 0.80;          // never shrink below this, even on tiny devices

const { width, height } = Dimensions.get('window');
const shortest = Math.min(width, height); // portrait-safe
export const SCREEN_SCALE = Math.min(1, Math.max(FLOOR, shortest / GUIDELINE_WIDTH));

// Numeric style props to scale. Text metrics + spacing/flow only - NOT width,
// height, borderRadius, or absolute offsets (scaling those would distort avatars,
// icons, cards and pinned layouts).
const SCALE_KEYS = [
  'fontSize', 'lineHeight',
  'padding', 'paddingVertical', 'paddingHorizontal',
  'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'margin', 'marginVertical', 'marginHorizontal',
  'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'gap', 'rowGap', 'columnGap',
] as const;

type AnyStyles = Record<string, Record<string, unknown>>;

function installScaling(): void {
  const create = StyleSheet.create as unknown as ((s: AnyStyles) => AnyStyles) & { __scaled?: boolean };
  if (SCREEN_SCALE >= 1 || create.__scaled) return; // no-op on big screens / already patched

  const original = create.bind(StyleSheet) as (s: AnyStyles) => AnyStyles;
  const patched = ((styles: AnyStyles) => {
    for (const name in styles) {
      const rule = styles[name];
      if (rule && typeof rule === 'object') {
        for (const key of SCALE_KEYS) {
          const v = rule[key];
          if (typeof v === 'number') rule[key] = Math.round(v * SCREEN_SCALE);
        }
      }
    }
    return original(styles);
  }) as typeof create;
  patched.__scaled = true;
  (StyleSheet as unknown as { create: unknown }).create = patched;
}

installScaling();
