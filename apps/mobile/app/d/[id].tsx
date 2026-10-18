import { useEffect } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { track } from '@/services/analytics';

// Shared day link (SPEC 9.14): hilads.live/d/{Y-m-d} and hilads://d/{Y-m-d} → that day's sheet.
export default function DayLink() {
  const { id, utm_source: utm } = useLocalSearchParams<{ id: string; utm_source?: string }>();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(id)) ? String(id) : 'today';
  useEffect(() => { track('link_opened', { content_type: 'day', content_id: date, utm_source: utm ?? null }); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Redirect href={`/daily/${date}?source=link` as never} />;
}
