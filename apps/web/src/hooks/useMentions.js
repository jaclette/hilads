import { useState, useRef, useEffect, useCallback } from 'react'
import { fetchMentionSuggestions } from '../api'
import { buildMentionsFromText, detectActiveMention } from '../lib/mentions'

/**
 * @mention autocomplete for a chat composer. The host owns `value`/`setValue`
 * and the input ref; this hook detects the active "@query", fetches suggestions,
 * inserts the chosen @username, and builds the stored mention list at send time.
 *
 * Usage:
 *   const m = useMentions({ context, channelId, value, setValue, inputRef })
 *   <input onChange={e => m.onValueChange(e.target.value)} />
 *   <MessageComposer mentionSuggestions={m.suggestions} onMentionSelect={m.selectMention} />
 *   // on send:  const mentions = m.buildAndReset(finalText)
 */
export default function useMentions({ context, channelId, value, setValue, inputRef }) {
  const [suggestions, setSuggestions] = useState([])
  const [query, setQuery] = useState(null)
  const anchorRef   = useRef(0)
  const selectedRef = useRef([]) // [{userId, username}]
  const enabled = !!(context && channelId)

  const onValueChange = useCallback((newValue) => {
    setValue(newValue)
    if (!enabled) return
    const cursor = inputRef?.current?.selectionStart ?? newValue.length
    const found = detectActiveMention(newValue.slice(0, cursor))
    if (found) { anchorRef.current = found.at; setQuery(found.query) }
    else setQuery(null)
  }, [enabled, setValue, inputRef])

  useEffect(() => {
    if (!enabled || query === null) { setSuggestions([]); return }
    const t = setTimeout(async () => {
      setSuggestions(await fetchMentionSuggestions(context, String(channelId), query))
    }, 250)
    return () => clearTimeout(t)
  }, [query, enabled, context, channelId])

  const selectMention = useCallback((s) => {
    const cursor = inputRef?.current?.selectionStart ?? value.length
    const before = value.slice(0, anchorRef.current)
    const after  = value.slice(cursor)
    setValue(before + '@' + s.username + ' ' + after)
    if (!selectedRef.current.some(m => m.userId === s.userId)) {
      selectedRef.current.push({ userId: s.userId, username: s.username })
    }
    setQuery(null); setSuggestions([])
    setTimeout(() => inputRef?.current?.focus(), 0)
  }, [value, setValue, inputRef])

  const buildAndReset = useCallback((finalText) => {
    const built = buildMentionsFromText(finalText, selectedRef.current)
    selectedRef.current = []
    setQuery(null); setSuggestions([])
    return built
  }, [])

  return { suggestions, onValueChange, selectMention, buildAndReset }
}
