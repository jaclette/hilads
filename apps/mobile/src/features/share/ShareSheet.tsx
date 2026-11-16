import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { Sheet, SheetTitle } from '@/ui';
import { SharePanel } from './SharePanel';
import type { ShareContent } from './content';

/** The share sheet (SPEC 9.14): the card's preview and the targets. Open while `content` is set. */
export function ShareSheet({ content, source, onClose }: { content: ShareContent | null; source: string; onClose: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  return (
    <Sheet visible={!!content} onClose={onClose} closeLabel={t('back')}>
      <SheetTitle style={styles.title}>{t(content?.type === 'today' ? (content.represent ? 'represent.invite' : 'share.challengeFriend') : 'share.title')}</SheetTitle>
      {content && <SharePanel content={content} source={source} />}
    </Sheet>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  title: { marginBottom: 6 },
});
