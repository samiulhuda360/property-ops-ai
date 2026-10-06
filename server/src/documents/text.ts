// The PDF's text layer, via pdf-parse (v2, pdf.js underneath). Scanned PDFs without a text layer return ''.
import { PDFParse } from 'pdf-parse'

export class PdfError extends Error {}

/** True when the bytes start like a PDF file. */
export function looksLikePdf(data: Uint8Array): boolean {
  return data.length > 4 && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46 // %PDF
}

/** Extracts the text of every page, one line per text row, with the page markers removed. */
export async function pdfText(data: Uint8Array): Promise<string> {
  if (!looksLikePdf(data)) throw new PdfError('The file is not a PDF.')
  // pdf.js takes ownership of the buffer it is given, so it gets a copy.
  const parser = new PDFParse({ data: new Uint8Array(data) })
  try {
    const result = await parser.getText()
    return cleanText(result.text)
  } catch (e) {
    throw new PdfError(`Could not read the PDF: ${e instanceof Error ? e.message : 'unknown error'}`)
  } finally {
    await parser.destroy()
  }
}

/** Normalises whitespace and drops pdf-parse's "-- 1 of 2 --" page separators. */
export function cleanText(text: string): string {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[\t  ]+/g, ' ').trim())
    .filter((l) => l.length > 0 && !/^-- \d+ of \d+ --$/.test(l))
    .join('\n')
}
