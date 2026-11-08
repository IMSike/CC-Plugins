import { expect, test } from 'claude-code/testing'

import { isTab, unsavedFor } from './notes-model'

test('the notes know their three tabs, nothing else', () => {
  expect(isTab('global')).toBe(true)
  expect(isTab('project')).toBe(true)
  expect(isTab('session')).toBe(true)
  expect(isTab('Global')).toBe(false)
  expect(isTab(undefined)).toBe(false)
  expect(isTab(1)).toBe(false)
})

test('a failed save is said with its note alone, or with any when its key was unknown', () => {
  expect(unsavedFor(null, 'notes.global')).toBeNull()
  const global = { key: 'notes.global', reason: 'store : plein' }
  expect(unsavedFor(global, 'notes.global')).toBe('store : plein')
  expect(unsavedFor(global, 'notes.session.s1')).toBeNull()
  const unknown = { key: null, reason: 'notes non chargées' }
  expect(unsavedFor(unknown, 'notes.global')).toBe('notes non chargées')
  expect(unsavedFor(unknown, 'notes.session.s1')).toBe('notes non chargées')
})
