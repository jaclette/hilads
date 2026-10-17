import { Redirect } from 'expo-router';

// V3 (SPEC 9.1 / 9.9): Today is the home for everyone, guests included.
export default function Index() {
  return <Redirect href={"/(tabs)/today" as never} />;
}
