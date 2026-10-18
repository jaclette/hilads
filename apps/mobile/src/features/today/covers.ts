/* eslint-disable @typescript-eslint/no-require-imports */
import type { DailyThemeKey } from '@/types';

/**
 * The default cover of the Daily Challenge card per theme (assets/covers,
 * CC0 photos, see SOURCES.txt); a challenge's own cover (back office) replaces it.
 */
export const THEME_COVERS: Record<DailyThemeKey, number> = {
  language:     require('../../../assets/covers/language.jpg'),
  street_food:  require('../../../assets/covers/street_food.jpg'),
  coffee:       require('../../../assets/covers/coffee.jpg'),
  market:       require('../../../assets/covers/market.jpg'),
  night_out:    require('../../../assets/covers/night_out.jpg'),
  neighborhood: require('../../../assets/covers/neighborhood.jpg'),
  traditions:   require('../../../assets/covers/traditions.jpg'),
};
