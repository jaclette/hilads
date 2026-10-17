import { Redirect } from 'expo-router';

/**
 * The CHALLENGES tab is gone in V3 (SPEC 9.2 / 9.10): its content lives in
 * Today and Passport. The route stays so old pushes, links and the
 * /challenges universal link land on Today.
 */
export default function ChallengesTab() {
  return <Redirect href={'/(tabs)/today' as never} />;
}
