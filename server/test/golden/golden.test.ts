import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import type { MatchEvent } from '../../src/engine/events.js'
import { matchEndView, publicView } from '../../src/engine/selectors.js'
import { computeSettlement, settlementBalances } from '../../src/engine/settlement.js'
import type { MatchState } from '../../src/engine/state.js'
import { replayLog, runScenario, type ScenarioRun } from '../../src/sim/replay.js'
import { verifyCommit } from '../helpers/checked.js'
import { GOLDENS } from './scenarios.js'

// Committed files are rewritten only under UPDATE_GOLDEN=1. A normal run never writes.
const UPDATE = process.env.UPDATE_GOLDEN === '1'
const DATA = new URL('./data/', import.meta.url)

const withoutLog = ({ eventLog: _eventLog, ...rest }: MatchState) => rest

function readGolden(file: string): string {
  const url = new URL(file, DATA)
  if (!existsSync(url)) throw new Error(`Missing golden file ${file}. Generate it with: pnpm test:update-golden`)
  return readFileSync(url, 'utf8')
}

for (const { scenario, expected } of GOLDENS) {
  describe(`golden: ${scenario.name}`, () => {
    const logFile = `${scenario.name}.log.ndjson`
    const finalFile = `${scenario.name}.final.json`
    let run: ScenarioRun

    beforeAll(() => {
      run = runScenario(scenario, verifyCommit)
      if (UPDATE) {
        mkdirSync(DATA, { recursive: true })
        writeFileSync(new URL(logFile, DATA), run.state.eventLog.map((event) => JSON.stringify(event)).join('\n') + '\n')
        writeFileSync(new URL(finalFile, DATA), JSON.stringify(withoutLog(run.state), null, 2) + '\n')
      }
    })

    it('resolves with the expected winner, reason, board total and rejections', () => {
      expect(run.state.resolution).toEqual(expected.resolution)
      expect(publicView(run.state).boardTotal).toBe(expected.boardTotal)
      expect(run.rejections.map(({ tick, rejection }) => ({ tick, action: rejection.action, code: rejection.code }))).toEqual(
        expected.rejections,
      )
    })

    it('settles from the log and balances to the credit', () => {
      const settlement = computeSettlement(run.state.eventLog, run.state.config)
      expect(settlement).toEqual({ ok: true, value: expected.settlement })
      expect(settlementBalances(expected.settlement)).toBe(true)
      const { escrowCredits, rakeCredits, dustCredits, lines } = expected.settlement
      const out = lines.reduce((sum, line) => sum + line.refund + line.payout, rakeCredits + dustCredits)
      expect(out).toBe(escrowCredits)
    })

    it('reveals the expected match end', () => {
      expect(matchEndView(run.state)).toEqual(expected.matchEnd)
    })

    it('produces exactly the committed event log', () => {
      const committed: MatchEvent[] = readGolden(logFile)
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(run.state.eventLog).toEqual(committed)
    })

    it('replays the committed log, checking every step, to the committed final state', () => {
      const committed: MatchEvent[] = readGolden(logFile)
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line))
      const replayed = replayLog(committed, verifyCommit)
      if (!replayed.ok) throw new Error(`Replay failed at event ${replayed.error.index}: ${replayed.error.reason}`)
      expect(withoutLog(replayed.value)).toEqual(JSON.parse(readGolden(finalFile)))
      expect(replayed.value).toEqual(run.state)
    })
  })
}
