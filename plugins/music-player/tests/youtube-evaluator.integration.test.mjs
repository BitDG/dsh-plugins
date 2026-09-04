import { describe, expect, it } from 'vitest'
import { IsolatedYoutubeEvaluator } from '../lib/index.js'

describe('isolated YouTube evaluator', () => {
  it('evaluates the reduced YouTube.js script in a permission-limited child', async () => {
    const evaluator = new IsolatedYoutubeEvaluator(3_000)
    await expect(evaluator.evaluate('return { sig: "decoded", n: "normalized" };')).resolves.toEqual({ sig: 'decoded', n: 'normalized' })
  })
})
