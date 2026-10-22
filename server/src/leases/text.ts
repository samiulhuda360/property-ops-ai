// The lease's text layer page by page (pdf-parse v2, pdf.js underneath), so every extracted term can say which page
// it came from. Scanned PDFs without a text layer give pages with empty text.
import { PDFParse } from 'pdf-parse'
import { cleanText, looksLikePdf, PdfError } from '../documents/text'
import type { PageText } from './types'

export async function pdfPages(data: Uint8Array): Promise<PageText[]> {
  if (!looksLikePdf(data)) throw new PdfError('The file is not a PDF.')
  const parser = new PDFParse({ data: new Uint8Array(data) })
  try {
    const result = await parser.getText()
    return result.pages.map((p) => ({ num: p.num, text: cleanText(p.text) }))
  } catch (e) {
    throw new PdfError(`Could not read the PDF: ${e instanceof Error ? e.message : 'unknown error'}`)
  } finally {
    await parser.destroy()
  }
}

/** The whole document as one string, pages separated by a blank line. */
export const joinPages = (pages: PageText[]) => pages.map((p) => p.text).join('\n\n')

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

const HEADING = /^(?:\d+\. )?[A-Z][^.]{0,44}$/

/**
 * The sentence around a match: from the previous full stop or clause heading to the next. `raw` keeps the page
 * text's line breaks (the index must point into it); the result has them replaced by spaces.
 */
export function sentenceAround(raw: string, index: number, length: number): string {
  let start = raw.lastIndexOf('. ', index)
  start = start < 0 ? 0 : start + 2
  // A clause heading on its own line also starts a sentence.
  const NL = String.fromCharCode(10)
  for (let nl = raw.lastIndexOf(NL, index); nl > start; nl = raw.lastIndexOf(NL, nl - 1)) {
    const prev = raw.lastIndexOf(NL, nl - 1)
    if (HEADING.test(raw.slice(prev + 1, nl))) {
      start = nl + 1
      break
    }
  }
  let end = raw.indexOf('. ', index + length)
  end = end < 0 ? raw.length : end + 1
  for (let nl = raw.indexOf(NL, index + length); nl >= 0 && nl < end; nl = raw.indexOf(NL, nl + 1)) {
    const next = raw.indexOf(NL, nl + 1)
    if (HEADING.test(raw.slice(nl + 1, next < 0 ? raw.length : next))) {
      end = nl
      break
    }
  }
  return raw.slice(start, end).split(NL).join(' ').trim().slice(0, 300)
}

/**
 * Finds which page a quoted snippet is on. Whitespace and case are ignored; when the exact quote is not on one page
 * (a sentence can run over a page break, or the model may have shortened it), the longest leading part and then the
 * longest trailing part of it (down to 24 characters) are tried.
 */
export function locateQuote(pages: PageText[], quote: string | null | undefined): { page: number; quote: string } | null {
  if (!quote) return null
  const needle = squash(quote)
  if (needle.length < 4) return null
  const haystacks = pages.map((p) => ({ num: p.num, text: squash(p.text) }))
  const min = Math.min(24, needle.length)
  const lengths: number[] = []
  for (let len = needle.length; len > min; len = Math.floor(len * 0.8)) lengths.push(len)
  lengths.push(min)
  for (const fromStart of [true, false]) {
    for (const len of lengths) {
      const part = fromStart ? needle.slice(0, len) : needle.slice(needle.length - len)
      const hit = haystacks.find((h) => h.text.includes(part))
      if (hit) return { page: hit.num, quote: quote.trim() }
    }
  }
  return null
}
