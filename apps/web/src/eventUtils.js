export function formatTime(unixTs, timezone) {
  return new Date(unixTs * 1000).toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function getEventStatus(unixTs) {
  const diffMin = (unixTs * 1000 - Date.now()) / 60000
  if (diffMin >= -30 && diffMin <= 15) return 'now'
  if (diffMin > 15 && diffMin <= 60) return 'soon'
  return 'scheduled'
}

export function getTimeLabel(unixTs, timezone) {
  const status = getEventStatus(unixTs)
  if (status === 'now') return '🔥 happening now'
  if (status === 'soon') {
    const diffMin = (unixTs * 1000 - Date.now()) / 60000
    const rounded = Math.max(5, Math.round(diffMin / 5) * 5)
    return `🔥 in ${rounded} min`
  }
  return `🕐 ${formatTime(unixTs, timezone)}`
}
