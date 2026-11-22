import { expect, test } from 'claude-code/testing'

import { configFolder, folderName } from './config-folder'

const HOME = String.raw`C:\Users\dev`
const CWD = String.raw`C:\Users\dev\repo\app`

test("Claude Code's configuration folder is CLAUDE_CONFIG_DIR, else .claude under the home folder", () => {
  expect(configFolder(String.raw`D:\claude-config`, HOME, CWD)).toBe(String.raw`D:\claude-config`)
  expect(configFolder('D:\\claude-config\\', undefined, CWD)).toBe(String.raw`D:\claude-config`)
  expect(configFolder(undefined, HOME, CWD)).toBe(String.raw`C:\Users\dev\.claude`)
  expect(configFolder(undefined, undefined, CWD)).toBeUndefined()
})

test('a configuration folder written with slashes, the Git Bash way, with ~ or relative is made a Windows path', () => {
  expect(configFolder('C:/Users/x/.claude', HOME, CWD)).toBe(String.raw`C:\Users\x\.claude`)
  expect(configFolder('/c/Users/x/.claude/', HOME, CWD)).toBe(String.raw`C:\Users\x\.claude`)
  expect(configFolder('~/.claude-work', HOME, CWD)).toBe(String.raw`C:\Users\dev\.claude-work`)
  expect(configFolder('~/.claude-work', undefined, CWD)).toBeUndefined()
  expect(configFolder('config', HOME, CWD)).toBe(String.raw`C:\Users\dev\repo\app\config`)
  expect(configFolder(String.raw`..\.claude-work`, HOME, CWD)).toBe(String.raw`C:\Users\dev\repo\.claude-work`)
  expect(configFolder(String.raw`\\server\share`, HOME, CWD)).toBeUndefined()
  expect(configFolder('C:claude', HOME, CWD)).toBeUndefined()
})

test('the button names the folder by its last segment', () => {
  expect(folderName(String.raw`C:\Users\dev\.claude`)).toBe('.claude')
  expect(folderName('D:\\claude-config\\')).toBe('claude-config')
  expect(folderName('D:\\')).toBe('D:')
})
