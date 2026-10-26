import { expect, test } from 'claude-code/testing'

import { cliAgentUnder, encodeCommand, outputOf, parsePosixTree, parseWindowsTree, shellOf, tasksDirOf } from './tasks'
import type { Proc } from './tasks'

const proc = (pid: number, ppid: number, name: string, cmd = name): Proc => ({ pid, ppid, name, cmd })

test('a script is encoded as PowerShell takes it: UTF-16LE in base64', () => {
  expect(encodeCommand('a')).toBe('YQA=')
  expect(encodeCommand('ab')).toBe('YQBiAA==')
  expect(encodeCommand('abc')).toBe('YQBiAGMA')
  expect(encodeCommand('é')).toBe('6QA=')
})

test('the Windows listing is read as processes, names in lower case', () => {
  const tree = parseWindowsTree('{"self":10,"procs":[{"p":11,"pp":10,"n":"Bash.exe","c":"bash -c x"},{"p":12,"pp":11,"n":"node.exe","c":null}]}')
  expect(tree.self).toBe(10)
  expect(tree.procs).toEqual([proc(11, 10, 'bash.exe', 'bash -c x'), { pid: 12, ppid: 11, name: 'node.exe', cmd: '' }])
})

test('the POSIX listing keeps the session and what runs under it', () => {
  const tree = parsePosixTree('10\n    1     0 /sbin/init\n   11    10 /bin/bash -c sleep 9\n   12    11 sleep 9\n   20     1 other\n')
  expect(tree.self).toBe(10)
  expect(tree.procs.map(one => one.pid)).toEqual([11, 12])
  expect(tree.procs[0]?.name).toBe('bash')
})

test('a shell is found by the words of its command, whatever rewrote or garbled it', () => {
  const shells = [
    proc(11, 10, 'bash.exe', `bash -c "eval 'npm test'"`),
    proc(12, 10, 'bash.exe', `bash -c "eval 'echo \\"terminal B (sera arr�t�)\\"; rtk ping -n 300 127.0.0.1 > /dev/null'"`),
  ]
  expect(shellOf('echo "terminal B (sera arrêté)"; ping -n 300 127.0.0.1 > /dev/null', shells)?.pid).toBe(12)
  expect(shellOf('npm test', shells)?.pid).toBe(11)
  expect(shellOf('cargo build --release', shells)).toBeUndefined()
  expect(shellOf('ls', shells)).toBeUndefined()
})

test('an agent CLI is told from the processes under a shell', () => {
  const procs = [
    proc(11, 10, 'bash.exe'),
    proc(12, 11, 'claude.exe'),
    proc(21, 10, 'bash.exe'),
    proc(22, 21, 'powershell.exe', String.raw`powershell -File C:\Users\dev\AppData\Local\cursor-agent\cursor-agent.ps1`),
    proc(31, 10, 'bash.exe'),
    proc(32, 31, 'node.exe', 'node server.js'),
  ]
  expect(cliAgentUnder(procs, 11)).toBe('claude')
  expect(cliAgentUnder(procs, 21)).toBe('cursor')
  expect(cliAgentUnder(procs, 31)).toBeUndefined()
})

test('the output file is the one a result names, else the session tasks folder', () => {
  expect(outputOf({ text: String.raw`Output is being written to: C:\Temp\claude\p\s\tasks\b1.output.` }, 'b1')).toBe(String.raw`C:\Temp\claude\p\s\tasks\b1.output`)
  expect(outputOf({ stdout: '' }, 'b1')).toBeUndefined()
  expect(tasksDirOf('C:\\Users\\dev\\AppData\\Local\\Temp\\', String.raw`C:\Users\dev\repo\CC-Plugins`, 's1'))
    .toBe(String.raw`C:\Users\dev\AppData\Local\Temp/claude/C--Users-dev-repo-CC-Plugins/s1/tasks`)
  expect(tasksDirOf('/tmp/', '/home/dev/app', 's1')).toBe('/tmp/claude/-home-dev-app/s1/tasks')
})
