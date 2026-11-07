import { useEffect, useSyncExternalStore } from 'react'
import { onLayersChange, openLayerCount } from './backLayers'

/**
 * One celebration at a time (as the app's lib/celebrationQueue). The victory
 * popups (the points reward, a group challenge result, the rating prompt) ask
 * for a turn: the first in line shows, the others wait until it closes. Nothing
 * opens while a layer is open (lib/backLayers: a sheet, a modal, a viewer, a
 * screen over the tabs, a tab other than Today) or while something holds the
 * screen (`holdScreen`: the While you were away card arriving).
 */
const listeners = new Set()
let line = []
const holds = new Set()
const shown = new Set()   // on screen: keeps its turn through its own layers (itself, its share)
let version = 0

function emit() { version++; listeners.forEach(fn => fn()) }
function subscribe(fn) {
  listeners.add(fn)
  const off = onLayersChange(fn)
  return () => { listeners.delete(fn); off() }
}

/** Something holds the screen until the returned release. */
export function holdScreen(id) {
  holds.add(id)
  emit()
  return () => { if (holds.delete(id)) emit() }
}

/** True when it's this celebration's turn; leaving the line (wants false, unmount) passes it on. */
export function useCelebrationTurn(id, wants) {
  useEffect(() => {
    if (!wants) return undefined
    if (!line.includes(id)) { line = [...line, id]; emit() }
    return () => { line = line.filter(x => x !== id); shown.delete(id); emit() }
  }, [id, wants])
  useSyncExternalStore(subscribe, () => `${version}:${openLayerCount()}`)
  const turn = !!wants && line[0] === id && (shown.has(id) || (holds.size === 0 && openLayerCount() === 0))
  if (turn) shown.add(id)
  return turn
}
