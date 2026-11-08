import { expect, mock, test } from 'claude-code/testing'

import { BAND, click, engine, frameColors, NOTES_PANE, NOW, shell, showSettings } from './shared/testing'

test('the session start loads every feature', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, {
    agents: [{ id: 'a1', type: 'Explore', status: 'running' }],
    stored: {
      settings: { frameColor: '#58a6ff' },
      notesTab: 'session',
      'notes.session.s1': { text: 'piste en cours', updatedAt: NOW - 1000 },
    },
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // The band: drawn, in the colors set, with the subagent the activity follows.
  const band = await $.ui.mount(BAND)
  expect(await frameColors(band)).toContain('#58a6ff')
  expect(await band.find({ key: 'crew-a1' })).toBeDefined()
  await band.unmount()

  // The notes: on the last tab shown, its note there.
  const pane = await $.ui.mount(NOTES_PANE)
  expect((await pane.find({ type: 'Text', text: /^ Session $/, in: 'notes:tab-session' }))?.props.inverse).toBe(true)
  expect(await pane.find({ type: 'Text', text: /piste en cours/, in: 'note-session-s1' })).toBeDefined()
  await pane.unmount()
})

test('a feature that fails to start leaves the next ones to start', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { stored: { settings: { frameColor: '#58a6ff' } } })
  // The activity's first write refused: its start fails, before the band's.
  on('state.set', { plugin: 'dx', key: 'activity' }, () => ({ deny: 'refused' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // The band, started after it, drawn all the same.
  const band = await $.ui.mount(BAND)
  expect(await frameColors(band)).toContain('#58a6ff')
  await band.unmount()
})

// A reload of dx while a setting's save is under way, which the settings'
// start waits for: the band starts meanwhile, its snapshot taken.
test("a reload during a setting's save leaves the band to start", async ($, on) => {
  mock.clock(on, { now: NOW })
  let saving = () => {}
  const isSaving = new Promise<void>(resolve => {
    saving = resolve
  })
  let release = () => {}
  const released = new Promise<void>(resolve => {
    release = resolve
  })
  on('store.set', { key: 'settings' }, async (_, e, next) => {
    saving()
    await released
    return next(e)
  })
  let isReloading = false
  let banded = () => {}
  const isBanded = new Promise<void>(resolve => {
    banded = resolve
  })
  on('state.set', { plugin: 'dx', key: 'statusline' }, (_, e, next) => {
    if (isReloading) banded()
    return next(e)
  })
  engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  const clicked = click(pane, 'settings:show-total')
  await isSaving
  isReloading = true
  const reloaded = $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await isBanded
  release()
  await clicked
  await reloaded
  await pane.unmount()
})

// A feature that fails to start is never silent: the debug log says which and
// why, at the session's start as at a turn's.
test("a feature's failed start is written to the debug log", async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('state.set', { plugin: 'dx', key: 'activity' }, () => ({ deny: 'refused' }))
  on('state.set', { plugin: 'dx', key: 'turn' }, () => ({ deny: 'turn refused' }))
  const logged: { text: string; to?: string }[] = []
  on('ui.log', (_, e) => {
    logged.push(e)

    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })

  const debug = logged.filter(line => line.to === 'debug').map(line => line.text)
  expect(debug.some(text => /^dx : démarrage échoué, activité \(.*refused\)$/.test(text))).toBe(true)
  expect(debug.some(text => /^dx : démarrage échoué, bandeau, tour \(.*turn refused\)$/.test(text))).toBe(true)
})
