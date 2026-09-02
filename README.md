# BayTools

本地运行的开发者工具工作台，提供 Timestamp、颜色转换、JSON 工作区与 Markdown 阅读/编辑能力。所有持久化数据默认保存在工程内的 `Doc` 目录。

## 运行

环境要求：Node.js 20.18+。npm 随 Node.js 安装；pnpm 仅作为可选的开发包管理器。

```powershell
npm install --no-package-lock
npm run dev
```

开发地址为 `http://127.0.0.1:5173`。

生产方式本地运行：

```powershell
npm run start
```

也可以双击 `BayTools.cmd`。生产地址为 `http://127.0.0.1:4319`，启动后会打开默认浏览器。

## 验证

```powershell
npm test
npm run typecheck
npm run build
```

## 本地数据

- `Doc/settings.json`：主题、侧边栏与工作时间设置。
- `Doc/json`：JSON 工作区。
- `Doc/color`：最近颜色与收藏颜色。
- `Doc/markdown`：扫描目录与阅读器状态；Markdown 原文件仍位于扫描目录。
- `Doc/trash`：可恢复的 JSON 工作区与 Markdown 文件。

`Doc/.gitignore` 会隔离运行数据。Markdown 的彻底删除、垃圾箱清空等操作不可恢复，界面会在执行前要求确认。
