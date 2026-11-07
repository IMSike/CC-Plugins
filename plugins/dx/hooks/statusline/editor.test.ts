import { expect, test } from 'claude-code/testing'

import { drawn } from './editor'

// An editor showing `text`, having posted `sent` since the hooks drew `given`.
function editor(text: string, given: string, sent: string[] = []) {
  return { text, cursor: text.length, top: 0, active: true, given, sent }
}

test('a redraw of the text drawn already changes nothing', () => {
  const state = editor('abc', 'abc')
  expect(drawn(state, 'abc')).toBe(state)
})

test('a late echo of a key shows no step back', () => {
  // Typed `a`, then `b`: the redraw after `a` comes once `ab` is shown.
  const state = drawn(editor('ab', '', ['a', 'ab']), 'a')
  expect(state.text).toBe('ab')
  expect(state.sent).toEqual(['ab'])
  expect(drawn(state, 'ab')).toMatchObject({ text: 'ab', given: 'ab', sent: [] })
})

test("another session's text is shown, the cursor kept within it", () => {
  const state = drawn(editor('liste de courses', 'liste de courses'), 'pain')
  expect(state).toMatchObject({ text: 'pain', cursor: 4, given: 'pain', sent: [] })
})

test("another session's text wins over keys under way", () => {
  const state = drawn(editor('ab', '', ['a', 'ab']), 'écrit ailleurs')
  expect(state).toMatchObject({ text: 'écrit ailleurs', sent: [] })
})
