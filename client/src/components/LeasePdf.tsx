// The lease PDF rendered page by page with pdf.js, with the sentence a term or risk was read from highlighted on its
// page. Clicking a page pill in the review panel scrolls here and draws the highlight.
import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

export interface Highlight {
  page: number
  quote: string | null
  /** Changes on every click so the same quote can be re-selected. */
  nonce: number
}

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

interface TextItem {
  str: string
  transform: number[]
  width: number
  height: number
}

/** Finds the items of a page's text content that make up a quote (whole, or its longest leading or trailing part). */
function itemsForQuote(items: TextItem[], quote: string): number[] {
  const parts: { start: number; end: number; index: number }[] = []
  let joined = ''
  items.forEach((item, index) => {
    const s = squash(item.str)
    if (!s) return
    const start = joined.length
    joined += (joined ? ' ' : '') + s
    parts.push({ start: start + (start ? 1 : 0), end: joined.length, index })
  })
  const needle = squash(quote)
  if (needle.length < 4) return []
  const min = Math.min(24, needle.length)
  const lengths: number[] = []
  for (let len = needle.length; len > min; len = Math.floor(len * 0.8)) lengths.push(len)
  lengths.push(min)
  for (const fromStart of [true, false]) {
    for (const len of lengths) {
      const part = fromStart ? needle.slice(0, len) : needle.slice(needle.length - len)
      const at = joined.indexOf(part)
      if (at < 0) continue
      const end = at + part.length
      return parts.filter(p => p.end > at && p.start < end).map(p => p.index)
    }
  }
  return []
}

export default function LeasePdf({ blob, highlight }: { blob: Blob | null; highlight: Highlight | null }) {
  const container = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [rects, setRects] = useState<{ page: number; rects: Rect[] }>({ page: 0, rects: [] })
  const [error, setError] = useState<string | null>(null)
  const canvases = useRef<Map<number, HTMLCanvasElement>>(new Map())
  const scales = useRef<Map<number, number>>(new Map())

  // Load the document.
  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setPageCount(0)
    setRects({ page: 0, rects: [] })
    setError(null)
    if (!blob) return
    blob
      .arrayBuffer()
      .then(data => pdfjs.getDocument({ data }).promise)
      .then(d => {
        if (cancelled) {
          d.destroy()
          return
        }
        setDoc(d)
        setPageCount(d.numPages)
      })
      .catch(() => {
        if (!cancelled) setError('The PDF could not be rendered.')
      })
    return () => {
      cancelled = true
    }
  }, [blob])

  // Render every page to its canvas once the document is loaded.
  useEffect(() => {
    if (!doc || !container.current) return
    let cancelled = false
    const width = Math.max(320, container.current.clientWidth - 2)
    ;(async () => {
      for (let n = 1; n <= doc.numPages; n++) {
        if (cancelled) return
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const scale = width / base.width
        scales.current.set(n, scale)
        const viewport = page.getViewport({ scale })
        const canvas = canvases.current.get(n)
        if (!canvas) continue
        const ratio = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        const ctx = canvas.getContext('2d')!
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
        await page.render({ canvasContext: ctx, viewport }).promise
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, pageCount])

  // Highlight the quote on its page and scroll to it.
  useEffect(() => {
    if (!doc || !highlight) return
    let cancelled = false
    ;(async () => {
      const page = await doc.getPage(highlight.page)
      const scale = scales.current.get(highlight.page) ?? 1
      const viewport = page.getViewport({ scale })
      let found: Rect[] = []
      if (highlight.quote) {
        const content = await page.getTextContent()
        const items = (content.items as unknown as Partial<TextItem>[]).filter((i): i is TextItem => typeof i.str === 'string' && Array.isArray(i.transform))
        const indexes = itemsForQuote(items, highlight.quote)
        found = indexes.map(i => {
          const it = items[i]
          const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([it.transform[4], it.transform[5], it.transform[4] + it.width, it.transform[5] + it.height])
          return { left: Math.min(x1, x2), top: Math.min(y1, y2) - 1, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) + 2 }
        })
      }
      if (cancelled) return
      setRects({ page: highlight.page, rects: found })
      const canvas = canvases.current.get(highlight.page)
      if (canvas && container.current) {
        const top = canvas.offsetTop + (found.length ? Math.min(...found.map(r => r.top)) - 120 : 0)
        container.current.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, highlight])

  if (error) return <div className="card text-sm text-red-700">{error}</div>
  return (
    <div ref={container} className="h-[78vh] overflow-y-auto rounded-xl border border-gray-200 bg-gray-100 p-3 space-y-3" data-testid="lease-pdf">
      {!blob && <div className="h-full flex items-center justify-center text-gray-400 text-sm">Loading the PDF...</div>}
      {Array.from({ length: pageCount }, (_, i) => i + 1).map(n => (
        <div key={n} className="relative mx-auto bg-white shadow-sm" style={{ width: 'fit-content' }}>
          <canvas ref={el => { if (el) canvases.current.set(n, el) }} aria-label={`Page ${n}`} />
          {rects.page === n &&
            rects.rects.map((r, i) => (
              <div
                key={i}
                className="absolute pointer-events-none rounded-sm"
                style={{ left: r.left, top: r.top, width: r.width, height: r.height, background: 'rgba(15, 118, 110, 0.28)', outline: '1px solid rgba(15, 118, 110, 0.6)' }}
              />
            ))}
          <span className="absolute bottom-1 right-2 text-[10px] text-gray-400">page {n}</span>
        </div>
      ))}
    </div>
  )
}
