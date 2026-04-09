import { Redirect, useLocalSearchParams } from 'expo-router';

// Short-link redirect: hilads://e/{id} and https://hilads.live/e/{id} → /event/{id}
export default function ShortEventLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return null;
  return <Redirect href={`/event/${id}` as never} />;
}
