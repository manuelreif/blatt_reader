/** cyrb53: fast 53-bit string hash (not cryptographic). */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * Identifies a book file without hashing all of it. Works without
 * crypto.subtle, which is missing on plain-http LAN addresses (phone testing).
 */
export async function fileId(file: Blob & { name?: string }): Promise<string> {
  const CHUNK = 256 * 1024
  const head = new Uint8Array(await file.slice(0, CHUNK).arrayBuffer())
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - CHUNK)).arrayBuffer())
  let s = `${file.size}:`
  for (const b of head) s += String.fromCharCode(b)
  for (const b of tail) s += String.fromCharCode(b)
  return `b${hashString(s)}${hashString(s, 7)}`
}
