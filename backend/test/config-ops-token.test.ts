import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig, resetConfigCache } from '../src/config.js'

const base = { DATABASE_URL: 'postgres://x@localhost/x', NODE_ENV: 'test' } as NodeJS.ProcessEnv

describe('OPS_TOKEN dirapikan', () => {
  afterEach(() => resetConfigCache())

  it.each([
    ['  abc123  ', 'abc123'],
    ['abc123\n', 'abc123'],
    ['"abc123"', 'abc123'],
    ["'abc123'", 'abc123'],
    [' "abc123" ', 'abc123'],
    ['', ''],
  ])('%j → %j', (raw, expected) => {
    resetConfigCache()
    expect(loadConfig({ ...base, OPS_TOKEN: raw }).OPS_TOKEN).toBe(expected)
  })

  it('tanda kutip di tengah token tidak diubah', () => {
    expect(loadConfig({ ...base, OPS_TOKEN: 'ab"c' }).OPS_TOKEN).toBe('ab"c')
  })
})
