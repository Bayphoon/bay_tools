import Editor from '@monaco-editor/react'
import { Bold, Code2, FileCode2, Heading1, Heading2, Heading3, Image as ImageIcon, Italic, Link as LinkIcon, List as ListIcon, ListChecks, ListOrdered, Minus, Quote, Redo2, Strikethrough, Table2, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import type { OnMount } from '@monaco-editor/react'
import type { Components } from 'react-markdown'
import { createMarkdownEdit, type MarkdownFormatAction } from '../lib/markdownFormat'
import { MarkdownPreview, type MarkdownPreviewHandle } from './MarkdownPreview'

export type MarkdownMode = 'source' | 'preview' | 'split'

interface MarkdownWorkspaceProps {
  content: string
  mode: MarkdownMode
  tocOpen: boolean
  syncScroll: boolean
  previewComponents?: Components
  onChange(value: string): void
  onHeadingCountChange(count: number): void
}

export function MarkdownWorkspace({ content, mode, tocOpen, syncScroll, previewComponents, onChange, onHeadingCountChange }: MarkdownWorkspaceProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | undefined>(undefined)
  const previewRef = useRef<MarkdownPreviewHandle>(null)
  const scrollListener = useRef<{ dispose(): void } | undefined>(undefined)
  const headingNavigation = useRef(false)
  const syncState = useRef({ mode, syncScroll })
  syncState.current = { mode, syncScroll }

  const applyFormat = useCallback((action: MarkdownFormatAction) => {
    const editor = editorRef.current
    const model = editor?.getModel()
    const selection = editor?.getSelection()
    if (!editor || !model || !selection) return

    let url: string | undefined
    if (action === 'link' || action === 'image') {
      const value = window.prompt(action === 'link' ? '请输入链接地址' : '请输入图片地址', action === 'link' ? 'https://' : './image.png')
      if (value === null) { editor.focus(); return }
      url = value
    }

    const markdownEdit = createMarkdownEdit(model.getValue(), model.getOffsetAt(selection.getStartPosition()), model.getOffsetAt(selection.getEndPosition()), action, { url })
    const rangeStart = model.getPositionAt(markdownEdit.rangeStart)
    const rangeEnd = model.getPositionAt(markdownEdit.rangeEnd)
    editor.pushUndoStop()
    editor.executeEdits('markdown-format-toolbar', [{
      range: { startLineNumber: rangeStart.lineNumber, startColumn: rangeStart.column, endLineNumber: rangeEnd.lineNumber, endColumn: rangeEnd.column },
      text: markdownEdit.replacement,
      forceMoveMarkers: true,
    }])
    const selectionStart = model.getPositionAt(markdownEdit.selectionStart)
    const selectionEnd = model.getPositionAt(markdownEdit.selectionEnd)
    editor.setSelection({ startLineNumber: selectionStart.lineNumber, startColumn: selectionStart.column, endLineNumber: selectionEnd.lineNumber, endColumn: selectionEnd.column })
    editor.revealPositionInCenterIfOutsideViewport(selectionEnd)
    editor.pushUndoStop()
    editor.focus()
  }, [])

  const runEditorCommand = useCallback((command: 'undo' | 'redo') => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    editor.trigger('markdown-format-toolbar', command, null)
  }, [])

  const syncPreviewFromEditor = useCallback(() => {
    const editor = editorRef.current
    if (!editor || headingNavigation.current || !syncState.current.syncScroll || syncState.current.mode !== 'split') return
    const line = editor.getVisibleRanges()[0]?.startLineNumber ?? editor.getPosition()?.lineNumber
    if (line) previewRef.current?.scrollToSourceLine(line)
  }, [])

  const mountEditor = useCallback<OnMount>((editor, monaco) => {
    scrollListener.current?.dispose()
    editorRef.current = editor
    scrollListener.current = editor.onDidScrollChange((event) => { if (event.scrollTopChanged) syncPreviewFromEditor() })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, () => applyFormat('bold'))
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => applyFormat('italic'))
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => applyFormat('link'))
    syncPreviewFromEditor()
  }, [applyFormat, syncPreviewFromEditor])

  useEffect(() => () => scrollListener.current?.dispose(), [])
  useEffect(() => {
    if (mode !== 'split' || !syncScroll) return
    const frame = window.requestAnimationFrame(syncPreviewFromEditor)
    return () => window.cancelAnimationFrame(frame)
  }, [content, mode, syncScroll, tocOpen, syncPreviewFromEditor])

  return <div className={`markdown-workspace mode-${mode}`}>
    {mode !== 'preview' && <div className="markdown-editor">
      <div className="markdown-format-toolbar" role="toolbar" aria-label="Markdown 格式工具栏">
        <div className="markdown-format-group" aria-label="标题">
          <FormatButton label="一级标题" shortcut="H1" onClick={() => applyFormat('heading1')}><Heading1 size={16} /></FormatButton>
          <FormatButton label="二级标题" shortcut="H2" onClick={() => applyFormat('heading2')}><Heading2 size={16} /></FormatButton>
          <FormatButton label="三级标题" shortcut="H3" onClick={() => applyFormat('heading3')}><Heading3 size={16} /></FormatButton>
        </div>
        <span className="markdown-format-divider" />
        <div className="markdown-format-group" aria-label="文字样式">
          <FormatButton label="粗体" shortcut="Ctrl+B" onClick={() => applyFormat('bold')}><Bold size={15} /></FormatButton>
          <FormatButton label="斜体" shortcut="Ctrl+I" onClick={() => applyFormat('italic')}><Italic size={15} /></FormatButton>
          <FormatButton label="删除线" onClick={() => applyFormat('strike')}><Strikethrough size={15} /></FormatButton>
        </div>
        <span className="markdown-format-divider" />
        <div className="markdown-format-group" aria-label="代码">
          <FormatButton label="行内代码" onClick={() => applyFormat('inlineCode')}><Code2 size={15} /></FormatButton>
          <FormatButton label="代码块" onClick={() => applyFormat('codeBlock')}><FileCode2 size={15} /></FormatButton>
        </div>
        <span className="markdown-format-divider" />
        <div className="markdown-format-group" aria-label="段落和列表">
          <FormatButton label="引用" onClick={() => applyFormat('quote')}><Quote size={15} /></FormatButton>
          <FormatButton label="无序列表" onClick={() => applyFormat('unorderedList')}><ListIcon size={15} /></FormatButton>
          <FormatButton label="有序列表" onClick={() => applyFormat('orderedList')}><ListOrdered size={15} /></FormatButton>
          <FormatButton label="待办列表" onClick={() => applyFormat('taskList')}><ListChecks size={15} /></FormatButton>
        </div>
        <span className="markdown-format-divider" />
        <div className="markdown-format-group" aria-label="插入">
          <FormatButton label="链接" shortcut="Ctrl+K" onClick={() => applyFormat('link')}><LinkIcon size={15} /></FormatButton>
          <FormatButton label="图片" onClick={() => applyFormat('image')}><ImageIcon size={15} /></FormatButton>
          <FormatButton label="表格" onClick={() => applyFormat('table')}><Table2 size={15} /></FormatButton>
          <FormatButton label="分割线" onClick={() => applyFormat('horizontalRule')}><Minus size={15} /></FormatButton>
        </div>
        <span className="markdown-format-divider" />
        <div className="markdown-format-group" aria-label="历史操作">
          <FormatButton label="撤销" shortcut="Ctrl+Z" onClick={() => runEditorCommand('undo')}><Undo2 size={15} /></FormatButton>
          <FormatButton label="重做" shortcut="Ctrl+Y" onClick={() => runEditorCommand('redo')}><Redo2 size={15} /></FormatButton>
        </div>
      </div>
      <div className="markdown-editor-surface"><Editor height="100%" language="markdown" value={content} onChange={(value) => onChange(value ?? '')} onMount={mountEditor} theme="vs-dark" options={{ minimap: { enabled: false }, fontSize: 14, fontFamily: 'Cascadia Code, Consolas, monospace', wordWrap: 'on', automaticLayout: true, scrollBeyondLastLine: false }} /></div>
    </div>}
    {mode !== 'source' && <MarkdownPreview ref={previewRef} content={content} components={previewComponents} tocOpen={tocOpen} onHeadingCountChange={onHeadingCountChange} onHeadingNavigate={(line) => {
      const editor = editorRef.current
      if (!editor) return
      headingNavigation.current = true
      editor.revealLineInCenter(line)
      window.requestAnimationFrame(() => { headingNavigation.current = false })
    }} />}
  </div>
}

function FormatButton({ label, shortcut, onClick, children }: { label: string; shortcut?: string; onClick(): void; children: React.ReactNode }) {
  const title = shortcut ? `${label}（${shortcut}）` : label
  return <button type="button" className="markdown-format-button" aria-label={title} title={title} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</button>
}
