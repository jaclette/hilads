// The one-time Saigon re-check decision (App.jsx). Pure, tested in saigonRecheck.test.mjs.
//   identity: the saved city {channelId, how} (how: 'ip' | 'picked' | null = saved before the geo fix)
//   saigonId: Saigon's channel id; geo: the /api/geo answer (or null: no answer in time)
// Returns 'skip' (not eligible: account, already chosen or IP-placed, not Saigon),
// 'stay' (in Vietnam, unknown, a data centre, no answer), 'proposed' (a city abroad: show the switch card)
// or 'picker' (abroad, no Hilads city: open the picker).
export function saigonRecheckOutcome({ identity, saigonId, geo, hasAccount }) {
  if (hasAccount || !identity || identity.how) return 'skip'
  if (String(identity.channelId) !== String(saigonId)) return 'skip'
  const abroad = !!geo?.visitorCountry && geo.visitorCountry !== 'VN'
  if (!abroad) return 'stay'
  const found = (geo.state === 'city_matched' || geo.state === 'country_matched') && geo.channelId
  if (found && String(geo.channelId) !== String(saigonId)) return 'proposed'
  if (geo.state === 'city_unknown' && geo.reason !== 'datacenter') return 'picker'
  return 'stay'
}
