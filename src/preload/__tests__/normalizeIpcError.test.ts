import { describe, expect, it } from 'vitest'
import { normalizeIpcError } from '../normalizeIpcError'

describe('normalizeIpcError', () => {
  it('strips the generic "Error invoking remote method" prefix', () => {
    const err = new Error("Error invoking remote method 'foundry:listModels': Something broke")
    expect(normalizeIpcError(err).message).toBe('Something broke')
  })

  it('leaves messages without the IPC prefix unchanged', () => {
    const err = new Error('Plain failure')
    expect(normalizeIpcError(err).message).toBe('Plain failure')
  })

  it('converts non-Error values to a string message', () => {
    expect(normalizeIpcError('boom').message).toBe('boom')
    expect(normalizeIpcError(42).message).toBe('42')
  })

  it('replaces the missing-native-binaries error with actionable guidance', () => {
    const err = new Error(
      "Error invoking remote method 'foundry:listModels': FoundryLocalCorePath not specified in configuration and could not auto-discover binaries"
    )
    const result = normalizeIpcError(err)
    expect(result.message).toContain('Foundry Local native libraries are missing')
    expect(result.message).toContain('npm install')
  })

  it('always returns an Error instance', () => {
    expect(normalizeIpcError('x')).toBeInstanceOf(Error)
  })
})
