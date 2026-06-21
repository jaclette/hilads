import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet, TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

/**
 * Info-only sheet explaining the challenge scoring schedule. No CTAs -
 * tap the backdrop or pull down to dismiss.
 *
 * Numbers come from score_rules in migrate.php (5 / 30 / 40). If those
 * change, update the i18n labels OR plumb the values from a /scoring
 * endpoint; for now they're constant so hard-coded is fine.
 *
 * Mounted by ScoringInfoButton (NOW + challenge detail share the same
 * surface). All 4 pipeline steps are rendered so the user can map the
 * info row 1:1 against the pipeline they see on the channel screen -
 * the two middle steps just show "-" instead of points.
 */
export function ScoringInfoModal({
  visible, onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('challenge');
  const router = useRouter();

  // Group-model "ways to earn". Numbers mirror score_rules in migrate.php:
  // join +2, challenge_created +10, present +40 (+ host base 10 / 5 per head),
  // submission +5, winner +40. The small sparks (join) stay tiny so farming is
  // never worth it; the big points live behind a real act (showing up / winning).
  const ways: Array<{ icon: string; labelKey: string; points: string; highlight?: boolean }> = [
    { icon: '🙌', labelKey: 'scoringInfo.ways.join',    points: '+2'  },
    { icon: '🎯', labelKey: 'scoringInfo.ways.create',  points: '+10' },
    { icon: '✅', labelKey: 'scoringInfo.ways.present', points: '+40', highlight: true },
    { icon: '👑', labelKey: 'scoringInfo.ways.host',    points: '+10 · 🙋 +5' },
    { icon: '📸', labelKey: 'scoringInfo.ways.submit',  points: '+5'  },
    { icon: '🏆', labelKey: 'scoringInfo.ways.win',     points: '+40', highlight: true },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.title}>{t('scoringInfo.title')}</Text>

          {/* 1 - Two flavours of challenge. Short, emoji-led: the user
              should land on this and instantly know what kind of game
              they're stepping into. */}
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>{t('scoringInfo.types.heading')}</Text>
            <Text style={styles.sectionBody}>{t('scoringInfo.types.local')}</Text>
            <Text style={styles.sectionBody}>{t('scoringInfo.types.international')}</Text>
          </View>

          {/* 2 - Lifecycle reassurance. Explains the per-acceptance chat
              reset we shipped in dd3ff3a3: the challenge persists, the
              conversation doesn't. */}
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>{t('scoringInfo.lifecycle.heading')}</Text>
            <Text style={styles.sectionBody}>{t('scoringInfo.lifecycle.body')}</Text>
          </View>

          {/* 3 - Points breakdown, kept verbatim from the prior modal so
              the numbers in score_rules + the muscle memory of returning
              users both stay intact. */}
          <Text style={styles.sectionHeading}>{t('scoringInfo.pointsHeading')}</Text>
          <Text style={styles.intro}>{t('scoringInfo.intro')}</Text>

          {ways.map((w) => (
            <View key={w.labelKey} style={[styles.row, w.highlight && styles.rowHighlight]}>
              <Text style={styles.rowIcon}>{w.icon}</Text>
              <Text style={[styles.rowLabel, w.highlight && styles.rowLabelHighlight]} numberOfLines={2}>{t(w.labelKey)}</Text>
              <Text style={[styles.rowPoints, w.highlight && styles.rowPointsHighlight]}>{w.points}</Text>
            </View>
          ))}

          <Text style={styles.footnote}>{t('scoringInfo.footnote')}</Text>

          {/* See real examples - opens 3 resolved challenges WITH a who-earned-
              what point breakdown (teaches the scoring, not just a showcase). */}
          <TouchableOpacity
            style={styles.examplesBtn}
            activeOpacity={0.85}
            onPress={() => { onClose(); router.push('/challenge/examples' as never); }}
          >
            <Text style={styles.examplesBtnText}>
              ✨ {t('scoringInfo.seeExamples', { defaultValue: 'See 3 real examples' })} →
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '85%',
    backgroundColor: Colors.bg2,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    paddingBottom: Spacing.xl,
  },
  handle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)', marginTop: 8, marginBottom: 4,
  },
  scrollContent: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, gap: Spacing.sm },

  title:  { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },
  intro:  { fontSize: FontSizes.sm, color: Colors.muted, marginBottom: Spacing.sm },

  // New section blocks above the points table. Light card-ish styling
  // so the two intro sections feel distinct from the dense points table
  // without screaming for attention.
  section: {
    backgroundColor:   Colors.bg3,
    borderRadius:      Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   12,
    gap:               6,
    marginTop:         Spacing.xs,
  },
  sectionHeading: {
    fontSize:      FontSizes.md,
    fontWeight:    '800',
    color:         Colors.text,
    letterSpacing: -0.2,
    marginTop:     Spacing.sm,
  },
  sectionBody: {
    fontSize:   FontSizes.sm,
    lineHeight: 20,
    color:      Colors.text,
  },

  headerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    marginTop: 4,
  },
  headerStep: { flex: 1, fontSize: FontSizes.xs, fontWeight: '700', color: Colors.muted2, letterSpacing: 0.3, textTransform: 'uppercase' },
  // PR60 - column widened 64 → 88 so FR "CHALLENGER" (10 chars) fits on a
  // single line. Data cols match so the +5/+30 numbers stay aligned under
  // their header.
  headerCol:  { width: 88, fontSize: FontSizes.xs, fontWeight: '700', color: Colors.muted2, letterSpacing: 0.3, textTransform: 'uppercase', textAlign: 'right' },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8,
  },
  rowIcon:   { width: 26, fontSize: 16 },
  rowLabel:  { flex: 1, fontSize: FontSizes.sm, fontWeight: '600', color: Colors.text },
  rowPoints: { width: 88, fontSize: FontSizes.sm, fontWeight: '800', color: '#FF7A3C', textAlign: 'right' },
  rowPointsMuted: { color: Colors.muted2, fontWeight: '600' },
  // Meet bonus - gold-tinted so it reads as the prize (the whole point).
  rowHighlight: {
    backgroundColor:   'rgba(255,201,60,0.10)',
    borderWidth:       1,
    borderColor:       'rgba(255,201,60,0.30)',
    borderRadius:      12,
    paddingHorizontal: 8,
    marginVertical:    2,
  },
  rowLabelHighlight:  { color: '#FFC93C', fontWeight: '800' },
  rowPointsHighlight: { color: '#FFC93C' },

  totalRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10,
    marginTop: 4,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  totalLabel: { flex: 1, fontSize: FontSizes.sm, fontWeight: '800', color: Colors.text },
  totalValue: { width: 88, fontSize: FontSizes.md, fontWeight: '800', color: '#FFC93C', textAlign: 'right' },

  footnote: { marginTop: Spacing.sm, fontSize: FontSizes.xs, color: Colors.muted2, fontStyle: 'italic' },

  examplesBtn: {
    marginTop:       Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius:    Radius.full,
    alignItems:      'center',
    backgroundColor: 'rgba(255,122,60,0.14)',
    borderWidth:     1,
    borderColor:     'rgba(255,122,60,0.45)',
  },
  examplesBtnText: { fontSize: FontSizes.md, fontWeight: '800', color: '#FF7A3C' },
});
