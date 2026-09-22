import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { BookOpen, Bookmark, ClipboardPaste, Cloud, Code2, Copy, Database, FileText, Gamepad2, GitBranch, Globe2, Grid2X2, Link2, List, MessageSquare, PanelsTopLeft, Pencil, Plus, Server, Star, Trash2, Upload, Wrench, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react'
import { siBilibili, siClaudecode, siDeepseek, siGitlab, siJenkins, type SimpleIcon } from 'simple-icons'
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

type VectorBrandIcon = Pick<SimpleIcon, 'title' | 'hex' | 'path'>
type BrandIcon = { kind: 'vector'; icon: VectorBrandIcon } | { kind: 'image'; title: string; src: string }

// OpenAI removed its mark from recent Simple Icons releases. Keep the real vector
// contour from the previously published icon so ChatGPT remains available offline.
const openAiIcon: VectorBrandIcon = {
  title: 'OpenAI',
  hex: '10A37F',
  path: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
}

// Official chatglm.cn favicon, embedded so the launcher does not depend on the network.
const glmIconDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAg+SURBVHgB3VtrbFRFFD673XbbuoBY1EJCUy2gP2hK9YcJJTwSCaYEef0AKxGqhGCaqJAISgImYoz1BxETkOADIabKD+WVkvhIpE1LjIm0DcQUgXStQZCIgta+drvrfHf20nt3Z2bn3n2Vfsnkbne7j+87Z86cOWeuhzQQjUYXsstyNnAtZ+NeGpu4xUZnbJzweDxnKBUw4hvY6InevehhY4OKo0dCvJxdjrExh8YHgmwsYh4RjH/BG/8EI7+eXTpo/JAHytnoYNxWxL9g84DYPxyj8Y0NzBMOm3/cESDm9rB81gPc7b5obPDHkwIeNojKSr2UASBQVpvTwSpAD3FXyShAsK1zhNq7Ruj8lQidvxwxnpOhcobXEKKmKo+W1uSlS5ROJkA1HhgCxCLlIcoQQLDp6zCdbg8b5FMBBNm8uoDqlvgoRdQzET41BciI9UH2wFcham4LU7oBT9i+PiUhgkyAhzxRnuR8T2kEiDceGU7Z2jqAAG83+I244QKLIMB77MHLlAb0Xo9Qw7tDWSFuBbzh1J5CN/FhL95RRWnAgS9DNH/TQNbJAxB+2dZB4+oQC+ABf1MKS59bq8+bk0ezK7xUWZHHHntjS9+oGyNw9l6PGqvE6bNhrTiCANl6sJgc4BYEiJJLNLOo3tA4pFzGrADp2rk+qnvK53jOQmisJJ+zobI0AuNrbOjCtQCNh4fpHTZ08AwLVHVL8g0BUgXIr9s1aHiGDF1NxdrxwJUAuuRBeN82f0YyOoggmxZLa3z02e5C0oFjAXTIgzCIp8PiMmDaIejKpkPw5D1a08yRADrkN6/ON+ag9cuv/Un0Sy/R9ZtEv7PHfQNs9BP9229/79QpRIEiomnsOnM6e8zi2awy+Xch8C7bOiB8DbnBi+y3JIO2ADrkzS8F4Va2rTp3kY94ok4woZiLsYBl7tWPJAoCAUQrELzv1J4iSgYtARDt1+0clL4Oaze9VUQ/93jvkM4U4CVL52Ke88cfsPxjx74hEv0mTINkSCoA5hjmmmypy/d5afnCQgpe86ZkaTeACJUPR6j+TfEX66wGSQWoquuXBhqQnz610LjmEhd7+oTPIylCcqSC8lWkt6qkY9qDuScP5OeLf4NOgibdS4K4Kug9UOKnwgJ98pivs1gwKy3hUT4gyFixMmCVwGphrBy/UcYhFQBRX6bgpICPJk9ULzGI3rUsWD3+KI/eExyl6ByIKZeYCC3nmDt3clFECIUikt/pMg+A9TH3RUg27x9jZDcu59d0A6tLczsfJoaGIxS8Kv6tOsmQ0AMaFa4/ZXKBkDwi8sanuatnChDVEJh9z0cnuRChsNz6Oh4gFKCtS/yhhX4vTQzY3wLCO5/PjMVlML8TQqzaJt4PmNHfnDYywySYskmx3bz/Pr/t7zWLiY68kV3yVoBU/6D4t86v5oaCALs/kX9GggCnJTssuH1x4ejmBvN8y1p3wS1dUBmrJrYRQxBF7PjiW/FnJAjQ1iWu7EyeNBr1QR7ul2vIYhWyv7mVnFpLB3/u45PiPYlNAFWTIlDMFTWDXa6hsv7iJ3hFCO5v7ktA3rp6mLAJ0PuHPOXFwJwbC+QB1Ur10hpOK35T1tqR+L8JHiCC38//LdPLnC5AXmZ9lN8wBWB9LJVWQJD4ZMruAZIPLfDx9TRX0d6KZCm6WRBF0BNljvFeoZXMe70eg3yurW/W/2VARdjc/vZJtuZKD1Ah1+QRnFEIlXkpiFvL4bJS2rWb9r+1BMBmY2oJ5RToP6hK4WiNWRHQzE9sAlTOEFdxB9mGI165bAGWb2gcNMpyMlhd34Rs5xgPW2JfVirePGDH1f0r8gNXHVjX0GmC1LIegKgTJKslxHuyTbZ5VfI6/o8XQlmt+YE0Ap6KPKy+f7tf+NoliQAoylhhEwDbR1kz46/bIdaXc91GdATeae5XluPMlrhoy4uMTzYFZsYFx4QgCJcSIRKJ0vtHh7Tnlhtwqw/Q64IytxXJzgPEJ0AmREt5wifgxIWskHD1Rphe2aPXEHUCBDrU9mH1ZG32pORPyK2PfUw8Ej4F5Lc/J28vf/PDsHI9dgKQBXGU39DgSAZMz9aDRUryMusbDRWBANK+gKzlZAJCwVvQC3TS/YVwze0jjk+MJev7q8gDqCA5EsDJsRNYprLCS7Mr8hKWUpzyuP1flC5cGWGEI449J1mnGSsTyB/9Tv4ZIA4BRFB2hsygpHsCJN0QdZqtONfNyl2H1EkPXH//q/JUXqs36PIAkmvA2ohDMqtf6uXu3tKh/hyU61CzVO1jtLrDIL9mxzB1B9N/4NEKFXGjSRIjrtN9Bvn923hrXQXt8wFws2d3henC5WFpLd4NzORr86rEM0RmSQsD1RzdTDSZ21vh6Jgc9tgfMgscPBamf/pC1D/g7kwg6gvoMcws89GmFTzvAFkQxOkR8zSJm9QbyQ4Cnub23Tgm5/jmCKSacMWrN6KsLj9CA2xgx4hscSQy2qszu7b5rKKE4S/IY8NeXk8X4PIvsGr12icdve2M66OysFjzWb4E5Rpo0KBe6aJHsTflw9Jm8VFUcMwkzO7z2sUpVasWpfW4vNm5zeQZIcxxHJiqrUm5K8WPy+NRum+YQPDqYCL81M2vqRx0gHXNrvD86rS24kZvmADcBEMnQIECU8SM9qISG6o1IGieDywtyVjv0bA+HoyJm6ayDNtNU3e2cbEnttD4R731BkrbPhZzgl1WEldpvAGcQP649UnVrbNYGstpfAA3U6/UunUWwD/GgkQ98ftu71YEiVu9WkQe0Cr0x5Il3FaL+4uwUozl2+eDbLSwcVzn9vn/AWPIqLtnLYy9AAAAAElFTkSuQmCC'

const brandIcons: Partial<Record<BookmarkBuiltinIcon, BrandIcon>> = {
  jenkins: { kind: 'vector', icon: siJenkins },
  gitlab: { kind: 'vector', icon: siGitlab },
  deepseek: { kind: 'vector', icon: siDeepseek },
  chatgpt: { kind: 'vector', icon: openAiIcon },
  claude: { kind: 'vector', icon: siClaudecode },
  glm: { kind: 'image', title: 'GLM', src: glmIconDataUrl },
  bilibili: { kind: 'vector', icon: siBilibili },
}

function BookmarkBuiltinGlyph({ name, size = 30 }: { name: BookmarkBuiltinIcon; size?: number }) {
  const Icon = iconComponents[name]
  if (Icon) return <Icon size={size} />
  const brand = brandIcons[name]
  if (!brand) return <Link2 size={size} />
  if (brand.kind === 'image') return <img className="bookmark-brand-image" src={brand.src} alt="" title={brand.title} style={{ width: size, height: size }} />
  return <svg className="bookmark-brand-svg" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={brand.icon.title}><path fill={`#${brand.icon.hex}`} d={brand.icon.path} /></svg>
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
