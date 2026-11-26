// node --test apps/web/api/geo.test.mjs — IP → Hilads city (api/_geo-core.mjs) against the live
// city list snapshot (api/_cities.mjs). Never a default city: a visitor is matched to a city near
// them, else to the nearest one in their own country, else gets the city picker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CITIES } from './_cities.mjs'
import { resolveCity, isDatacenter } from './_geo-core.mjs'

const SAIGON = 'Ho Chi Minh City'
const r = (lat, lng, country, org = null) => resolveCity(CITIES, { lat, lng, country, org })

test('French towns far from the big cities get a French city, never Saigon', () => {
  const towns = {
    Bayonne: [43.49, -1.47], 'Clermont-Ferrand': [45.78, 3.08], Dijon: [47.32, 5.04], Limoges: [45.83, 1.26],
    Brest: [48.39, -4.49], Perpignan: [42.70, 2.90], Reims: [49.26, 4.03], Tours: [47.39, 0.69],
    Caen: [49.18, -0.37], Pau: [43.30, -0.37], Gap: [44.56, 6.08], Aurillac: [44.93, 2.44],
  }
  for (const [name, [lat, lng]] of Object.entries(towns)) {
    const res = r(lat, lng, 'FR')
    assert.ok(res.city, `${name}: a city`)
    assert.equal(res.city.co, 'FR', `${name}: a French city (got ${res.city.c}, ${res.city.co})`)
    assert.notEqual(res.city.c, SAIGON, name)
  }
  // Bayonne's nearest Hilads city is Bilbao (Spain): the country fallback stays in France.
  assert.equal(r(43.49, -1.47, 'FR').state, 'country_matched')
})

test('a town within 50 km of a Hilads city matches it (even across a border)', () => {
  assert.equal(r(48.11, -1.68, 'FR').city.c, 'Rennes')
  assert.equal(r(48.11, -1.68, 'FR').state, 'city_matched')
  assert.equal(r(45.90, 6.13, 'FR').city.c, 'Geneva')     // Annecy: 34 km
})

test('the reported visitors resolve to their own city', () => {
  // ipinfo answers for 45.190.220.228, 218.189.136.134, 103.172.85.251
  assert.equal(r(-23.1350, -46.4653, 'BR', 'AS262278 CROSS CONECTION PROVEDOR DE INTERNET LTDA').city.c, 'São Paulo')
  assert.equal(r(22.2783, 114.1747, 'HK', 'AS9304 HGC Global Communications Limited').city.c, 'Hong Kong')
  assert.equal(r(19.0728, 72.8826, 'IN', 'AS138296 Juweriyah Networks Private Limited').city.c, 'Mumbai')
})

test('data centres, VPN exits and bots get the picker', () => {
  // 145.223.148.233: BytePlus (ByteDance cloud) in Singapore
  const bot = r(1.2897, 103.8501, 'SG', 'AS150436 Byteplus Pte. Ltd.')
  assert.equal(bot.state, 'city_unknown')
  assert.equal(bot.reason, 'datacenter')
  for (const org of ['AS16509 Amazon.com, Inc.', 'AS15169 Google LLC', 'AS24940 Hetzner Online GmbH', 'AS14061 DigitalOcean, LLC', 'AS9009 M247 Europe SRL']) {
    assert.ok(isDatacenter(org), org)
  }
  for (const org of ['AS7552 Viettel Group', 'AS3215 Orange S.A.', 'AS12322 Free SAS', 'AS9304 HGC Global Communications Limited', 'AS45899 VNPT Corp']) {
    assert.ok(!isDatacenter(org), org)
  }
})

test('no location, no country, or no Hilads city in the country: the picker', () => {
  assert.equal(r(NaN, NaN, '').reason, 'no_location')
  assert.equal(r(-45, -120, '').reason, 'no_country')                 // mid-Pacific, country unknown
  const empty = ['GL', 'TD', 'NE', 'BT', 'TM', 'KI'].find(cc => !CITIES.some(c => c.co === cc))
  assert.ok(empty, 'a country with no Hilads city to test with')
  assert.equal(r(-45, -120, empty).reason, 'no_city_in_country')
  // A country is known but not the coordinates: its first (most active) Hilads city.
  assert.equal(r(NaN, NaN, 'FR').city.co, 'FR')
})

test('nobody outside Vietnam is sent to Saigon', () => {
  for (const [lat, lng, cc] of [[40.4, -3.7, 'ES'], [52.5, 13.4, 'DE'], [-33.9, 151.2, 'AU'], [35.7, 139.7, 'JP'], [6.5, 3.4, 'NG'], [41.0, 28.9, 'TR'], [21.0, 105.8, 'VN']]) {
    const res = r(lat, lng, cc)
    if (cc !== 'VN') assert.notEqual(res.city?.c, SAIGON, `${cc}`)
  }
})
