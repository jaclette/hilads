import { themeColor } from '@/ui/joy';
import type { NotifCategory } from '@/api/notifications';

/**
 * Each notification category's emoji and color (V6): the inbox chips, the row
 * badges, the preferences groups. Colors come from the theme palette (a fill,
 * and a text color that reads on light and dark grounds).
 */
const THEME_OF: Record<NotifCategory, string> = {
  social: 'local_find',   // pink
  game:   'sip',          // gold
  plans:  'get_around',   // blue
  city:   'hidden_gem',   // teal
  hilads: 'night_out',    // indigo
};

export const CATEGORY_EMOJI: Record<NotifCategory, string> = {
  social: '💬', game: '🏆', plans: '📅', city: '👋', hilads: '✨',
};

export function categoryColor(category: NotifCategory, dark: boolean): { fill: string; onFill: string; text: string } {
  const c = themeColor(THEME_OF[category]);
  return { fill: c.fill, onFill: c.onFill, text: dark ? c.textDark : c.textLight };
}
