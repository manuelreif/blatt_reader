import { describe, expect, it } from 'vitest'
import { libraryGroups, OTHER } from '../src/library/groups'

const sets = (o: Record<string, string[]>) => new Map(Object.entries(o).map(([k, v]) => [k, new Set(v)]))

describe('libraryGroups', () => {
  it('one group per folder with books, the rest under "Sonstige"', () => {
    const groups = libraryGroups(
      ['inbox', 'paper', 'novel', 'local', 'both', 'old'],
      [
        { id: 'app', name: 'Blatt-Reader' },
        { id: 'uni', name: 'Uni' },
        { id: 'empty', name: 'Leer' },
        { name: 'noch ohne id' },
      ],
      // "gone": a folder no longer in the list; "deleted" is not in the library any more
      sets({ app: ['inbox', 'both'], uni: ['paper', 'both', 'deleted'], gone: ['old'] }),
    )
    expect(groups.map(g => [g.key, g.name, [...g.bookIds]])).toEqual([
      ['app', 'Blatt-Reader', ['inbox', 'both']],
      ['uni', 'Uni', ['paper', 'both']],
      [OTHER, 'Sonstige', ['novel', 'local', 'old']],
    ])
  })

  it('no "Sonstige" when every book has a folder', () => {
    expect(libraryGroups(['a'], [{ id: 'app', name: 'A' }], sets({ app: ['a'] })).map(g => g.key)).toEqual(['app'])
  })
})
