/** Renders `text` with the first occurrence of `word` emphasized (or blanked). */
export function Highlighted({ text, word, blank = false }: { text: string; word: string; blank?: boolean }) {
  const i = word ? text.toLowerCase().indexOf(word.toLowerCase()) : -1
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      {blank ? <span className="blank">{'_'.repeat(Math.max(4, Math.min(word.length, 12)))}</span> : <mark>{text.slice(i, i + word.length)}</mark>}
      {text.slice(i + word.length)}
    </>
  )
}
