import L from 'leaflet'

// Leaflet bug (Leaflet/Leaflet#6182, Sentry "reading '_leaflet_pos'"): a zoom
// animation ends on a timer, and when the map is removed meanwhile (screen
// closed, map remounted on a new centre) the end handler moves a pane that no
// longer exists. A removed map has no _mapPane: just end the animation.
const onZoomTransitionEnd = L.Map.prototype._onZoomTransitionEnd
if (!onZoomTransitionEnd.__hiladsGuard) {
  L.Map.prototype._onZoomTransitionEnd = function () {
    if (!this._mapPane) { this._animatingZoom = false; return }
    return onZoomTransitionEnd.call(this)
  }
  L.Map.prototype._onZoomTransitionEnd.__hiladsGuard = true
}
