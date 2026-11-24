import { expect, test } from 'claude-code/testing'

import { absolutePath, normalizedPath } from './windows-path'

test('network paths are never placed', () => {
  expect(absolutePath('\\\\server\\share', 'C:\\repo', undefined)).toBeUndefined()
  expect(normalizedPath('//server/share')).toBeUndefined()
})

test('paths are placed from the working directory, the home, the drive', () => {
  const cwd = 'C:\\Users\\dev\\repo'
  expect(absolutePath('src/a.ts', cwd, undefined)).toBe('C:\\Users\\dev\\repo\\src\\a.ts')
  expect(absolutePath('./src/../docs/', cwd, undefined)).toBe('C:\\Users\\dev\\repo\\docs')
  expect(absolutePath('~/bin', cwd, 'C:\\Users\\dev')).toBe('C:\\Users\\dev\\bin')
  expect(absolutePath('~/bin', cwd, undefined)).toBeUndefined()
  expect(absolutePath('/tmp/x', cwd, undefined)).toBe('C:\\tmp\\x')
  expect(absolutePath('D:/data/x.csv', cwd, undefined)).toBe('D:\\data\\x.csv')
  // A drive's own working directory is not known.
  expect(absolutePath('D:x.csv', cwd, undefined)).toBeUndefined()
})

test('a drive as Git Bash and WSL write it is that drive', () => {
  const cwd = String.raw`C:\Users\dev\repo`
  expect(absolutePath('/c/Users/dev/a.ts', cwd, undefined)).toBe(String.raw`C:\Users\dev\a.ts`)
  expect(absolutePath('/D/data/../x.csv', cwd, undefined)).toBe(String.raw`D:\x.csv`)
  expect(absolutePath('/mnt/c/Users/dev', cwd, undefined)).toBe(String.raw`C:\Users\dev`)
  // A root folder of one letter's name alone and longer roots are read from
  // the working directory's drive.
  expect(absolutePath('/c', cwd, undefined)).toBe(String.raw`C:\c`)
  expect(absolutePath('/mnt/data/x', cwd, undefined)).toBe(String.raw`C:\mnt\data\x`)
  expect(absolutePath('/cd/x', cwd, undefined)).toBe(String.raw`C:\cd\x`)
})
