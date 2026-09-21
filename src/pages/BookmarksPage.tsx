import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { BookOpen, Bookmark, ClipboardPaste, Cloud, Code2, Copy, Database, FileText, Gamepad2, GitBranch, Globe2, Grid2X2, Link2, List, MessageSquare, PanelsTopLeft, Pencil, Plus, Server, Star, Trash2, Upload, Wrench, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type MouseEvent } from 'react'
import { BOOKMARK_BUILTIN_ICONS, BOOKMARK_ICON_MAX_UPLOAD_SIZE, type BookmarkBuiltinIcon, type BookmarkItem, type BookmarkLayout, type BookmarkLibrary } from '../../shared/types'
import { EmptyState, InlineError, PageHeader, Spinner, ToolButton } from '../components/ui'
import { ApiError, bookmarkIconUrl, localBridge } from '../lib/api'
import { showAppNotice } from '../lib/clipboard'
import { confirmAction } from '../lib/confirmation'

const iconComponents: Partial<Record<BookmarkBuiltinIcon, LucideIcon>> = {
  link: Link2,
  globe: Globe2,
  code: Code2,
  book: BookOpen,
  github: GitBranch,
  server: Server,
  database: Database,
  cloud: Cloud,
  game: Gamepad2,
  tool: Wrench,
  file: FileText,
  message: MessageSquare,
  star: Star,
}

const iconLabels: Record<BookmarkBuiltinIcon, string> = {
  link: '链接', globe: '网站', code: '代码', book: '文档', github: 'GitHub', server: '服务器', database: '数据库', cloud: '云服务', game: '游戏', tool: '工具', file: '文件', message: '消息', star: '收藏',
  jenkins: 'Jenkins', gitlab: 'GitLab', deepseek: 'DeepSeek', chatgpt: 'ChatGPT', claude: 'Claude Code', glm: 'GLM', bilibili: '哔哩哔哩',
}

const brandMarks: Partial<Record<BookmarkBuiltinIcon, { text: string; color: string }>> = {
  jenkins: { text: 'J', color: '#D24939' },
  gitlab: { text: 'GL', color: '#FC6D26' },
  deepseek: { text: 'DS', color: '#4D6BFE' },
  chatgpt: { text: 'GPT', color: '#10A37F' },
  claude: { text: 'C', color: '#D97757' },
  glm: { text: 'GLM', color: '#246BFD' },
  bilibili: { text: 'B', color: '#00AEEC' },
}

function BookmarkBuiltinGlyph({ name, size = 30 }: { name: BookmarkBuiltinIcon; size?: number }) {
  const Icon = iconComponents[name]
  if (Icon) return <Icon size={size} />
  const brand = brandMarks[name] ?? { text: iconLabels[name].slice(0, 2), color: 'var(--accent)' }
  return <span className="bookmark-brand-mark" style={{ '--bookmark-brand-color': brand.color, '--bookmark-brand-size': `${size}px` } as CSSProperties}>{brand.text}</span>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败'
}

function BookmarkGlyph({ item, previewUrl, size = 30 }: { item?: BookmarkItem; previewUrl?: string; size?: number }) {
  if (previewUrl) return <img className="bookmark-local-icon" src={previewUrl} alt="本地图标预览" />
  if (item?.icon.kind === 'local') return <img className="bookmark-local-icon" src={bookmarkIconUrl(item.id, item.icon.updatedAt)} alt="" />
  const name = item?.icon.kind === 'builtin' ? item.icon.name : 'link'
  return <BookmarkBuiltinGlyph name={name} size={size} />
}

export function openBookmarkInNewTab(url: string): void {
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (opened) opened.opener = null
}

interface BookmarkEditorValue {
  title: string
  url: string
  builtinIcon?: BookmarkBuiltinIcon
  iconFile?: File
}

