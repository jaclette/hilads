import { useEffect } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { track } from '@/services/analytics';

// Shared spot link (SPEC 9.14): hilads.live/s/{id} and hilads://s/{id} → /spot/{id}
export default function SpotLink() {
  const { id, utm_source: utm } = useLocalSearchParams<{ id: string; utm_source?: string }>();
  useEffect(() => { track('link_opened', { content_type: 'spot', content_id: id, utm_source: utm ?? null }); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!id) return null;
  return <Redirect href={`/spot/${id}` as never} />;
}
