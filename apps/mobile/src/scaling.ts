/**
 * Global style patch: responsive down-scaling for narrow phones, and the app
 * font (Be Vietnam Pro) on every text style.
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

// Reference width at which scale = 1.0. Tuned to hit these targets:
//   iPhone Pro Max 430dp -> 6% smaller, Medium/Pixel6 411dp -> 10%,
//   Pixel 4a / iPhone 15 Pro 393dp -> 14%, small Androids ~360dp -> ~21-22%.
// (457 is just above the Pixel 8 Pro's 448dp, so the 8 Pro shrinks ~2%.)
const GUIDELINE_WIDTH = 457;
const FLOOR = 0.78;          // never shrink below this, even on tiny devices (~22%)

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

// App font (SPEC 9.11): Be Vietnam Pro, one embedded family per weight (expo-font
// plugin in app.json). Every text style without its own fontFamily gets the
// family matching its fontWeight, and loses fontWeight (Android would otherwise
// fake-bold an already bold family). Styles with a fontFamily (monospace...)
// are left alone.
const FONT_BY_WEIGHT: Record<string, string> = {
  '100': 'BeVietnamPro-Regular', '200': 'BeVietnamPro-Regular', '300': 'BeVietnamPro-Regular',
  '400': 'BeVietnamPro-Regular', normal: 'BeVietnamPro-Regular',
  '500': 'BeVietnamPro-Medium',
  '600': 'BeVietnamPro-SemiBold',
  '700': 'BeVietnamPro-Bold', bold: 'BeVietnamPro-Bold',
  '800': 'BeVietnamPro-ExtraBold', '900': 'BeVietnamPro-ExtraBold',
};

/** The Be Vietnam Pro family for a fontWeight (Regular when unset). */
export function appFont(weight?: string | number): string {
  return FONT_BY_WEIGHT[String(weight ?? '400')] ?? 'BeVietnamPro-Regular';
}

type AnyStyles = Record<string, Record<string, unknown>>;

function applyFont(rule: Record<string, unknown>): void {
  if (rule.fontFamily !== undefined || (rule.fontSize === undefined && rule.fontWeight === undefined)) return;
  rule.fontFamily = appFont(rule.fontWeight as string | undefined);
  delete rule.fontWeight;
}

function installStylePatch(): void {
  const create = StyleSheet.create as unknown as ((s: AnyStyles) => AnyStyles) & { __scaled?: boolean };
  if (create.__scaled) return; // already patched (Fast Refresh)

  const scale = SCREEN_SCALE < 1; // no size change on reference-width+ screens
  const original = create.bind(StyleSheet) as (s: AnyStyles) => AnyStyles;
  const patched = ((styles: AnyStyles) => {
    for (const name in styles) {
      const rule = styles[name];
      if (rule && typeof rule === 'object') {
        if (scale) {
          for (const key of SCALE_KEYS) {
            const v = rule[key];
            if (typeof v === 'number') rule[key] = Math.round(v * SCREEN_SCALE);
          }
        }
        applyFont(rule);
      }
    }
    return original(styles);
  }) as typeof create;
  patched.__scaled = true;
  (StyleSheet as unknown as { create: unknown }).create = patched;
}

installStylePatch();
