import { Redirect, useLocalSearchParams } from 'expo-router';

// Short-link redirect: hilads://t/{id} and https://hilads.live/t/{id} → /topic/{id}
export default function ShortTopicLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return null;
  return <Redirect href={`/topic/${id}` as never} />;
}
