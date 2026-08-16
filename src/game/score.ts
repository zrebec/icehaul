/**
 * Scoring — what the drive is worth, metre by metre.
 *
 * Delivery used to be the only event that ever moved the score: 5 km of ice,
 * every bend held and every hazard survived, and the number still read 500. So
 * the road pays now, and it pays more for the surfaces that ask more.
 *
 * Points land in whole 100 m blocks rather than per frame. Awarding `dt`-scaled
 * fractions would make the final score depend on the frame rate — a slow
 * machine and a fast one would finish the same route with different numbers,
 * and that is a nasty class of bug to chase later. A block is either crossed or
 * it is not.
 *
 * Each block's payout is rounded to a whole point, which is both what a Spectrum
 * game would do and what the top bar can print: `10 * 1.1` is 11.000000000000002
 * in binary floating point, and a score of `11.000000000000002` on screen is not
 * a rounding error the player would forgive.
 */

import { SCORE_PER_100M, SURFACE_SCORE_MULT } from '../config.ts'
import type { Surface } from './road.ts'

/** Metres per scoring block. */
export const SCORE_BLOCK_M = 100

export interface ScoreState {
  /** Total points so far. */
  points: number
  /** How far along the road has already been paid for (metres). */
  scoredToM: number
}

export function createScore(): ScoreState {
  return { points: 0, scoredToM: 0 }
}

/**
 * Pay out every whole block the truck has crossed since the last call. Returns
 * the points added, so a caller can flash something on a good one.
 *
 * The surface is sampled at the block's midpoint: one block is worth one
 * surface, chosen deterministically, rather than whichever surface happened to
 * be under the wheels on the frame the block ticked over.
 */
export function accrueScore(
  s: ScoreState,
  distanceM: number,
  surfaceAt: (distM: number) => Surface,
): number {
  let gained = 0
  while (s.scoredToM + SCORE_BLOCK_M <= distanceM) {
    const midM = s.scoredToM + SCORE_BLOCK_M / 2
    gained += Math.round(SCORE_PER_100M * SURFACE_SCORE_MULT[surfaceAt(midM)])
    s.scoredToM += SCORE_BLOCK_M
  }
  s.points += gained
  return gained
}

/** Add a lump — a delivery bonus, not something the road paid for. */
export function addScoreBonus(s: ScoreState, points: number): void {
  s.points += points
}
