import { describe, it, expect } from 'vitest'
import { formatCurveLabel, formatDangerLabel } from '../topbar.ts'
import { COLS, CURVE_AHEAD_LOOK_M, CURVE_WARN_CURVATURE, ICE_AHEAD_LOOK_M, type Surface } from '../../config.ts'
import type { CurveAhead, DangerAhead } from '../../game/road.ts'

const danger = (over: Partial<DangerAhead> = {}): DangerAhead =>
  ({ surface: 'ice', distanceM: 120, curvature: 0, ...over })

describe('formatDangerLabel', () => {
  it('says what it is and how far off it is', () => {
    expect(formatDangerLabel(danger())).toBe('ICE 120m')
    expect(formatDangerLabel(danger({ surface: 'snow', distanceM: 200 }))).toBe('SNOW 200m')
    expect(formatDangerLabel(danger({ surface: 'mud', distanceM: 45 }))).toBe('MUD 50m')
  })

  it('rounds to 10 m so the readout does not twitch every frame', () => {
    expect(formatDangerLabel(danger({ distanceM: 121 }))).toBe('ICE 120m')
    expect(formatDangerLabel(danger({ distanceM: 124.9 }))).toBe('ICE 120m')
    expect(formatDangerLabel(danger({ distanceM: 126 }))).toBe('ICE 130m')
  })

  it('never shows a negative distance', () => {
    expect(formatDangerLabel(danger({ distanceM: -3 }))).toBe('ICE 0m')
  })

  it('adds a direction arrow only for a bend worth warning about', () => {
    expect(formatDangerLabel(danger({ curvature: CURVE_WARN_CURVATURE - 0.01 }))).toBe('ICE 120m')
    expect(formatDangerLabel(danger({ curvature: CURVE_WARN_CURVATURE }))).toBe('ICE 120m >>')
    expect(formatDangerLabel(danger({ curvature: 2.0 }))).toBe('ICE 120m >>')
  })

  it('points the arrow the way the road turns', () => {
    expect(formatDangerLabel(danger({ curvature: -2.0 }))).toBe('ICE 120m <<')
    expect(formatDangerLabel(danger({ curvature: 2.0 }))).toBe('ICE 120m >>')
  })

  it('says nothing about asphalt', () => {
    expect(formatDangerLabel(danger({ surface: 'asphalt' }))).toBe('')
  })

  it('fits the status bar beside the TIME readout, worst case', () => {
    // TIME mm:ss occupies columns 0-9 and the warning is centred across COLS, so
    // anything wider than COLS - 2*10 runs underneath it. Checked against the
    // real worst case rather than a hand-picked string: every warnable surface,
    // at the furthest distance the look-ahead can report, with an arrow.
    const surfaces: Surface[] = ['snow', 'ice', 'sand', 'mud']
    for (const surface of surfaces) {
      const label = formatDangerLabel(danger({ surface, distanceM: ICE_AHEAD_LOOK_M, curvature: -2 }))
      expect(label.length, `${surface}: "${label}"`).toBeLessThanOrEqual(COLS - 20)
    }
  })
})

describe('formatCurveLabel', () => {
  const curve = (over: Partial<CurveAhead> = {}): CurveAhead =>
    ({ distanceM: 90, curvature: 2.0, ...over })

  it('says how far the bend is and which way it goes', () => {
    expect(formatCurveLabel(curve())).toBe('CURVE 90m >')
    expect(formatCurveLabel(curve({ curvature: -2.0 }))).toBe('CURVE 90m <')
  })

  it('rounds to 10 m like the surface warning', () => {
    expect(formatCurveLabel(curve({ distanceM: 94 }))).toBe('CURVE 90m >')
    expect(formatCurveLabel(curve({ distanceM: 96 }))).toBe('CURVE 100m >')
  })

  it('reads sensibly once you are in the bend', () => {
    expect(formatCurveLabel(curve({ distanceM: 0 }))).toBe('CURVE 0m >')
  })

  it('fits the status bar at the furthest distance it can report', () => {
    // Same 12-column budget as formatDangerLabel — TIME mm:ss owns columns 0-9.
    // This is why the bend gets one chevron and the surface warning gets two.
    const label = formatCurveLabel(curve({ distanceM: CURVE_AHEAD_LOOK_M }))
    expect(label.length, label).toBeLessThanOrEqual(COLS - 20)
  })
})
