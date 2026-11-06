import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * V6: the old leaderboard screen became the Ranks tab. Every older link
 * (profile rank rows, the score celebration, links shared in chat) lands on
 * the matching segment: players (or cities), this week (was the month) or all time.
 */
export default function LeaderboardRedirect() {
  const { scope, period } = useLocalSearchParams<{ scope?: string; period?: string }>();
  const tab = scope === 'cities' ? 'cities' : 'players';
  const p = period === 'alltime' ? 'alltime' : 'week';
  const s = scope === 'world' ? 'world' : 'city';
  return <Redirect href={`/ranks?tab=${tab}&period=${p}&scope=${s}` as never} />;
}