function BookmarkEditorDialog({ item, onClose, onSave }: {
  item?: BookmarkItem
  onClose: () => void
  onSave: (value: BookmarkEditorValue) => Promise<void>
}) {
  const [title, setTitle] = useState(item?.title ?? '')
  const [url, setUrl] = useState(item?.url ?? '')
  const [iconMode, setIconMode] = useState<'builtin' | 'local'>(item?.icon.kind === 'local' ? 'local' : 'builtin')
  const [builtinIcon, setBuiltinIcon] = useState<BookmarkBuiltinIcon>(item?.icon.kind === 'builtin' ? item.icon.name : 'link')
  const [iconFile, setIconFile] = useState<File>()
  const [previewUrl, setPreviewUrl] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [clipboardBusy, setClipboardBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!iconFile) { setPreviewUrl(undefined); return }
    const next = URL.createObjectURL(iconFile)
    setPreviewUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [iconFile])

  const selectLocalIcon = (file?: File) => {
    setError('')
    if (!file) { setIconFile(undefined); return }
    const extension = file.name.split('.').at(-1)?.toLocaleLowerCase()
    if (!['png', 'jpg', 'jpeg', 'webp', 'gif', 'ico'].includes(extension ?? '')) {
      setError('本地图标只支持 PNG、JPEG、WebP、GIF 或 ICO')
      return
    }
    if (file.size > BOOKMARK_ICON_MAX_UPLOAD_SIZE) {
      setError('本地图标不能超过 2 MiB')
      return
    }
    setIconFile(file)
  }

  const readClipboardImage = async () => {
    if (!navigator.clipboard?.read) {
      setError('当前浏览器不支持直接读取剪贴板图片，请使用本地上传')
      return
    }
    setClipboardBusy(true)
    setError('')
    try {
      const clipboardItems = await navigator.clipboard.read()
      for (const clipboardItem of clipboardItems) {
        const imageType = clipboardItem.types.find((type) => ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(type))
        if (!imageType) continue
        const blob = await clipboardItem.getType(imageType)
        const extension = imageType === 'image/jpeg' ? 'jpg' : imageType.includes('icon') ? 'ico' : imageType.slice('image/'.length)
        selectLocalIcon(new File([blob], `clipboard-icon-${Date.now()}.${extension}`, { type: imageType, lastModified: Date.now() }))
        return
      }
      setError('剪贴板中没有可用的图片')
    } catch (clipboardError) {
      setError(clipboardError instanceof Error && clipboardError.name === 'NotAllowedError' ? '浏览器未允许读取剪贴板，请授权后重试' : `读取剪贴板失败：${errorMessage(clipboardError)}`)
    } finally {
      setClipboardBusy(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (iconMode === 'local' && !iconFile && item?.icon.kind !== 'local') {
      setError('请选择一个本地图标文件')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave({ title, url, builtinIcon: iconMode === 'builtin' ? builtinIcon : undefined, iconFile })
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  return <AlertDialog.Root open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="bookmark-dialog-overlay" />
      <AlertDialog.Content className="bookmark-dialog-card">
        <form onSubmit={(event) => void submit(event)}>
          <header><div className="bookmark-dialog-preview">{iconMode === 'builtin' ? <BookmarkBuiltinGlyph name={builtinIcon} size={34} /> : <BookmarkGlyph item={item} previewUrl={previewUrl} size={34} />}</div><div><AlertDialog.Title>{item ? '编辑书签' : '新增书签'}</AlertDialog.Title><AlertDialog.Description>设置标题、链接和用于识别的图标。</AlertDialog.Description></div></header>
          <label className="field-label">书签标题<input className="field" autoFocus maxLength={120} required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：JSON Editor Online" /></label>
          <label className="field-label">书签链接<input className="field mono" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" /></label>
          <fieldset className="bookmark-icon-fieldset"><legend>书签图标</legend><div className="bookmark-icon-source"><button type="button" className={iconMode === 'builtin' ? 'active' : ''} onClick={() => setIconMode('builtin')}>内置图标</button><button type="button" className={iconMode === 'local' ? 'active' : ''} onClick={() => setIconMode('local')}>自定义图标</button></div>
            {iconMode === 'builtin' ? <div className="bookmark-icon-options">{BOOKMARK_BUILTIN_ICONS.map((name) => <button type="button" key={name} className={builtinIcon === name ? 'active' : ''} title={iconLabels[name]} aria-label={`使用${iconLabels[name]}图标`} onClick={() => setBuiltinIcon(name)}><BookmarkBuiltinGlyph name={name} size={19} /><span>{iconLabels[name]}</span></button>)}</div> : <div className="bookmark-custom-icon"><div className="bookmark-custom-icon-actions"><label className="bookmark-custom-icon-action"><Upload size={20} /><strong>本地上传</strong><span>选择图片文件</span><input type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.ico,image/png,image/jpeg,image/webp,image/gif,image/x-icon" onChange={(event) => selectLocalIcon(event.target.files?.[0])} /></label><button type="button" className="bookmark-custom-icon-action" aria-label="读取剪贴板图片" disabled={clipboardBusy} onClick={() => void readClipboardImage()}><ClipboardPaste size={20} /><strong>{clipboardBusy ? '读取中…' : '读取剪贴板图片'}</strong><span>使用当前剪贴板图片</span></button></div><div className="bookmark-custom-icon-status"><div><BookmarkGlyph item={item} previewUrl={previewUrl} size={30} /></div><span>{iconFile?.name ?? (item?.icon.kind === 'local' ? '继续使用当前本地图标' : '尚未选择自定义图标')}</span><small>PNG / JPEG / WebP / GIF / ICO，最大 2 MiB</small></div></div>}
          </fieldset>
          <InlineError>{error}</InlineError>
          <footer><AlertDialog.Cancel asChild><button type="button" disabled={saving}>取消</button></AlertDialog.Cancel><button className="primary" type="submit" disabled={saving}>{saving ? '保存中…' : '保存书签'}</button></footer>
        </form>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>
}

function BookmarkCard({ item, layout, busy, onEdit, onDelete, onFavorite, onCopy }: {
  item: BookmarkItem
  layout: BookmarkLayout
  busy: boolean
  onEdit: () => void
  onDelete: () => void
  onFavorite: () => void
  onCopy: () => void
}) {
  const action = (callback: () => void) => (event: MouseEvent) => { event.stopPropagation(); callback() }
  const open = () => openBookmarkInNewTab(item.url)
  return <article className={`bookmark-card ${layout} ${item.favorite ? 'favorite' : ''}`} role="link" tabIndex={0} aria-label={`打开 ${item.title}`} onClick={open} onKeyDown={(event) => { if (event.currentTarget === event.target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open() } }}>
    <div className="bookmark-card-icon"><BookmarkGlyph item={item} size={layout === 'large' ? 42 : 28} /></div>
    <div className="bookmark-card-main"><strong>{item.title}</strong><span title={item.url}>{item.url}</span></div>
    <div className="bookmark-card-actions">
      <button type="button" disabled={busy} className={item.favorite ? 'active' : ''} title={item.favorite ? '取消收藏' : '收藏'} aria-label={item.favorite ? `取消收藏 ${item.title}` : `收藏 ${item.title}`} onClick={action(onFavorite)}><Star size={15} fill={item.favorite ? 'currentColor' : 'none'} /></button>
      <button type="button" disabled={busy} title="复制链接" aria-label={`复制 ${item.title} 链接`} onClick={action(onCopy)}><Copy size={15} /></button>
      <button type="button" disabled={busy} title="编辑书签" aria-label={`编辑 ${item.title}`} onClick={action(onEdit)}><Pencil size={15} /></button>
      <button type="button" disabled={busy} className="danger" title="删除书签" aria-label={`删除 ${item.title}`} onClick={action(onDelete)}><Trash2 size={15} /></button>
    </div>
  </article>
}

export function BookmarksPage() {
  const [library, setLibrary] = useState<BookmarkLibrary>()
  const [editor, setEditor] = useState<BookmarkItem | 'new'>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try { setLibrary(await localBridge.getBookmarks()); setError('') }
    catch (loadError) { setError(errorMessage(loadError)) }
  }
  useEffect(() => { void load() }, [])

  const ordered = useMemo(() => {
    const items = [...(library?.items ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    return { favorites: items.filter((item) => item.favorite), others: items.filter((item) => !item.favorite) }
  }, [library])

  const save = async (value: BookmarkEditorValue) => {
    if (!library) return
    const editing = editor !== 'new' ? editor : undefined
    let next = editing
      ? await localBridge.updateBookmark(editing.id, { title: value.title, url: value.url, favorite: editing.favorite, builtinIcon: value.builtinIcon, revision: library.revision })
      : await localBridge.createBookmark({ title: value.title, url: value.url, builtinIcon: value.builtinIcon ?? 'link', revision: library.revision })
    const itemId = editing?.id ?? next.items.find((item) => !library.items.some((current) => current.id === item.id))?.id
    if (value.iconFile && itemId) {
      try { next = await localBridge.uploadBookmarkIcon(itemId, value.iconFile, next.revision) }
      catch (iconError) {
        setLibrary(next)
        setEditor(undefined)
        showAppNotice({ message: `书签已保存，但本地图标上传失败：${errorMessage(iconError)}`, kind: 'error' })
        return
      }
    }
    setLibrary(next)
    setEditor(undefined)
    showAppNotice({ message: editing ? '书签已更新' : '书签已添加', kind: 'success' })
  }

  const updateItem = async (item: BookmarkItem, patch: Partial<Pick<BookmarkItem, 'favorite'>>) => {
    if (!library || busy) return
    setBusy(true)
    try {
      setLibrary(await localBridge.updateBookmark(item.id, { title: item.title, url: item.url, favorite: patch.favorite ?? item.favorite, revision: library.revision }))
      setError('')
    } catch (updateError) {
      setError(errorMessage(updateError))
      if (updateError instanceof ApiError && updateError.status === 409) await load()
    } finally { setBusy(false) }
  }

  const remove = async (item: BookmarkItem) => {
    if (!library || !(await confirmAction(`删除书签“${item.title}”？`, { confirmLabel: '删除' }))) return
    setBusy(true)
    try { setLibrary(await localBridge.deleteBookmark(item.id, library.revision)); setError(''); showAppNotice({ message: '书签已删除', kind: 'success' }) }
    catch (deleteError) { setError(errorMessage(deleteError)); if (deleteError instanceof ApiError && deleteError.status === 409) await load() }
    finally { setBusy(false) }
  }

  const copy = async (item: BookmarkItem) => {
    try { await navigator.clipboard.writeText(item.url); showAppNotice({ message: `${item.title} 链接已复制`, kind: 'success' }) }
    catch (copyError) { showAppNotice({ message: errorMessage(copyError), kind: 'error' }) }
  }

  const changeLayout = async (layout: BookmarkLayout) => {
    if (!library || layout === library.layout || busy) return
    const previous = library
    setLibrary({ ...library, layout })
    setBusy(true)
    try { setLibrary(await localBridge.updateBookmarkLayout(layout, library.revision)); setError('') }
    catch (layoutError) { setLibrary(previous); setError(errorMessage(layoutError)) }
    finally { setBusy(false) }
  }

  if (!library && !error) return <main className="page bookmark-page"><Spinner label="正在读取书签" /></main>
  const layout = library?.layout ?? 'grid'
  const renderCards = (items: BookmarkItem[]) => <div className={`bookmark-collection ${layout}`}>{items.map((item) => <BookmarkCard key={item.id} item={item} layout={layout} busy={busy} onEdit={() => setEditor(item)} onDelete={() => void remove(item)} onFavorite={() => void updateItem(item, { favorite: !item.favorite })} onCopy={() => void copy(item)} />)}</div>

  return <main className="page bookmark-page">
    <PageHeader title="书签" description="集中保存常用网站与内部工具链接" actions={<><div className="bookmark-layout-switch" role="group" aria-label="书签布局"><button className={layout === 'list' ? 'active' : ''} title="列表布局" aria-label="列表布局" onClick={() => void changeLayout('list')}><List size={16} /></button><button className={layout === 'grid' ? 'active' : ''} title="网格布局" aria-label="网格布局" onClick={() => void changeLayout('grid')}><Grid2X2 size={16} /></button><button className={layout === 'large' ? 'active' : ''} title="大卡片布局" aria-label="大卡片布局" onClick={() => void changeLayout('large')}><PanelsTopLeft size={16} /></button></div><ToolButton className="primary" onClick={() => setEditor('new')}><Plus size={15} />新增书签</ToolButton></>} />
    <InlineError>{error}</InlineError>
    {!library?.items.length ? <EmptyState title="还没有书签" action={<ToolButton className="primary" onClick={() => setEditor('new')}><Plus size={15} />新增书签</ToolButton>}>添加常用网站或内部工具，之后可以从这里快速打开。</EmptyState> : <div className="bookmark-sections">
      {ordered.favorites.length > 0 && <section><header><Star size={16} fill="currentColor" /><h2>收藏书签</h2><span>{ordered.favorites.length}</span></header>{renderCards(ordered.favorites)}</section>}
      {ordered.others.length > 0 && <section><header><Bookmark size={16} /><h2>{ordered.favorites.length ? '其他书签' : '全部书签'}</h2><span>{ordered.others.length}</span></header>{renderCards(ordered.others)}</section>}
    </div>}
    {editor && <BookmarkEditorDialog item={editor === 'new' ? undefined : editor} onClose={() => setEditor(undefined)} onSave={save} />}
  </main>
}
