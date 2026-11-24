import { expect, test } from 'claude-code/testing'

import { isLinksPluginListed, listLinksCommand } from './herdr-model'

// herdr's list, as `herdr plugin list --json` writes it (herdr 0.9.5).
function listed(...plugins: unknown[]): string {
  return JSON.stringify({ id: 'cli:plugin', result: { plugins, type: 'plugin_list' } })
}
const HANDLER = { action: 'open', id: 'dx-open', pattern: '^dx-open:', title: 'Ouvrir' }

test("herdr's links plugin is found listed, enabled, with its dx-open link handler", () => {
  expect(isLinksPluginListed(listed({ plugin_id: 'imsike.links', enabled: true, link_handlers: [HANDLER] }))).toBe(true)
})

test('absent, disabled, without its handler, or unreadable, it is not found', () => {
  expect(isLinksPluginListed(listed())).toBe(false)
  expect(isLinksPluginListed(listed({ plugin_id: 'gcaudan.explorer', enabled: true, link_handlers: [{ pattern: '^file://' }] }))).toBe(false)
  expect(isLinksPluginListed(listed({ plugin_id: 'imsike.links', enabled: false, link_handlers: [HANDLER] }))).toBe(false)
  expect(isLinksPluginListed(listed({ plugin_id: 'imsike.links', link_handlers: [HANDLER] }))).toBe(false)
  expect(isLinksPluginListed(listed({ plugin_id: 'imsike.links', enabled: true, link_handlers: [] }))).toBe(false)
  expect(isLinksPluginListed(listed({ plugin_id: 'imsike.links', enabled: true }))).toBe(false)
  expect(isLinksPluginListed(listed(null))).toBe(false)
  expect(isLinksPluginListed('herdr: not running')).toBe(false)
  expect(isLinksPluginListed('null')).toBe(false)
})

test('herdr is run by HERDR_BIN_PATH when it is an absolute path with a drive, by its name otherwise', () => {
  const args = ['plugin', 'list', '--plugin', 'imsike.links', '--json']
  expect(listLinksCommand(String.raw`C:\herdr\herdr.exe`)).toEqual([String.raw`C:\herdr\herdr.exe`, ...args])
  expect(listLinksCommand('D:/herdr/herdr.exe')).toEqual(['D:/herdr/herdr.exe', ...args])
  for (const bin of [undefined, '', 'herdr.exe', String.raw`bin\herdr.exe`, String.raw`\\server\share\herdr.exe`, '/usr/bin/herdr', String.raw`C:herdr.exe`]) {
    expect(listLinksCommand(bin)).toEqual(['herdr', ...args])
  }
})
