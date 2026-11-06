import { themeColor } from '../joy/Joy'

/** Each notification category's emoji and theme color (V6, as in the app). */
const THEME_OF = { social: 'local_find', game: 'sip', plans: 'get_around', city: 'hidden_gem', hilads: 'night_out' }
export const CATEGORY_EMOJI = { social: '💬', game: '🏆', plans: '📅', city: '👋', hilads: '✨' }
export const categoryColor = (category) => themeColor(THEME_OF[category] ?? 'night_out')
