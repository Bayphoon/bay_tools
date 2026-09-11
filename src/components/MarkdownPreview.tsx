import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

interface MarkdownHeading {
  id: string
  label: string
  level: number
  line: number
}

export interface MarkdownPreviewHandle {
  scrollToSourceLine(line: number): void
}

interface SourceAnchor {
  line: number
  top: number
}

interface MarkdownPreviewProps {
  content: string
  components?: Components
  tocOpen: boolean
  onHeadingCountChange?: (count: number) => void
  onHeadingNavigate?: (line: number) => void
}

type PositionedNode = { position?: { start?: { line?: number; column?: number; offset?: number } } }

function sourceLine(node?: PositionedNode): number | undefined {
  return node?.position?.start?.line
}

function headingId(node?: PositionedNode): string {
  const start = node?.position?.start
  return `markdown-heading-${start?.line ?? 0}-${start?.column ?? 0}-${start?.offset ?? 0}`
}

export function interpolateSourceOffset(anchors: SourceAnchor[], line: number): number {
  if (!anchors.length) return 0
  if (line <= anchors[0]!.line) return anchors[0]!.top
  for (let index = 1; index < anchors.length; index += 1) {
    const next = anchors[index]!
    if (line > next.line) continue
    const previous = anchors[index - 1]!
    if (next.line === previous.line) return previous.top
    const progress = (line - previous.line) / (next.line - previous.line)
    return previous.top + (next.top - previous.top) * progress
  }
  return anchors.at(-1)!.top
}

function sameHeadings(left: MarkdownHeading[], right: MarkdownHeading[]): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index]
    return other?.id === item.id && other.label === item.label && other.level === item.level && other.line === item.line
  })
}

export const MarkdownPreview = forwardRef<MarkdownPreviewHandle, MarkdownPreviewProps>(function MarkdownPreview({ content, components, tocOpen, onHeadingCountChange, onHeadingNavigate }, ref) {
  const articleRef = useRef<HTMLElement>(null)
  const lastSourceLine = useRef<number | undefined>(undefined)
  const [headings, setHeadings] = useState<MarkdownHeading[]>([])
  const [activeHeading, setActiveHeading] = useState('')
  const mappedComponents = useMemo<Components>(() => ({
    ...components,
    h1: ({ node, ...props }) => <h1 {...props} id={headingId(node)} data-markdown-heading="1" data-source-line={sourceLine(node)} />,
    h2: ({ node, ...props }) => <h2 {...props} id={headingId(node)} data-markdown-heading="2" data-source-line={sourceLine(node)} />,
    h3: ({ node, ...props }) => <h3 {...props} id={headingId(node)} data-markdown-heading="3" data-source-line={sourceLine(node)} />,
    h4: ({ node, ...props }) => <h4 {...props} id={headingId(node)} data-markdown-heading="4" data-source-line={sourceLine(node)} />,
    h5: ({ node, ...props }) => <h5 {...props} data-source-line={sourceLine(node)} />,
    h6: ({ node, ...props }) => <h6 {...props} data-source-line={sourceLine(node)} />,
    p: ({ node, ...props }) => <p {...props} data-source-line={sourceLine(node)} />,
    ul: ({ node, ...props }) => <ul {...props} data-source-line={sourceLine(node)} />,
    ol: ({ node, ...props }) => <ol {...props} data-source-line={sourceLine(node)} />,
    li: ({ node, ...props }) => <li {...props} data-source-line={sourceLine(node)} />,
    pre: ({ node, ...props }) => <pre {...props} data-source-line={sourceLine(node)} />,
    blockquote: ({ node, ...props }) => <blockquote {...props} data-source-line={sourceLine(node)} />,
    table: ({ node, ...props }) => <table {...props} data-source-line={sourceLine(node)} />,
    hr: ({ node, ...props }) => <hr {...props} data-source-line={sourceLine(node)} />,
  }), [components])

  const sourceAnchors = () => {
    const article = articleRef.current
    if (!article) return []
    const articleRect = article.getBoundingClientRect()
    const unique = new Map<number, number>()
    article.querySelectorAll<HTMLElement>('[data-source-line]').forEach((element) => {
      const line = Number(element.dataset.sourceLine)
      if (!Number.isFinite(line) || unique.has(line)) return
      unique.set(line, element.getBoundingClientRect().top - articleRect.top + article.scrollTop)
    })
    return [...unique].map(([line, top]) => ({ line, top })).sort((left, right) => left.line - right.line)
  }

  const scrollToSourceLine = (line: number, behavior: ScrollBehavior = 'auto') => {
    const article = articleRef.current
    if (!article) return
    lastSourceLine.current = line
    article.scrollTo({ top: Math.max(0, interpolateSourceOffset(sourceAnchors(), line) - 18), behavior })
  }

  useImperativeHandle(ref, () => ({ scrollToSourceLine }), [])

  useLayoutEffect(() => {
    const article = articleRef.current
    if (!article) return
    const next = [...article.querySelectorAll<HTMLElement>('[data-markdown-heading]')].map((element) => ({
      id: element.id,
      label: element.textContent?.trim() || '未命名标题',
      level: Number(element.dataset.markdownHeading),
      line: Number(element.dataset.sourceLine),
    })).filter((heading) => Number.isFinite(heading.level) && Number.isFinite(heading.line))
    setHeadings((current) => sameHeadings(current, next) ? current : next)
    if (lastSourceLine.current !== undefined) scrollToSourceLine(lastSourceLine.current)
  }, [content, mappedComponents])

  useEffect(() => { onHeadingCountChange?.(headings.length) }, [headings.length, onHeadingCountChange])

  useEffect(() => {
    const article = articleRef.current
    if (!article || !headings.length) { setActiveHeading(''); return }
    const updateActiveHeading = () => {
      const top = article.getBoundingClientRect().top + 36
      let active = headings[0]!.id
      for (const heading of headings) {
        const element = article.querySelector<HTMLElement>(`#${heading.id}`)
        if (element && element.getBoundingClientRect().top <= top) active = heading.id
        else break
      }
      setActiveHeading(active)
    }
    article.addEventListener('scroll', updateActiveHeading, { passive: true })
    updateActiveHeading()
    return () => article.removeEventListener('scroll', updateActiveHeading)
  }, [headings])

  const showToc = tocOpen && headings.length > 0
  return <div className={`markdown-preview-shell ${showToc ? 'toc-open' : ''}`}>
    {showToc && <nav className="markdown-toc" aria-label="文档目录">
      <div className="markdown-toc-title">文档目录</div>
      <div className="markdown-toc-list">{headings.map((heading) => <button
        type="button"
        key={heading.id}
        className={activeHeading === heading.id ? 'active' : ''}
        style={{ paddingInlineStart: `${10 + (heading.level - 1) * 13}px` }}
        title={heading.label}
        aria-current={activeHeading === heading.id ? 'location' : undefined}
        onClick={() => { onHeadingNavigate?.(heading.line); scrollToSourceLine(heading.line, 'smooth') }}
      >{heading.label}</button>)}</div>
    </nav>}
    <article ref={articleRef} className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={mappedComponents}>{content}</ReactMarkdown></article>
  </div>
})
