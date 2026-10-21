import { useEffect, useRef } from 'react'

// Browser back (the navigation rule, same as the app): every open layer - a
// sheet, a modal, a viewer, a screen over the tabs, another tab than Today -
// owns one history entry. Back closes the top layer only; closing a layer any
// other way (its button, the scrim, Escape) drops its entry, so back never
// skips a layer and never leaves the site while something is open.

let seq = 0
const layers = []   // open layers, oldest first: { id, close }

function onPop(e) {
  const at = e.state?.hlLayer ?? 0
  // Close every layer opened after the entry we landed on, newest first.
  for (let i = layers.length - 1; i >= 0 && layers[i].id > at; i--) {
    const [layer] = layers.splice(i, 1)
    layer.close()
  }
}
if (typeof window !== 'undefined') window.addEventListener('popstate', onPop)

function push(close) {
  const layer = { id: ++seq, close }
  layers.push(layer)
  window.history.pushState({ ...(window.history.state ?? {}), hlLayer: layer.id }, '')
  return layer
}

function drop(layer) {
  const i = layers.indexOf(layer)
  if (i === -1) return   // closed by back: its entry is already gone
  layers.splice(i, 1)
  // Closed in the page: step back over its entry, once this render is done -
  // unless another layer opened meanwhile (one action closing a sheet and
  // opening a screen): then the entry stays, and back closes the new one first.
  const mark = seq
  setTimeout(() => {
    if (seq === mark && window.history.state?.hlLayer === layer.id) window.history.back()
  }, 0)
}

/** One layer: `open` true gives it a history entry; browser back calls `close`. */
export function useBackLayer(open, close) {
  const ref = useRef(close)
  ref.current = close
  useEffect(() => {
    if (!open) return undefined
    const layer = push(() => ref.current())
    return () => drop(layer)
  }, [open])
}

/** A stack of screens (`depth` deep): one entry per screen; browser back calls `closeTop`. */
export function useBackStack(depth, closeTop) {
  const ref = useRef(closeTop)
  ref.current = closeTop
  const mine = useRef([])
  useEffect(() => {
    while (mine.current.length < depth) mine.current.push(push(() => ref.current()))
    while (mine.current.length > depth) drop(mine.current.pop())
  }, [depth])
  useEffect(() => () => { while (mine.current.length) drop(mine.current.pop()) }, [])
}
