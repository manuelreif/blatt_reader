// Library filter by origin: one group per Google Drive books folder, plus "Sonstige"
// (books opened from the device, or from a folder that is no longer in the list).
export interface LibraryGroup {
  /** folder id, or OTHER */
  key: string
  name: string
  bookIds: Set<string>
}

export const OTHER = 'other'

/**
 * Groups with at least one book, in the order of the folder list. A book from two folders
 * (same file in both) is in both groups.
 */
export function libraryGroups(
  bookIds: readonly string[],
  /** app folder first, then the added ones; one without id yet (before the first sync) is left out */
  folders: readonly { id?: string; name: string }[],
  bySource: ReadonlyMap<string, ReadonlySet<string>>,
): LibraryGroup[] {
  const inLibrary = new Set(bookIds)
  const groups: LibraryGroup[] = []
  const placed = new Set<string>()
  for (const f of folders) {
    if (!f.id) continue
    const ids = new Set([...(bySource.get(f.id) ?? [])].filter(id => inLibrary.has(id)))
    if (!ids.size) continue
    groups.push({ key: f.id, name: f.name, bookIds: ids })
    for (const id of ids) placed.add(id)
  }
  const other = new Set(bookIds.filter(id => !placed.has(id)))
  if (other.size) groups.push({ key: OTHER, name: 'Sonstige', bookIds: other })
  return groups
}
