import { describe, expect, it } from 'vitest'

import {
  normalizeChuOpenString,
  pathFromChuDeepLink,
  pathFromOpenDeepLink,
  resolveChuOpenPath
} from './chu-open-target'

describe('normalizeChuOpenString', () => {
  it('accepts hash-router paths and strips a leading hash', () => {
    expect(normalizeChuOpenString('/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeChuOpenString('#/index-network/intent/1')).toBe('/index-network/intent/1')
  })

  it('maps plugin-scoped chu:// deep links to the same path', () => {
    expect(normalizeChuOpenString('chu://index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeChuOpenString('chu://index-network/intent/1?focus=true')).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('maps chu://open/… deep links by stripping the open host', () => {
    expect(normalizeChuOpenString('chu://open/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeChuOpenString('chu://open/settings/plugins')).toBe('/settings/plugins')
  })

  it('rejects reserved chu kinds and unsafe paths', () => {
    expect(normalizeChuOpenString('chu://blueprint/morning-brief')).toBeNull()
    expect(normalizeChuOpenString('chu://plugin/install')).toBeNull()
    expect(normalizeChuOpenString('https://example.com/x')).toBeNull()
    expect(normalizeChuOpenString('/../etc/passwd')).toBeNull()
    expect(normalizeChuOpenString('index-network')).toBeNull()
  })
})

describe('resolveChuOpenPath', () => {
  it('merges structured path + params', () => {
    expect(resolveChuOpenPath({ path: '/index-network/intent/1', params: { focus: 'true' } })).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('resolves href the same as a bare string', () => {
    expect(resolveChuOpenPath({ href: 'chu://index-network/intent/1' })).toBe('/index-network/intent/1')
  })
})

describe('pathFromChuDeepLink', () => {
  it('builds the navigate path from a plugin-scoped deep-link payload', () => {
    expect(pathFromChuDeepLink('index-network', 'intent/1')).toBe('/index-network/intent/1')
  })

  it('builds the navigate path from chu://open/… payloads', () => {
    expect(pathFromOpenDeepLink('index-network/intent/1')).toBe('/index-network/intent/1')
    expect(pathFromChuDeepLink('open', 'agent/42')).toBe('/agent/42')
  })

  it('ignores reserved kinds', () => {
    expect(pathFromChuDeepLink('blueprint', 'morning-brief')).toBeNull()
    expect(pathFromChuDeepLink('plugin', 'install')).toBeNull()
  })
})
