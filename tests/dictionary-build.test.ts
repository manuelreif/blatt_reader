import { describe, expect, it } from 'vitest'
import { keyOf, parseLine, posOf, shardOf } from '../scripts/build-dictionary.mjs'
import { shardOf as clientShardOf } from '../src/dict/dictionary'

describe('Ding parser', () => {
  it('maps English variants to the German part of the same sub-entry', () => {
    const line = 'Abend {m} | Abende {pl} | am Abend :: evening; eve | evenings | in the evening'
    const entries = parseLine(line)
    expect(entries).toContainEqual({ key: 'evening', de: 'Abend {m}', pos: 'noun', rank: 0 })
    expect(entries).toContainEqual({ key: 'eve', de: 'Abend {m}', pos: 'noun', rank: 1 })
    expect(entries).toContainEqual({ key: 'in the evening', de: 'am Abend', pos: '', rank: 10 })
  })
  it('strips "to" from verbs and annotations from keys', () => {
    expect(keyOf('to give sth. up [coll.]', 'verb')).toBe('give sth. up')
    expect(keyOf('estimator (statistics)', 'noun')).toBe('estimator')
    expect(posOf('aufgeben {vt}')).toBe('verb')
  })
  it('ignores comments', () => {
    expect(parseLine('# License :: GPL')).toEqual([])
  })
  it('shards keys the same way as the client', () => {
    for (const k of ['evening', 'x', 'über', '3d model']) expect(shardOf(k)).toBe(clientShardOf(k))
  })
})
