import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ListRow } from '@/ui';
import { PRECISIONS, getPhotoPrecision, setPhotoPrecision, type PhotoPrecision } from '@/features/daily/photoLocation';

/**
 * The Photo location row of Settings: where Daily photos show on the Map by default
 * (Exact spot / Neighborhood / City only). Each post can still change it.
 */
export function PhotoLocationRow({ divider }: { divider?: boolean }) {
  const { t } = useTranslation('daily');
  const [value, setValue] = useState<PhotoPrecision | null>(null);
  useEffect(() => { getPhotoPrecision().then(setValue); }, []);
  const change = () => {
    Alert.alert(t('where.settingTitle'), t('where.settingBody'), [
      ...PRECISIONS.map(p => ({
        text: t(`where.${p}`) + (p === value ? ' ✓' : ''),
        onPress: () => { setPhotoPrecision(p); setValue(p); },
      })),
      { text: t('cancel'), style: 'cancel' as const },
    ]);
  };
  return (
    <ListRow icon="images-outline" title={t('where.settingTitle')} value={value ? t(`where.${value}`) : ''}
             divider={divider} onPress={change} />
  );
}
