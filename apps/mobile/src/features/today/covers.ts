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
  get_around: require('../../../assets/covers/get_around.jpg'),
  local_find: require('../../../assets/covers/local_find.jpg'),
  night_out:  require('../../../assets/covers/night_out.jpg'),
  sip:        require('../../../assets/covers/sip.jpg'),
  only_here:  require('../../../assets/covers/only_here.jpg'),
};

/** Bundled covers of known special days (by id), until one is uploaded on the special. */
export const SPECIAL_COVERS: Record<string, number> = {
  halloween: require('../../../assets/covers/halloween.jpg'),
};

/** The bundled cover of a theme key; a special day: its own when bundled, else its weekday's. */
export function themeCover(key: string | null | undefined, date?: string | null, specialId?: string | null): number | null {
  if (key === 'special') {
    const own = specialId ? SPECIAL_COVERS[specialId.replace(/-\d{4}$/, '')] : undefined;
    return own ?? (date ? THEME_COVERS[defaultThemeFor(date)] : THEME_COVERS.only_here);
  }
  return key && key in THEME_COVERS ? THEME_COVERS[key as DailyThemeKey] : null;
}
