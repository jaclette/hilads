import { Redirect } from 'expo-router';

/**
 * The V1 pinned-places map is replaced by the Map tab (V3-07, SPEC 9.5): old
 * links land there.
 */
export default function DailyPlacesRedirect() {
  return <Redirect href={'/(tabs)/map?source=places_link' as never} />;
}
