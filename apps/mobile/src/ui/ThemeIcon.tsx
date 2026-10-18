import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Stroke icon of each weekly theme (SPEC 8.2, 9.11: no emoji in the interface chrome). */
export const THEME_ICON: Record<string, IconName> = {
  hidden_gem: 'diamond-outline',
  taste:      'restaurant-outline',      // drawn: a bowl with chopsticks
  ask_local:  'chatbubbles-outline',
  local_find: 'bag-handle-outline',
  night_out:  'moon-outline',
  sip:        'cafe-outline',
  only_here:  'location-outline',        // drawn: a map pin with a star
  special:    'sparkles-outline',        // a special day's own icon when known
};

// Drawn on Ionicons' 24-unit grid, same stroke weight.
const DRAWN: Record<string, string[]> = {
  taste: ['M3 11h18', 'M4.2 11a7.8 7.8 0 0 0 15.6 0', 'M9 20.2h6', 'M12.6 8.6l6.8-6', 'M15.6 9l5.9-4.6'],
  only_here: [
    'M12 2.5c-3.9 0-7 3-7 6.8 0 5 7 12.2 7 12.2s7-7.2 7-12.2c0-3.8-3.1-6.8-7-6.8z',
    'M12 6l.85 2.13 2.29.15-1.76 1.47.56 2.22L12 10.75l-1.94 1.22.56-2.22-1.76-1.47 2.29-.15z',
  ],
};

/**
 * A theme's icon: Ionicons, or a drawn one (Taste, Only here). A special day
 * shows its own Ionicons icon (`special`, from the back office). Decorative.
 */
export function ThemeIcon({ theme, size, color, special }: {
  theme: string | null | undefined; size: number; color: string; special?: string | null;
}) {
  const drawn = theme ? DRAWN[theme] : undefined;
  if (drawn) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6}
           strokeLinecap="round" strokeLinejoin="round" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {drawn.map(d => <Path key={d} d={d} />)}
      </Svg>
    );
  }
  const name = theme === 'special' && special ? (special as IconName) : (theme ? THEME_ICON[theme] : undefined) ?? 'pricetag-outline';
  return <Ionicons name={name} size={size} color={color} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}
