/**
 * The best runs, kept between sessions, each with the route it was driven on.
 *
 * Until this existed nothing outlived a run except the title-menu preferences,
 * so the daily route could be driven but never beaten. The table itself is
 * zx-kit's (`createHighScores`): validation, top-N insertion and the versioned
 * save envelope all live there. What lives here is Ice Haul's policy — what a
 * row carries, and which runs count.
 *
 * A row carries the **seed** because a score means nothing without its road.
 * The seed is the whole route (see `seed.ts`): `?seed=<seed>` replays it, and a
 * daily seed also names its date.
 */
import { createHighScores, insertScore, loadHighScores, type HighScoreEntry } from 'zx-kit'
import { isRouteSeed } from './seed.ts'

/** What a row stores beyond zx-kit's `name` and `score`. */
export interface RunRecordExtra {
  /** The route the score was driven on. */
  seed: number
}

/** One stored run. */
export type RunRecord = HighScoreEntry<RunRecordExtra>

/**
 * The name written on every row.
 *
 * zx-kit's table requires a non-empty name, and Ice Haul has no name entry —
 * one player per browser is the only case there is. A constant keeps the table
 * valid without inventing a screen nobody asked for.
 */
export const DRIVER_NAME = 'DRIVER'

/** Storage namespace: the table lands in `zxkit:iceroads:hiscore`. */
export const HISCORE_KEY = 'iceroads'

const table = createHighScores<RunRecordExtra>({
  key: HISCORE_KEY,
  // A hand-edited or older row without a usable seed is dropped on load,
  // rather than shown as a best run nobody can replay.
  validateExtra: (entry) => isRouteSeed(entry.seed),
})

/** What happened to one finished run. */
export interface RecordOutcome {
  /** True when this run is now the best one stored. A tie is not a new best. */
  newBest: boolean
  /** 1-based place in the table, or `null` when the run did not make it. */
  rank: number | null
  /** The best stored run after this one was considered, or `null` if none. */
  best: RunRecord | null
}

/**
 * Offers a finished run to the table and reports where it landed.
 *
 * A run worth nothing is not stored: a zero after a crash at 200 m is a fact
 * about that run, not a record of it. The same goes for a seed the road would
 * not accept, which can only come from a bug.
 */
export function recordRun(score: number, seed: number): RecordOutcome {
  if (!Number.isFinite(score) || score <= 0 || !isRouteSeed(seed)) {
    return { newBest: false, rank: null, best: bestRun() }
  }
  const result = insertScore(table, { name: DRIVER_NAME, score, seed })
  return {
    newBest: result.rank === 1,
    rank: result.rank,
    best: result.scores[0] ?? null,
  }
}

/** The best stored run, or `null` before the first one. */
export function bestRun(): RunRecord | null {
  return loadHighScores(table)[0] ?? null
}

/** Every stored run, best first. */
export function storedRuns(): RunRecord[] {
  return loadHighScores(table)
}
