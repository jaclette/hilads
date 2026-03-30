import { Redirect } from 'expo-router';
import { useApp } from '@/context/AppContext';

// For returning users, useAppBoot delays setBooting(false) until after setJoined(true).
// By the time this component mounts, joined is already true for returning users, so
// we redirect straight to chat — no intermediate hot-tab flash.
export default function Index() {
  const { joined } = useApp();
  return <Redirect href={joined ? '/(tabs)/chat' : '/(tabs)/hot'} />;
}
