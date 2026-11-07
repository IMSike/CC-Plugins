import { expect, test } from 'claude-code/testing'

import type { Notes } from '../../types'
import { needsLoad, shownNote } from './notes-load'

const NOTES: Notes = { global: null, project: null, sessions: {}, root: '/repo', session: 's0', id: 's1' }

test('the note shown: the tab, then the session it names, this one by default', () => {
  expect(shownNote(NOTES, { tab: 'global' })).toEqual({ session: 's0', key: 'notes.global' })
  expect(shownNote(NOTES, { tab: 'project', other: 'x' })).toEqual({ session: 's0', key: 'notes.project./repo' })
  expect(shownNote(NOTES, { tab: 'session' })).toEqual({ session: 's0', key: 'notes.session.s0' })
  expect(shownNote(NOTES, { tab: 'session', other: 'x' })).toEqual({ session: 'x', key: 'notes.session.x' })
})

test('notes are read again when not loaded, a failure on a retry alone, or for another session id', () => {
  expect(needsLoad(null, null, undefined, false)).toBe(true)
  expect(needsLoad(null, 'refusé', undefined, false)).toBe(false)
  expect(needsLoad(null, 'refusé', undefined, true)).toBe(true)
  expect(needsLoad(NOTES, null, 's1', true)).toBe(false)
  expect(needsLoad(NOTES, null, 's2', false)).toBe(true)
})
