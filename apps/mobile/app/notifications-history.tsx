import { Redirect } from 'expo-router';

/** V6: the full list is the notifications screen itself (older links and pushes land there). */
export default function NotificationsHistoryRedirect() {
  return <Redirect href={'/notifications' as never} />;
}
