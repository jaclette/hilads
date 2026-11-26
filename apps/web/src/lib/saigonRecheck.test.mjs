// node --test apps/web/src/lib/saigonRecheck.test.mjs — who gets the one-time Saigon re-check, and what they see.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { saigonRecheckOutcome as o } from './saigonRecheck.js'

const SG = 20
const old = { channelId: SG, how: null }          // saved in Saigon before the fix
const paris = { state: 'city_matched', channelId: 1, city: 'Paris', visitorCountry: 'FR' }

test('a past visitor abroad gets the switch card, never a silent move', () => {
  assert.equal(o({ identity: old, saigonId: SG, geo: paris }), 'proposed')
  assert.equal(o({ identity: old, saigonId: SG, geo: { state: 'country_matched', channelId: 9, city: 'Bordeaux', visitorCountry: 'FR' } }), 'proposed')
})
test('abroad with no Hilads city: the picker', () => {
  assert.equal(o({ identity: old, saigonId: SG, geo: { state: 'city_unknown', reason: 'no_city_in_country', visitorCountry: 'GL' } }), 'picker')
})
test('in Vietnam, unknown country, a data centre or no answer: stays in Saigon', () => {
  assert.equal(o({ identity: old, saigonId: SG, geo: { state: 'city_matched', channelId: SG, visitorCountry: 'VN' } }), 'stay')
  assert.equal(o({ identity: old, saigonId: SG, geo: { state: 'country_matched', channelId: 30, visitorCountry: 'VN' } }), 'stay')
  assert.equal(o({ identity: old, saigonId: SG, geo: { state: 'city_unknown', reason: 'no_country' } }), 'stay')
  assert.equal(o({ identity: old, saigonId: SG, geo: { state: 'city_unknown', reason: 'datacenter', visitorCountry: 'SG' } }), 'stay')
  assert.equal(o({ identity: old, saigonId: SG, geo: null }), 'stay')
})
test('never touched: accounts, a chosen city, an IP-placed city, another city', () => {
  assert.equal(o({ identity: old, saigonId: SG, geo: paris, hasAccount: true }), 'skip')
  assert.equal(o({ identity: { channelId: SG, how: 'picked' }, saigonId: SG, geo: paris }), 'skip')
  assert.equal(o({ identity: { channelId: SG, how: 'ip' }, saigonId: SG, geo: paris }), 'skip')
  assert.equal(o({ identity: { channelId: 5, how: null }, saigonId: SG, geo: paris }), 'skip')
  assert.equal(o({ identity: null, saigonId: SG, geo: paris }), 'skip')
})
