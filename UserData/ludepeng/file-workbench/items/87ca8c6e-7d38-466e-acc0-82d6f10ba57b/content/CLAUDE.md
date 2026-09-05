# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Knowledge Base

项目知识库位于 `D:\bayphoon\cc_lw_md\`，索引入口为 @D:\bayphoon\cc_lw_md\INDEX.md。

**查询规则**：
- 回答架构、设计、"XX 是怎么工作的"类问题时，**先查知识库索引**，再读对应的 wiki 页面，最后才读源码
- wiki 页面已汇总模块职责、核心字段、关键方法和系统间关系，能节省大量上下文
- 发现重要模式或新理解时，**更新或新建**相应的 wiki 页面

## Development Commands

### Build Commands
- **Build Lua Scripts**: `python Tools/build_lw_lua.py <buildID> <appVersion> <makePatch> <isU440> [luaEncrypt]` (Compiles and packages Lua)
- **Build DataTables**: `python Tools/build_datatable.py <unityPath> <projectPath> <platform> <patchSubmodule> <patchPath>`
- **Full APK Build**: `bash Tools/cmd_build_full_apk.sh`
- **Split APK Build**: `bash Tools/cmd_build_split_apk.sh`
- **Build Individual DataTables**: Run `GameKit.Editor.PublishTool.BuildDataTable` via Unity menu or batch mode.

### Linting & Formatting
- No explicit linting command found. Follow `Assets/Main/LuaScripts/代码规范.txt` for coding standards.
- Naming Conventions:
    - Classes & Public Functions: CamelCase (e.g., `GetInstance`, `CoAsyncLoad`)
    - Private/Local Variables & Parameters: snake_case (e.g., `self.action_list`, `item_id`)
    - UI Components Suffixes: `_btn`, `_text`, `_img`, `_input`, `_tabgroup`, `_wrapgroup`, `_slider`.

## Code Architecture

### Overview
This is a Unity project using **XLua** for logic. Most gameplay and UI logic resides in Lua.
- **Lua Root**: `Assets/Main/LuaScripts/`
- **Entry Point**: `GameMain.lua` (Initializes global modules and starts `LuaEntry`)
- **Core Framework**: `Assets/Main/LuaScripts/Framework/`
- **Global Data**: `Assets/Main/LuaScripts/DataCenter/` (Contains singleton managers for various systems)

### UI Architecture (MVC)
UI follows a strict MVC pattern as defined in `代码规范.txt`:
- **Model**: Stores window-specific data and user state. Lives with the window.
- **View**: Handles UI component operations. Depends on Ctrl and Model (read-only).
- **Controller (Ctrl)**: Handles data operations and game logic. No state.
- **Naming**: All UI scripts start with `UI` (e.g., `UIWindowNameView.lua`).
- **Framework Knowledge Base**: [INDEX.md](file:///D:/bayphoon/cc_lw_md/INDEX.md) @D:\bayphoon\cc_lw_md\INDEX.md

### Key Patterns & Rules
- **Unity Object Null Check**: Always use the global `IsNull(obj)` function instead of `obj == nil`.
- **Coroutines**: Must start with `Co` (e.g., `CoLoadAsset`). Use Lua-side coroutine system, avoid Unity C# coroutines.
- **Singletons**: Inherit from `Singleton` base class. Access via `Class:GetInstance()`.
- **Data/Const Classes**: Use `DataClass("Name", table)` or `ConstClass("Name", table)` for validated data structures.
- **Protected Calls**: Wrap system/manager startups in `CommonUtil.ProtectCall` to prevent initialization failures from cascading.
- **Performance**: Minimize Lua <-> C# interaction. Perform heavy calculations (like pathfinding) on the C# side or in C++.

## 编码习惯 (观察总结)

### UI 与组件管理
- **路径局部变量化**：在 `ComponentDefine` 中，将所有子节点路径定义为以 `_path` 结尾的局部变量（如 `local p_btn_left_path = "..."`）。
- **变量命名规范**：
    - UI 组件成员：统一使用 `p_` 前缀（如 `self.p_btn_left`, `self.p_text_time`）。
    - 逻辑/数据成员：使用 CamelCase（驼峰式，如 `self.ActData`, `self.CurIndex`）。
    - 枚举/状态常量：在 `DataDefine` 中定义（如 `self.OpenState = { ... }`）。
- **标准化的生命周期**：严格遵循模块化结构：`ComponentDefine/Destroy`、`DataDefine/Destroy`、`InitData/Ui` 和 `UpdateData/Ui`。
- **布局刷新**：在内容发生重大变化（如切换页签、动态创建列表）后，立即调用 `CS.UnityEngine.UI.LayoutRebuilder.ForceRebuildLayoutImmediate` 以防止 UI 闪烁。

### 类型安全与文档
- **EmmyLua 注解**：广泛编写 `---@class`, `---@field`, `---@param`, `---@return` 等注解，以支持 IDE 智能提示。
- **协议文档化**：在 Manager 文件末尾定义网络协议 Payload 的类结构。

### 逻辑与模式
- **防御性编程**：始终检查数据有效性（如 `if self:InitData(data) then`），并优先使用 `table.IsNullOrEmpty`, `checknumber`, `toInt` 等工具函数。
- **代码组织**：使用 `--region` 和 `--endregion` 划分逻辑块。
- **日志管理**：在 Manager 中封装局部 `Log` 函数，并包装环境检查逻辑。
- **网络流程**：`SendXXXX` 请求方法 with `OnXXXXCallback` 回调处理函数成对出现。
