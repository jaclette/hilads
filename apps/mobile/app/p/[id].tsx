import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { track } from '@/services/analytics';
import { fetchDailyProof } from '@/api/daily';

// Shared proof link (SPEC 9.14): hilads.live/p/{id} and hilads://p/{id} → the
// proof in its day's sheet. A proof I can't see (in review, removed) → today.
export default function ProofLink() {
  const { id, utm_source: utm } = useLocalSearchParams<{ id: string; utm_source?: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  useEffect(() => {
    track('link_opened', { content_type: 'proof', content_id: id, utm_source: utm ?? null });
    fetchDailyProof(String(id))
      .then(p => router.replace(`/daily/${p.date}?proof=${p.id}&source=link` as never))
      .catch(() => router.replace('/daily/today?source=link' as never));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}><ActivityIndicator color={colors.primary} /></View>;
}
