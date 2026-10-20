import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListRow } from '@/ui';
import { MAPS_APP_NAMES, availableMapsApps, chooseMapsApp, getMapsApp, setMapsApp, type MapsApp } from '@/lib/directions';

/**
 * The Directions row of Settings: the maps app the Directions button opens
 * (remembered from the first pick), or "Ask every time". A tap opens the same
 * chooser, plus "Ask every time".
 */
export function DirectionsRow({ divider }: { divider?: boolean }) {
  const { t } = useTranslation('common');
  const [app, setApp] = useState<MapsApp | null>(null);
  useEffect(() => { getMapsApp().then(setApp); }, []);
  const change = async () => {
    const picked = await chooseMapsApp(await availableMapsApps(), t('directions.ask'));
    if (picked === null) return;
    const next = picked === 'extra' ? null : picked;
    await setMapsApp(next);
    setApp(next);
  };
  return (
    <ListRow icon="navigate-outline" title={t('directions.setting')} value={app ? MAPS_APP_NAMES[app] : t('directions.ask')}
             divider={divider} onPress={change} />
  );
}
