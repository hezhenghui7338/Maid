# Design

## Context

见 proposal.md。底栏在 `src/ui/App.tsx`：文件过期时左侧换成「需要重新分析」，否则显示路径；右侧按钮显示 `settings.model` 和 `settings.baseUrl`，点击打开 API 设置。过期判断是 `isFileStale`，高亮计算已经在 `stale` 时返回空范围。工具栏已有「API 设置」。

## Goals / Non-Goals

**Goals:**

- 底栏不再出现「需要重新分析」、模型名和基地址。
- 已打开文件时底栏始终显示路径。`isFileStale` 继续挡住旧范围高亮。

**Non-Goals:**

- 不改过期算法、分析触发和 API 设置的保存位置。
- 不删工具栏「API 设置」。
- 不改 `decisions`。

## Decisions

- 只改底栏分支。`stale` 仍传给高亮计算。过期时左侧与未过期一样显示路径；未打开文件仍显示「未打开文件」。
- 去掉底栏的 `.api-status` 按钮。设置面板只由工具栏按钮开关。
- `.stale` 与 `.api-status` 不再被用到就删掉对应样式。
- 测试里拿「需要重新分析」当编辑已反映到界面的等待点，改成等待路径仍在，或直接断言该文案不出现。

备选：整段 `footer.status` 删掉。不做。消息、检索位置和路径还要留在底栏。

## Risks / Trade-offs

- [删掉 `stale` 后旧范围重新高亮当前正文] → 任务只改底栏渲染，高亮里的 `if (stale) return []` 不动。
- [故事测试用过期文案当同步点，改完会空等] → 同步点改到路径或编辑后的稳定节点，AN-08 改为断言文案不出现且无旧高亮。
