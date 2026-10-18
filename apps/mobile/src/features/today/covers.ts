/* eslint-disable @typescript-eslint/no-require-imports */
import type { DailyThemeKey } from '@/types';
import { defaultThemeFor } from '@/features/daily/themes';

/**
 * The default cover of the Daily Challenge card per theme (assets/covers,
 * CC0 photos, see SOURCES.txt). The API's coverUrl wins: the challenge's own,
 * else its special day's, else the theme's cover uploaded in the back office.
 */
export const THEME_COVERS: Record<DailyThemeKey, number> = {
  hidden_gem: require('../../../assets/covers/hidden_gem.jpg'),
  taste:      require('../../../assets/covers/taste.jpg'),
  ask_local:  require('../../../assets/covers/ask_local.jpg'),
  local_find: require('../../../assets/covers/local_find.jpg'),
  night_out:  require('../../../assets/covers/night_out.jpg'),
  sip:        require('../../../assets/covers/sip.jpg'),
  only_here:  require('../../../assets/covers/only_here.jpg'),
};

/** The bundled cover of a theme key; a special day without a cover shows its weekday's. */
export function themeCover(key: string | null | undefined, date?: string | null): number | null {
  if (key === 'special') return date ? THEME_COVERS[defaultThemeFor(date)] : THEME_COVERS.only_here;
  return key && key in THEME_COVERS ? THEME_COVERS[key as DailyThemeKey] : null;
}
