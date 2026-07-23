/**
 * OnboardingCarousel - 4-screen first-launch flow.
 *
 *   1. Promise          - "Become local. Anywhere." brand tagline
 *   2. Three tools      - Challenges / Hi now / Hi later
 *   3. Earn your place  - points = how local you've become
 *   4. Invitation       - four CTAs (challenge / Hi now / Hi later / look around)
 *
 * Mounted on first guest entry via showOnboarding in AppContext. Shown
 * once per device - flag persists in AsyncStorage via src/lib/onboarding.
 * The first CTA on screen 4 routes to the Challenges tab; the Hi now /
 * Hi later CTAs both open the 👋 Hi Local feed (the Events tab).
 *
 * Light scroll-paged horizontal carousel - RN native paging, no animation
 * lib. Mirrors the web component in apps/web/src/components/OnboardingCarousel.jsx.
 */

import { useRef, useState, useCallback } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView,
  useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

interface Props {
  visible: boolean;
  city?: string | null;
  onClose: () => void;
}

export function OnboardingCarousel({ visible, city, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);

  const insets   = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router   = useRouter();
  const { t } = useTranslation('common');
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const where = city || t('onboarding.fallbackCity', { defaultValue: 'your city' });
  const SLIDES = 4;
  const last = SLIDES - 1;

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex((prev) => (i !== prev ? i : prev));
  }, [width]);

  const goTo = (i: number) => scrollRef.current?.scrollTo({ x: i * width, animated: true });
  const handleAdvance = () => goTo(Math.min(index + 1, last));

  // Three final CTAs - each closes the modal first (markOnboardingSeen
  // happens in the host effect that calls onClose), then routes.
  const handleTakeChallenge = () => {
    onClose();
    // NOW tab consumes ?filter=challenges on mount and pre-applies the
    // Challenges filter chip. Falls back to default 'all' if missing.
    router.push('/(tabs)/challenges' as never);
  };
  // Hi now / Hi later both land on the 👋 Hi Local feed (Events tab) so a
  // first-time user sees what's happening now/later before anything else.
  const handleHiNow = () => {
    onClose();
    router.push('/(tabs)/events' as never);
  };
  const handleHiLater = () => {
    onClose();
    router.push('/(tabs)/events' as never);
  };
  const handleLookAround = () => onClose();

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <TouchableOpacity
          style={[styles.skip, { top: insets.top + 8 }]}
          onPress={onClose}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.skipText}>{t('onboarding.skip')}</Text>
        </TouchableOpacity>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScroll}
          style={styles.track}
        >
          {/* Screen 1 - promise */}
          <View style={[styles.slide, { width }]}>
            <Text style={styles.emoji}>🌍</Text>
            <Text style={styles.title}>{t('onboarding.slide1.title')}</Text>
            <Text style={styles.body}>{t('onboarding.slide1.body')}</Text>
          </View>

          {/* Screen 2 - three tools */}
          <View style={[styles.slide, { width }]}>
            <Text style={styles.title}>{t('onboarding.slide2.title')}</Text>
            <View style={styles.itemList}>
              <Text style={styles.item}>{t('onboarding.slide2.itemChallenges')}</Text>
              <Text style={styles.item}>{t('onboarding.slide2.itemHangouts')}</Text>
              <Text style={styles.item}>{t('onboarding.slide2.itemEvents')}</Text>
            </View>
          </View>

          {/* Screen 3 - earn your place */}
          <View style={[styles.slide, { width }]}>
            <Text style={styles.emoji}>✨</Text>
            <Text style={styles.title}>{t('onboarding.slide3.title')}</Text>
            <Text style={styles.body}>{t('onboarding.slide3.body', { city: where })}</Text>
          </View>

          {/* Screen 4 - invitation */}
          <View style={[styles.slide, { width }]}>
            <Text style={styles.title}>{t('onboarding.slide4.title')}</Text>
            <View style={styles.ctaStack}>
              <TouchableOpacity style={styles.ctaPrimary} onPress={handleTakeChallenge} activeOpacity={0.85}>
                <Text style={styles.ctaPrimaryText} numberOfLines={2}>
                  {t('onboarding.slide4.ctaChallenge', { city: where })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ctaPrimary} onPress={handleHiNow} activeOpacity={0.85}>
                <Text style={styles.ctaPrimaryText} numberOfLines={2}>
                  {t('onboarding.slide4.ctaHiNow')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ctaPrimary} onPress={handleHiLater} activeOpacity={0.85}>
                <Text style={styles.ctaPrimaryText} numberOfLines={2}>
                  {t('onboarding.slide4.ctaHiLater')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ctaTertiary} onPress={handleLookAround} activeOpacity={0.7}>
                <Text style={styles.ctaTertiaryText} numberOfLines={2}>
                  {t('onboarding.slide4.ctaLookAround')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={styles.dots}>
            {Array.from({ length: SLIDES }).map((_, i) => (
              <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
            ))}
          </View>

          {/* Next button only on screens 1-3. Screen 4's CTAs replace it -
              showing both would clutter the invitation surface. */}
          {index < last && (
            <TouchableOpacity style={styles.nextBtn} onPress={handleAdvance} activeOpacity={0.85}>
              <Text style={styles.nextBtnText}>{t('onboarding.next', { defaultValue: 'Next' })}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  skip: {
    position: 'absolute',
    right: 14,
    zIndex: 2,
    padding: 8,
  },
  skipText: { color: c.muted, fontSize: FontSizes.sm, fontWeight: '700' },

  track: { flex: 1 },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.lg,
  },
  emoji: { fontSize: 72, lineHeight: 80 },
  title: {
    fontSize: FontSizes.xl,
    fontWeight: '800',
    color: c.text,
    textAlign: 'center',
  },
  body: {
    fontSize: FontSizes.md,
    lineHeight: 24,
    color: c.muted,
    textAlign: 'center',
    maxWidth: 340,
  },

  // Screen 2 - three tools list. Items stack vertically, left-aligned for
  // readability inside a centered slide.
  itemList: {
    width: '100%',
    maxWidth: 360,
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  item: {
    fontSize: FontSizes.md,
    lineHeight: 22,
    color: c.text,
    textAlign: 'left',
  },

  // Screen 4 - three vertically-stacked CTAs of roughly equal visual weight
  // (the third is muted to read as "no commitment"). Each opens a different
  // in-app destination so the user lands somewhere actionable.
  ctaStack: {
    width: '100%',
    maxWidth: 340,
    gap: 12,
    marginTop: Spacing.lg,
  },
  ctaPrimary: {
    paddingVertical: 14,
    paddingHorizontal: Spacing.md,
    borderRadius: 14,
    backgroundColor: c.accent,
    alignItems: 'center',
    shadowColor: c.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 4,
  },
  ctaPrimaryText: {
    fontSize: FontSizes.md,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  ctaTertiary: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  ctaTertiaryText: {
    fontSize: FontSizes.sm,
    fontWeight: '600',
    color: c.muted,
    textAlign: 'center',
  },

  footer: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: 16,
  },
  dots: { flexDirection: 'row', gap: 8 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Radius.full,
    backgroundColor: c.border,
  },
  dotActive: {
    width: 22,
    borderRadius: 4,
    backgroundColor: c.accent,
  },

  nextBtn: {
    width: '100%',
    maxWidth: 340,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: c.accent,
    alignItems: 'center',
    shadowColor: c.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  nextBtnText: { fontSize: FontSizes.md, fontWeight: '700', color: '#fff' },
});
