import assert from 'node:assert/strict'

import { test } from 'vitest'

import { hasWindowsPathPrefix, isChuOwnedVenvDaemon } from './venv-holder-select'

const SCRIPTS = 'C:\\Chu\\venv\\Scripts'

test('matches the hindsight daemon shim (exe under venv Scripts + hindsight cmdline)', () => {
  assert.equal(
    isChuOwnedVenvDaemon(
      'C:\\Chu\\venv\\Scripts\\pythonw.exe',
      'C:\\Chu\\venv\\Scripts\\pythonw.exe -m hindsight_api.main --daemon --idle-timeout 300 --port 9177',
      SCRIPTS
    ),
    true
  )
})

test('Windows path prefix match is ordinal case-insensitive', () => {
  assert.equal(
    isChuOwnedVenvDaemon(
      'c:\\chu\\venv\\scripts\\python.exe',
      'python.exe -m hindsight_api.main --daemon',
      'C:\\Chu\\venv\\Scripts'
    ),
    true
  )
})

test('excludes external venv holders that are not the hindsight daemon', () => {
  // a user terminal running the chu CLI from the venv — must NOT be killed
  assert.equal(isChuOwnedVenvDaemon('C:\\Chu\\venv\\Scripts\\chu.exe', 'chu chat -q "hi"', SCRIPTS), false)
  // an unrelated python script using the venv interpreter
  assert.equal(
    isChuOwnedVenvDaemon('C:\\Chu\\venv\\Scripts\\python.exe', 'python C:\\tools\\import.py', SCRIPTS),
    false
  )
})

test('excludes exes outside the venv even when the cmdline mentions hindsight', () => {
  assert.equal(
    isChuOwnedVenvDaemon('C:\\Other\\pythonw.exe', 'pythonw -m hindsight_api.main --daemon', SCRIPTS),
    false
  )
})

test('prefix boundary: sibling dirs (ScriptsX) do not match', () => {
  assert.equal(hasWindowsPathPrefix('C:\\Chu\\venv\\ScriptsX\\python.exe', SCRIPTS), false)
  assert.equal(hasWindowsPathPrefix('C:\\Chu\\venv\\Scripts\\python.exe', SCRIPTS), true)
})

test('null/undefined fields never match', () => {
  assert.equal(isChuOwnedVenvDaemon(null, 'x', SCRIPTS), false)
  assert.equal(isChuOwnedVenvDaemon('C:\\Chu\\venv\\Scripts\\pythonw.exe', null, SCRIPTS), false)
  assert.equal(isChuOwnedVenvDaemon(undefined, undefined, SCRIPTS), false)
})
