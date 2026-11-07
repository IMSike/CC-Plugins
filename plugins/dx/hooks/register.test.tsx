import { expect, mock, test } from 'claude-code/testing'

import { BAND, engine, frameColors, NOTES_PANE, NOW } from './shared/testing'

test('the session start loads every feature', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, true, [{ id: 'a1', type: 'Explore', status: 'running' }], {}, {
    settings: { frameColor: '#58a6ff' },
    notesTab: 'session',
    'notes.session.s1': { text: 'piste en cours', updatedAt: NOW - 1000 },
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
