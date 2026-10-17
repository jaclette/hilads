import type { Ionicons } from '@expo/vector-icons';

/** Stroke icon per vibe (profile card, Settings vibe chips). */
export const VIBE_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  party: 'sparkles-outline', board_games: 'dice-outline', coffee: 'cafe-outline', music: 'headset-outline', food: 'restaurant-outline', chill: 'leaf-outline',
};
