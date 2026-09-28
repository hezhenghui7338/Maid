# Design

## Context

文件栏入口在 `src/ui/App.tsx` 的 `.file-actions`：五个文字按钮调用 `createFile`、`importFiles`、`renameFile`、`deleteFile`、`exportFile`。后三者绑定当前打开路径 `path` 和编辑器草稿 `draft`。`exportFile` 把 `exportDocument(draft)` 交给 `host.exportText`。样式在 `src/ui/app.css`。交互测试在 `tests/stories.test.tsx`，用按钮名「新建」点出新建对话框。FL-01 至 FL-05 的索引语义在核心层已有测试，本变更不改那些语义。

## Goals / Non-Goals

**Goals:**

- 文件栏用左下角加号新建，右键菜单承接导入、改名、删除、导出。
- 改名、删除、导出针对右键点中的路径；打开中的文件被改名或删除时，编辑器路径和内容跟着变。
- 空文件树仍能从空白处右键导入。

**Non-Goals:**

- 不改顶栏「新建项目」。
- 不改改名保留索引、删除清除索引、导入导出只有正文、以及不提供移动。
- 不加键盘菜单，也不做多选。

## Decisions

1. **加号是文件栏底部的一个按钮，可见标签是「+」，无障碍名称是「新建文件」。** 与顶栏「新建项目」分开。没有项目时 `disabled`。点击仍走现有 `createFile` 对话框。
2. **右键菜单是文件栏内的浮层，不是系统菜单。** `contextmenu` 阻止默认行为。点文件行时目标是该路径；点文件栏空白时目标为空，菜单只留「导入」。点菜单外或按 Esc 关闭。
3. **导出按目标取正文。** 目标是当前打开文件时导出 `draft`（含未保存修改）。目标是其他文件时先 `readText` 再 `exportDocument`，不把打开文件的草稿写进去。
4. **改名、删除收到显式路径参数。** 改的是右键路径。若该路径正打开，改名后更新 `path`；删除后清空 `path` 和 `draft`。不是当前文件时，不切换打开的文档。

## Risks / Trade-offs

- [测试仍用按钮名「新建」精确匹配] → 实现时把 `tests/stories.test.tsx` 的入口改成「新建文件」，并断言旧文字按钮不在。
- [空白处右键和文件行右键抢事件] → 文件行 `stopPropagation`，空白处由文件栏容器接收。
- [导出未打开文件时磁盘落后于上次未保存] → 打开另一份文件前现有 `openFile` 已 `saveDraft`。本变更不新增自动保存。
