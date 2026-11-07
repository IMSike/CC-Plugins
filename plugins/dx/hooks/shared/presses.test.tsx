import { expect, test } from 'claude-code/testing'
import type { ClientProps, ElementConstructor } from 'claude-code'

import { pressBoard } from './presses'

test('a board keeps what each press does under its prefixed key', () => {
  // A Client as plain data: what the board draws, read back.
  const Client = ((props: ClientProps) => props) as unknown as ElementConstructor<ClientProps>
  const { actions, press } = pressBoard<string>(Client, 'notes:')
  const cut = JSON.stringify(press('tab', 'show', [{ text: 'Onglet' }], { bold: true }, 12))
  const whole = JSON.stringify(press('front', undefined, [{ text: 'Devant' }], {}))
  // The press in front does nothing: drawn, not kept.
  expect([...actions]).toEqual([['notes:tab', 'show']])
  expect(cut).toContain('"notes:tab"')
  expect(cut).toContain('"truncate":true')
  expect(whole).toContain('"truncate":false')
})
