/**
 * Canonical badge metadata for the web app.
 * Mirrors BADGE_META in apps/mobile/src/types/index.ts.
 *
 * Keys match the UserDTO.badges[] values returned by the backend UserResource.
 */
export const BADGE_META = {
  ghost:   { label: '👻 Ghost', color: '#888',    bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.10)' },
  fresh:   { label: '✨ Fresh', color: '#4ade80', bg: 'rgba(74,222,128,0.12)',  border: 'rgba(74,222,128,0.22)'  },
  regular: { label: 'Regular',  color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.22)'  },
  local:   { label: '🌍 Local', color: '#34d399', bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.22)'  },
  host:    { label: '⭐ Host',  color: '#fbbf24', bg: 'rgba(251,191,36,0.15)',  border: 'rgba(251,191,36,0.28)'  },
}

/** Returns the display label for a badge key. */
export function badgeLabel(key) {
  return BADGE_META[key]?.label ?? key
}
