import { router } from 'expo-router';

/**
 * Back one layer (the navigation rule): the previous screen, else Today. A
 * screen opened from a link or a push with nothing under it goes to Today,
 * never out of the app.
 */
export function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)/today' as never);
}
