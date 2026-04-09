import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

// Short-link redirect: https://hilads.live/e/{id} → /event/{id}
export default function ShortEventLink() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  useEffect(() => {
    if (!id) return;
    router.replace(`/event/${id}`);
  }, [id]);

  return null;
}
