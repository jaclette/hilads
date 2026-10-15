// Broadcast routing: PHP → POST /broadcast/* → the right WebSocket room.
// Starts the real server on a free port (NODE_ENV=test) and talks to it like
// PHP and the apps do. Run: npm test
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { WebSocket } from 'ws'

let server, port

const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)) })
})

before(async () => {
  port = await freePort()
  server = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', WS_INTERNAL_TOKEN: 'test-token' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise((resolve) => server.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve() }))
})

after(() => server.kill())

/** A client that joins one room and records every event it receives. */
async function client(join) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  const events = []
  ws.on('message', (raw) => events.push(JSON.parse(raw)))
  await new Promise((resolve) => ws.on('open', resolve))
  ws.send(JSON.stringify(join))
  await new Promise((r) => setTimeout(r, 50))
  return { ws, events, of: (name) => events.filter((e) => e.event === name) }
}

async function broadcast(path, body, token = 'test-token') {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
    body: JSON.stringify(body),
  })
  await new Promise((r) => setTimeout(r, 50))
  return res.status
}

test('routes every broadcast type to World, city, event and challenge rooms only', async () => {
  const world     = await client({ event: 'joinWorld', sessionId: 's-world' })
  const city      = await client({ event: 'joinRoom', cityId: 20, sessionId: 's-city', nickname: 'Anh' })
  const event     = await client({ event: 'joinEvent', eventId: 'e1e1e1e1e1e1e1e1', sessionId: 's-event' })
  const challenge = await client({ event: 'joinChallenge', challengeId: 'c1c1c1c1c1c1c1c1', sessionId: 's-ch' })
  const all = [world, city, event, challenge]
  const card = { id: 'm1', type: 'system', event: 'daily_proof', payload: { proofId: 'p1' } }

  // newMessage: World card, city message, challenge message
  await broadcast('/broadcast/message', { channelId: 'world', message: card })
  await broadcast('/broadcast/message', { channelId: 20, message: { id: 'm2' } })
  await broadcast('/broadcast/message', { channelId: 'c1c1c1c1c1c1c1c1', message: { id: 'm3' } })
  assert.deepEqual(world.of('newMessage').map((e) => e.message.id), ['m1'])
  assert.deepEqual(world.of('newMessage')[0].message.payload, { proofId: 'p1' }, 'Daily card payload relayed as-is')
  assert.deepEqual(city.of('newMessage').map((e) => e.message.id), ['m2'])
  assert.deepEqual(challenge.of('newMessage').map((e) => e.message.id), ['m3'])
  assert.equal(event.of('newMessage').length, 0)

  // reactionUpdate: World (was dropped), city "city_N", event, challenge (was dropped)
  await broadcast('/broadcast/reaction', { channelId: 'world', messageId: 'm1', reactions: [{ emoji: '🔥', count: 1 }] })
  await broadcast('/broadcast/reaction', { channelId: 'city_20', messageId: 'm2', reactions: [] })
  await broadcast('/broadcast/reaction', { channelId: 'e1e1e1e1e1e1e1e1', messageId: 'm4', reactions: [] })
  await broadcast('/broadcast/reaction', { channelId: 'c1c1c1c1c1c1c1c1', messageId: 'm3', reactions: [] })
  assert.deepEqual(world.of('reactionUpdate').map((e) => [e.channelId, e.messageId]), [['world', 'm1']])
  assert.deepEqual(city.of('reactionUpdate').map((e) => [e.channelId, e.messageId]), [['city_20', 'm2']])
  assert.deepEqual(event.of('reactionUpdate').map((e) => e.messageId), ['m4'])
  assert.deepEqual(challenge.of('reactionUpdate').map((e) => e.messageId), ['m3'])

  // messageEdited / messageDeleted: World card removal (was dropped), city unchanged
  await broadcast('/broadcast/message-edited', { channelId: 20, messageId: 'm2', content: 'edited', editedAt: 1 })
  await broadcast('/broadcast/message-deleted', { channelId: 'world', messageId: 'm1', deletedAt: 2 })
  await broadcast('/broadcast/message-deleted', { channelId: 'c1c1c1c1c1c1c1c1', messageId: 'm3', deletedAt: 3 })
  assert.deepEqual(city.of('messageEdited').map((e) => [e.channelId, e.content]), [[20, 'edited']])
  assert.deepEqual(world.of('messageDeleted').map((e) => [e.channelId, e.messageId]), [['world', 'm1']])
  assert.deepEqual(challenge.of('messageDeleted').map((e) => e.messageId), ['m3'])
  assert.equal(city.of('messageDeleted').length, 0)
  assert.equal(event.of('messageDeleted').length + event.of('messageEdited').length, 0)

  // Unknown room: nobody receives anything, the endpoint still answers 200.
  const before = all.map((c) => c.events.length)
  assert.equal(await broadcast('/broadcast/reaction', { channelId: 'ffffffffffffffff', messageId: 'x', reactions: [] }), 200)
  assert.deepEqual(all.map((c) => c.events.length), before)

  all.forEach((c) => c.ws.close())
})

test('internal endpoints refuse a wrong token', async () => {
  assert.equal(await broadcast('/broadcast/message', { channelId: 'world', message: { id: 'x' } }, 'nope'), 403)
})
