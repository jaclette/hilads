import { useState } from 'react';
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
export function PrizePhotos({ photos, height, children }: { photos: Photo[]; height: number; children?: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const cur = photos[page];
  return (
    <View style={{ height, width }}>
      {photos.length === 0 ? <HalongArt width={width} height={height} /> : (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={StyleSheet.absoluteFill}
                    onMomentumScrollEnd={e => setPage(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)))}>
          {photos.map((p, i) => (
            <Image key={p.url + i} source={{ uri: mediumUrl(p.url) ?? p.url }} style={{ width, height }} contentFit="cover"
                   accessibilityLabel={p.caption || undefined} accessible={!!p.caption} />
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
    </View>
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
});

