import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Image, FlatList, Dimensions, StyleSheet, TouchableOpacity,
  type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { countryToFlag } from '@/lib/countryFlag';
import { fetchChallengeShowcase, type ShowcaseItem } from '@/api/challenges';
import { ShowcasePreviewSheet } from '@/features/challenges/ShowcasePreviewSheet';
import { Colors, FontSizes, Spacing } from '@/constants';

const TYPE_ICON: Record<string, string> = { food: '🍜', place: '📍', culture: '🎭', help: '🤝' };
const MAX   = 6;
const EVERY = 3000;
const W      = Dimensions.get('window').width - Spacing.md * 2;

/**
 * Hero carousel of recent success challenges at the top of the Challenges tab.
 * Global, proof-first (matches the showcase feed). Auto-advances every 3s,
 * pauses while the user swipes. Tap a slide → the same preview sheet as the
 * full showcase. Hidden entirely when there are no success stories yet.
 */
export function ShowcaseHeroCarousel() {
  const router = useRouter();
  const { t } = useTranslation('challenge');
  const { account } = useApp();

  const [items,   setItems]   = useState<ShowcaseItem[]>([]);
  const [index,   setIndex]   = useState(0);
  const [preview, setPreview] = useState<ShowcaseItem | null>(null);

  const listRef    = useRef<FlatList<ShowcaseItem>>(null);
  const indexRef   = useRef(0);
  const pausedRef  = useRef(false);

  useEffect(() => {
    let alive = true;
    fetchChallengeShowcase({ limit: MAX }).then(res => { if (alive) setItems(res.items); });
    return () => { alive = false; };
  }, []);

  // Auto-advance. Skipped while a finger is down (pausedRef) or with <2 slides.
  useEffect(() => {
    if (items.length < 2) return;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      const next = (indexRef.current + 1) % items.length;
      listRef.current?.scrollToIndex({ index: next, animated: true });
      indexRef.current = next;
      setIndex(next);
    }, EVERY);
    return () => clearInterval(id);
  }, [items.length]);

  const onScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / W);
    indexRef.current = i;
    setIndex(i);
  }, []);

  const openProfile = (userId: string) => {
    if (userId === account?.id) { router.push('/(tabs)/me'); return; }
    if (!canAccessProfile(account)) { router.push('/auth-gate'); return; }
    router.push({ pathname: '/user/[id]', params: { id: userId } });
  };

  const tryChallenge = (it: ShowcaseItem) => {
    setPreview(null);
    if (!account) { router.push('/auth-gate'); return; }
    router.push({ pathname: '/challenge/create', params: { title: it.title, type: it.challenge_type } } as never);
  };

  if (items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.headTitle}>✨ {t('showcase.cta')}</Text>
        <TouchableOpacity onPress={() => router.push('/challenge/showcase' as never)} hitSlop={8}>
          <Text style={styles.seeAll}>{t('seeAll')} ›</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(it) => it.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: W, offset: W * i, index: i })}
        onScrollBeginDrag={() => { pausedRef.current = true; }}
        onScrollEndDrag={() => { pausedRef.current = false; }}
        onMomentumScrollEnd={onScrollEnd}
        renderItem={({ item }) => <Slide item={item} onOpen={() => setPreview(item)} />}
      />

      {items.length > 1 && (
        <View style={styles.dots}>
          {items.map((it, i) => (
            <View key={it.id} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
      )}

      <ShowcasePreviewSheet
        item={preview}
        onClose={() => setPreview(null)}
        onTry={tryChallenge}
        onAvatar={openProfile}
      />
    </View>
  );
}

function Slide({ item, onOpen }: { item: ShowcaseItem; onOpen: () => void }) {
  const { t } = useTranslation('challenge');
  const intl     = item.mode === 'international';
  const icon     = TYPE_ICON[item.challenge_type] ?? '🔥';
  const fromFlag = countryToFlag(item.country);
  const toFlag   = countryToFlag(item.target_country);
  const hasProof = !!item.proof_media_url && item.proof_media_type === 'image';
  const cityLabel = intl
    ? [item.city_name, item.target_city_name].filter(Boolean).join(' → ')
    : item.city_name;

  return (
    <TouchableOpacity style={styles.slide} activeOpacity={0.9} onPress={onOpen}>
      {hasProof ? <Image source={{ uri: item.proof_media_url! }} style={styles.slideImg} resizeMode="cover" /> : null}
      <View style={[styles.slideOverlay, !hasProof && styles.slideOverlayFlat]}>
        <View style={styles.slideTop}>
          <View style={[styles.pill, intl ? styles.pillIntl : styles.pillLocal]}>
            <Text style={styles.pillText}>{intl ? `${fromFlag || '🌐'} → ${toFlag || '🌍'}` : `${fromFlag || '📍'} ${t('showcase.localTag')}`}</Text>
          </View>
          <View style={styles.starPill}>
            <Ionicons name="star" size={11} color="#FFC93C" />
            <Text style={styles.starText}>{item.avg_stars.toFixed(1)}</Text>
          </View>
        </View>
        <View>
          <Text style={styles.slideTitle} numberOfLines={2}>{icon} {item.title}</Text>
          <Text style={styles.slideMeta} numberOfLines={1}>
            {t('showcase.by', { name: item.creator_display_name ?? '?' })}{cityLabel ? ` · ${cityLabel}` : ''}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: Spacing.md, marginBottom: Spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  headTitle: { fontSize: FontSizes.md, fontWeight: '800', color: Colors.text, letterSpacing: -0.2 },
  seeAll: { fontSize: FontSizes.sm, fontWeight: '700', color: '#60a5fa' },

  slide: { width: W, height: 168, borderRadius: 16, overflow: 'hidden', backgroundColor: Colors.bg2 },
  slideImg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  slideOverlay: { flex: 1, justifyContent: 'space-between', padding: 12, backgroundColor: 'rgba(0,0,0,0.34)' },
  slideOverlayFlat: { backgroundColor: 'rgba(255,201,60,0.06)' },
  slideTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillIntl: { backgroundColor: 'rgba(56,189,248,0.85)' },
  pillLocal: { backgroundColor: 'rgba(0,0,0,0.5)' },
  pillText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  starPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  starText: { fontSize: 12, fontWeight: '800', color: '#FFC93C' },
  slideTitle: { fontSize: FontSizes.md, fontWeight: '800', color: '#fff', marginBottom: 3 },
  slideMeta: { fontSize: FontSizes.xs, fontWeight: '600', color: 'rgba(255,255,255,0.82)' },

  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.border },
  dotActive: { backgroundColor: '#FFC93C', width: 18 },
});
