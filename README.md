# BayTools

本地运行的开发者工具工作台，提供 Timestamp、颜色转换、可分组的 JSON 工作区、Markdown 阅读/编辑、代码段与多语言查询能力。JSON、BayTools 托管文档和代码段均可在侧边栏分组之间移动。所有持久化数据默认保存在工程内的 `Doc` 目录。

## 运行

环境要求：Node.js 20.18+。npm 随 Node.js 安装；pnpm 仅作为可选的开发包管理器。

```powershell
npm ci
npm run dev
```

开发地址为 `http://127.0.0.1:5173`。

生产方式本地运行：

```powershell
npm run start
```

也可以双击 `BayTools.cmd`。生产地址为 `http://127.0.0.1:4319`，启动后会打开默认浏览器。启动器使用 `package-lock.json` 和构建元数据判断是否需要更新：只有锁文件变化才重新执行 `npm ci`，只有源码变化才重新构建，并且会在新构建成功后才停止旧服务。详细输出写入 `Doc/logs/baytools.log`。

关闭浏览器页签不会停止后台服务。再次运行 BayTools 快捷方式时，启动器会比较 API 版本和当前源码指纹；切换分支、更新代码、服务崩溃或版本不兼容时都会自动重启。服务仍能响应但工作异常时，也可以在“设置 → 快捷方式 → 后台服务”中手动重启。

## 验证

```powershell
npm test
npm run typecheck
npm run build
```

## 本地数据

主页提供快速翻译卡片，侧边栏“翻译”提供完整双栏编辑、语言选择、流式输出、取消和历史记录；颜色转换工具仍可从侧边栏打开。

首次使用，在“设置 → DeepSeek API”中保存密钥并测试连接。Windows 使用 DPAPI 加密保存，仅当前 Windows 用户可解密；也支持服务进程的 `DEEPSEEK_API_KEY` 环境变量，本机保存的密钥优先。每台设备需单独配置密钥。

翻译使用 [DeepSeek 官方 API](https://api-docs.deepseek.com/)，默认 `deepseek-v4-flash`，可选 `deepseek-v4-pro`。点击翻译才会将本次原文发送给 DeepSeek，按其 API 用量计费；连接测试只读取模型列表。单次最多 12,000 个字符，支持 Ctrl+Enter 发起翻译；未完整生成或已取消的译文不会保存到历史。

翻译历史只保存在 `Doc/translation/history.json`，最多保留最近 100 条及约 8 MiB 内容，可搜索、载入、复制、单条删除或清空。密钥保存在 `Doc/secrets/deepseek.json`。这两个目录均不进入 Git、用户数据快照或发布流程；恢复分支快照不会覆盖它们。历史在同一工作目录切换分支或重启后保留，不跨设备同步。原文和译文以本机文件保存；清空历史不可恢复。

- `Doc/settings.json`：主题、侧边栏与工作时间设置。
- `Doc/json`：JSON 工作区。
- `Doc/color`：最近颜色与收藏颜色。
- `Doc/language`：多语言来源配置、TXT 缓存与收藏。
- `Doc/markdown`：扫描目录与阅读器状态；Markdown 原文件仍位于扫描目录。
- `Doc/code-cards`：代码段分组、页签、卡片内容和压缩后的图片缩略图。
- `Doc/trash`：可恢复的 JSON 工作区与 Markdown 文件。

`Doc/.gitignore` 会在所有分支中隔离整个运行目录。切换代码分支不会删除或替换本机数据。Markdown 的彻底删除、垃圾箱清空等操作不可恢复，界面会在执行前要求确认。

## 用户分支与个人数据同步

个人数据分支统一命名为 `user/<用户名>`。`main` 只维护代码，用户分支通过 `UserData/<用户名>` 保存可提交的个人数据快照。快照包含设置、JSON、颜色、语言数据、托管 Markdown、文件工作台和代码段；日志、垃圾箱、本机 Markdown 扫描路径和服务器状态不会同步。

新用户从 `main` 创建自己的分支：

```powershell
git switch main
git switch -c user/alice
npm run start
```

使用 BayTools 后，可以在侧边栏“数据同步”中点击“同步、提交并推送”。它只提交 `UserData/<当前用户名>`，不会提交代码或强推；远端领先、存在其他已暂存文件、认证失败或快照含超过 90 MiB 的文件时会停止。等价命令为：

```powershell
npm run data:publish -- --confirm
```

如果希望先检查 Git 差异，可以只生成本地快照：

```powershell
npm run data:status
npm run data:sync
git add UserData/alice
git commit -m "[alice] 同步个人数据"
git push -u origin user/alice
```

“同步到当前用户分支”只生成快照，不会自动暂存、提交或推送。若分支快照和本机数据都发生了变化，BayTools 会停止同步并要求明确选择恢复快照或用本机数据覆盖。自动发布使用系统 Git 凭据；认证不可用时，先在终端手动执行一次 `git push` 完成登录。

在新电脑首次从用户分支启动时，如果 `Doc` 中还没有个人数据，BayTools 会自动恢复对应快照。已有本机数据时可在设置页确认恢复，或运行：

```powershell
npm run data:restore -- --confirm
```

维护者可在 `main` 与自己的 `user/*` 分支之间切换；两者继续使用同一个本机 `Doc`。需要提交个人数据时，先切回自己的用户分支再同步。用户分支通过合并或变基 `main` 获取功能更新，不应合并回 `main`。
