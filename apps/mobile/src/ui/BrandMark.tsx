import { Image } from 'expo-image';

// The original Hilads logo (the app icon's artwork, with its own gradient and
// 15/64 corner radius), as an image: never redrawn with text or theme tokens.
const LOGO = require('../../assets/logo/hilads-icon.svg'); // eslint-disable-line @typescript-eslint/no-require-imports

/** The Hilads logo: sm (22) as Hilads' avatar in Hi, md (40) in the app header, lg (52) on the sign-up sheet, auth screens and boot. */
export function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const px = size === 'lg' ? 52 : size === 'sm' ? 22 : 40;
  return (
    <Image source={LOGO} style={{ width: px, height: px }} contentFit="contain"
           accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
  );
}
