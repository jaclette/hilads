// node --test apps/web/src/lib/commentLine.test.mjs — every comment notification type, in the UI language
// (the same lines as the push: backend/api tests/PhotoCommentNotifyTest.php keeps them identical).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { commentLine } from './commentLine.js'

const tFor = (locale) => {
  const lines = JSON.parse(readFileSync(new URL(`../i18n/locales/${locale}/notifications.json`, import.meta.url), 'utf8')).photoComment
  return (key, o) => lines[key.replace('photoComment.', '')].replace(/\{\{(\w+)\}\}/g, (_, k) => String(o[k]))
}
const en = tFor('en')
const item = (type, data, count = 1) => ({ type, count, actors: [{ name: 'bigfatbison' }], data: { ownerName: 'Maxime', ...data } })

test('a comment on my photo', () => assert.equal(commentLine(item('photo_comment', { kind: 'author' }), en), '💬 bigfatbison commented on your photo'))
test('a comment on a photo I commented', () => assert.equal(commentLine(item('photo_comment', { kind: 'previous' }), en), "💬 bigfatbison also commented on Maxime's photo"))
test('the author answering on their photo', () => assert.equal(commentLine(item('photo_comment', { kind: 'previous', selfPhoto: true }), en), '💬 bigfatbison replied on their photo'))
test('a reply to my comment', () => assert.equal(commentLine(item('photo_comment', { kind: 'reply' }), en), '↩️ bigfatbison replied to your comment'))
test('a mention', () => assert.equal(commentLine(item('photo_mention', { kind: 'mention' }), en), '👋 bigfatbison mentioned you'))
test('grouped, on Maxime\'s photo', () => assert.equal(commentLine(item('photo_comment', { kind: 'previous' }, 3), en), "💬 bigfatbison and 2 others commented on Maxime's photo"))
test('grouped, one other', () => assert.equal(commentLine(item('photo_comment', { kind: 'previous' }, 2), en), "💬 bigfatbison and 1 other commented on Maxime's photo"))
test('grouped, on my photo', () => assert.equal(commentLine(item('photo_comment', { kind: 'author' }, 3), en), '💬 bigfatbison and 2 others commented on your photo'))
test('French and Vietnamese', () => {
  assert.equal(commentLine(item('photo_comment', { kind: 'previous' }), tFor('fr')), '💬 bigfatbison a aussi commenté la photo de Maxime')
  assert.equal(commentLine(item('photo_comment', { kind: 'reply' }), tFor('vi')), '↩️ bigfatbison đã trả lời bình luận của bạn')
})
test('every locale has every line', () => {
  for (const loc of ['ar', 'de', 'en', 'es', 'fil', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'nl', 'pt-br', 'pt-pt', 'ru', 'th', 'vi', 'zh-hans', 'zh-hant']) {
    const t = tFor(loc)
    for (const [data, count] of [[{ kind: 'author' }, 1], [{ kind: 'previous' }, 1], [{ kind: 'previous', selfPhoto: true }, 1], [{ kind: 'reply' }, 1], [{ kind: 'author' }, 2], [{ kind: 'author' }, 4], [{ kind: 'previous' }, 2], [{ kind: 'previous' }, 4]]) {
      const line = commentLine(item('photo_comment', data, count), t)
      assert.ok(line.includes('bigfatbison') && !line.includes('{{'), `${loc} ${JSON.stringify(data)} ${count}: ${line}`)
    }
  }
})
