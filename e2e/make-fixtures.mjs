// Generates a tiny EPUB and PDF for the end-to-end tests (no dependencies).
import { crc32 } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'generated')

function zipStore(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, content] of files) {
    const data = Buffer.from(content)
    const nameBuf = Buffer.from(name)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

const chapter = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
<head><title>Chapter One</title></head>
<body>
<h1>Chapter One</h1>
<p id="p1">We had a picnic on the bank of the river. The weather was <em>splendid</em>.</p>
<p id="p2">Every estimator has a variance. The unbiased estimator was surprisingly reliable.</p>
<p id="p3">She looked the word up in a dictionary and finally gave up.</p>
</body>
</html>`

const makeEpub = (title, chapterXhtml) => zipStore([
  ['mimetype', 'application/epub+zip'],
  ['META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`],
  ['OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:12345678-1234-1234-1234-123456789abc</dc:identifier>
<dc:title>${title}</dc:title>
<dc:creator>Ada Tester</dc:creator>
<dc:language>en</dc:language>
<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="ch1"/></spine>
</package>`],
  ['OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">Chapter One</a></li></ol></nav></body>
</html>`],
  ['OEBPS/chapter1.xhtml', chapterXhtml],
])

const epub = makeEpub('The Test Book', chapter)
// EPUB with an inline script: must not run (CSP in the production build)
const evil = makeEpub(
  'Scripted Book',
  chapter.replace('</body>', '<script>parent.parent.document.body.dataset.pwned = "yes"</script></body>'),
)

function pdf(lines) {
  const esc = s => s.replace(/[\\()]/g, m => '\\' + m)
  const content = ['BT', '/F1 12 Tf', '72 720 Td', '16 TL']
  lines.forEach((l, i) => content.push(i === 0 ? `(${esc(l)}) Tj` : `T* (${esc(l)}) Tj`))
  content.push('ET')
  const stream = content.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Title (A Statistical Paper) /Author (Ada Tester) >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out))
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const paper = pdf([
  'Abstract. We fit a statis-',
  'tical model to the survey data.',
  'The estimator is consistent under mild assumptions.',
  'Heteroscedasticity was tested with a robust procedure.',
])

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'sample.epub'), epub)
writeFileSync(join(outDir, 'sample.pdf'), paper)
writeFileSync(join(outDir, 'scripted.epub'), evil)
export default () => {}
