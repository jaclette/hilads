import { useState } from 'react';
import { Modal, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { mediumUrl } from '@/lib/imageThumb';
import { Space, Type } from '@/constants';
import { HalongArt } from './HalongArt';
import type { ContestSeason } from './contest';

type Photo = NonNullable<ContestSeason['photos']>[number];

/**
 * The season's real photos (Admin › Launch Season › Photos) as a full-width pager with page dots,
 * a dark gradient at the bottom for the text on top, the caption and credit. No photo: the
 * illustration. Fixed photo colors in every theme (an image).
 */
export function PrizePhotos({ photos, height, children, zoomable = false }: { photos: Photo[]; height: number; children?: React.ReactNode; zoomable?: boolean }) {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const [full, setFull] = useState<number | null>(null);
  const cur = photos[page];
  return (
    <View style={{ height, width }}>
      {photos.length === 0 ? <HalongArt width={width} height={height} /> : (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={StyleSheet.absoluteFill}
                    onMomentumScrollEnd={e => setPage(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)))}>
          {photos.map((p, i) => (
            <Pressable key={p.url + i} disabled={!zoomable} onPress={() => setFull(i)} accessibilityRole={zoomable ? 'imagebutton' : undefined}
                       accessibilityLabel={p.caption || undefined}>
              <Image source={{ uri: mediumUrl(p.url) ?? p.url }} style={{ width, height }} contentFit="cover" />
            </Pressable>
          ))}
        </ScrollView>
      )}
      <LinearGradient pointerEvents="none" colors={['rgba(12,8,5,0)', 'rgba(12,8,5,0.35)', 'rgba(12,8,5,0.82)']} locations={[0.35, 0.65, 1]}
                      style={StyleSheet.absoluteFill} />
      <View pointerEvents="box-none" style={styles.bottom}>
        {children}
        {photos.length > 1 && (
          <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {photos.map((_, i) => <View key={i} style={[styles.dot, i === page && styles.dotOn]} />)}
          </View>
        )}
        {!!cur && (!!cur.caption || !!cur.credit) && (
          <Text style={styles.credit} numberOfLines={1}>{[cur.caption, cur.credit ? `© ${cur.credit}` : ''].filter(Boolean).join(' · ')}</Text>
        )}
      </View>
      {zoomable && full !== null && <FullGallery photos={photos} start={full} onClose={() => setFull(null)} />}
    </View>
  );
}

/** The photos full screen (a tap on one): swipe between them, caption and credit, ✕ closes. */
function FullGallery({ photos, start, onClose }: { photos: Photo[]; start: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('common');
  const [page, setPage] = useState(start);
  const cur = photos[page];
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.full}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} contentOffset={{ x: start * width, y: 0 }}
                    onMomentumScrollEnd={e => setPage(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)))}>
          {photos.map((p, i) => (
            <Image key={p.url + i} source={{ uri: p.url }} style={{ width, height }} contentFit="contain" accessibilityLabel={p.caption || undefined} />
          ))}
        </ScrollView>
        <Pressable onPress={onClose} style={[styles.fullClose, { top: insets.top + Space.sm }]} accessibilityRole="button" accessibilityLabel={t('close')} hitSlop={8}>
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </Pressable>
        {!!cur && (!!cur.caption || !!cur.credit) && (
          <Text style={[styles.fullCredit, { bottom: insets.bottom + Space.lg }]}>{[cur.caption, cur.credit ? `© ${cur.credit}` : ''].filter(Boolean).join(' · ')}</Text>
        )}
      </View>
    </Modal>
  );
}

/** One cover: the first photo, else the illustration (the Today card's strip, the home's banner). */
export function PrizeCover({ photos, width, height }: { photos?: Photo[]; width: number | string; height: number | string }) {
  const first = photos?.[0];
  return first
    ? <Image source={{ uri: mediumUrl(first.url) ?? first.url }} style={{ width: width as number, height: height as number }} contentFit="cover" />
    : <HalongArt width={width} height={height} />;
}

const styles = StyleSheet.create({
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Space.lg, paddingBottom: Space.md, gap: Space.xs },
  dots:   { flexDirection: 'row', gap: 6, alignSelf: 'center', marginTop: Space.xs },
  dot:    { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.45)' },
  dotOn:  { backgroundColor: '#FFFFFF', width: 18 },
  credit: { ...Type.caption, fontSize: 11, lineHeight: 14, color: 'rgba(255,255,255,0.8)', textAlign: 'center' },
  full:   { flex: 1, backgroundColor: '#000000' },
  fullClose: { position: 'absolute', right: Space.lg, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)',
               alignItems: 'center', justifyContent: 'center' },
  fullCredit: { position: 'absolute', left: Space.lg, right: Space.lg, ...Type.caption, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
});

