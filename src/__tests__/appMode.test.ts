import { describe, expect, it } from 'vitest'
import { appModeFromSearch } from '../appMode.ts'

describe('appModeFromSearch', () => {
  it('boots the normal game unless a hidden mode is explicitly requested', () => {
    expect(appModeFromSearch('')).toBe('game')
    expect(appModeFromSearch('?seed=1443866')).toBe('game')
    expect(appModeFromSearch('?audioLab=0')).toBe('game')
    expect(appModeFromSearch('?audioLab=true')).toBe('game')
  })

  it('selects the audio lab only for audioLab=1', () => {
    expect(appModeFromSearch('?audioLab=1')).toBe('audioLab')
    expect(appModeFromSearch('?seed=42&audioLab=1')).toBe('audioLab')
  })

  it('keeps the static traffic matrix ahead of every interactive mode', () => {
    expect(appModeFromSearch('?matrix=1')).toBe('matrix')
    expect(appModeFromSearch('?audioLab=1&matrix=1')).toBe('matrix')
  })
})
