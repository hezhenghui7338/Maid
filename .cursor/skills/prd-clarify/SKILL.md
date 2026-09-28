---
name: prd-clarify
description: >-
  Pause and clarify when a user request adds, changes, or removes product
  behavior relative to openspec/specs. Present the current spec, the
  implementation, and the new request; wait for confirmation; then write an
  OpenSpec delta before coding. Use when the user asks for a new feature, a
  change to existing product behavior, dropping a capability, something listed
  as out of scope, or when the request conflicts with a locked decision in
  openspec/specs/decisions.
---

# 行为规格澄清

产品行为真源是 `openspec/specs/`。`PRD.md` 只保留背景、定位、用户场景和交付顺序。`RAW_PRD.md` 只保留原始设想，不以它为准。用户意图相对现有规格是**新增 / 修改 / 删除**时：先整理对照、要求澄清；确认后再写 OpenSpec delta，然后才实现。未确认前不改代码、不改规格、不「先做一版再说」。

## 何时必须停

对照 `openspec/specs/`（尤其 `decisions`，以及相关 domain 的 Requirement）。命中即触发：

1. **新增需求**：规格未写，或写在 `decisions` 的「非目标留在范围外」
2. **修改需求**：要改已有 Requirement 的对象或行为，或要改 PRD 里的交付顺序
3. **删除需求**：要拿掉规格已有能力或场景

**拍板冲突单独标出**：新要求若动到 `decisions` 里的 Requirement，澄清里必须单列。默认不当成顺手改规格。其中「原文不写回」「分析由用户手动触发」尤甚。

## 何时不停

按现有规格直接做：

- 修 bug / 对齐规格的实现缺口（实现与规格不一致 → 修实现，不改规格，也不写 delta）
- 纯实现细节（拆函数、测试、重构），不改变用户可见产品行为
- 用户明确说「按规格做」或只问现状

## 对话里怎么做

1. **对照**：读相关 `openspec/specs/<domain>/spec.md`；用例编号相关再读 `TDD.md`。
2. **摸实现**：只读定位当前行为（入口、关键类型）。写清与规格：已对齐 / 部分实现 / 未做。不开始改。
3. **展示并澄清**：用户可见回复必须用下面三个标题（原文，不改写），再用 AskQuestion（或 1–2 个关键问题）锁范围：类型、当前版本 vs 以后、边界/非目标、是否动 `decisions`。
4. **停住**：等用户确认。
5. **确认后**：先 `/opsx-propose` 写出该变更的 proposal、delta、design、tasks，等人看过，再 `/opsx-apply`。不要把同一条行为再写进 `PRD.md`。

### 原需求 / 现在的实现 / 新的需求

```markdown
## 需求差异（需确认后再改规格 / 代码）

**类型**：新增 | 修改 | 删除
**规格锚点**：openspec/specs/…「Requirement 名」
**拍板冲突**：无 | 有（decisions 里哪一条）

### 原需求
- 规格怎么写的（要点，可引用 Requirement）

### 现在的实现
- 代码位置与实际行为
- 与规格：已对齐 / 部分实现 / 未做

### 新的需求
- 根据这次用户原话归纳（不自行加戏）

### 请确认
- 是否按「新的需求」改当前版本规格？
- 范围边界与明确不做
- 若动 decisions：是否接受改这条拍板或把非目标移入当前版本
```

## 确认后改哪些文档

最小范围，不扩写无关章节：

| 变了什么 | 改哪里 |
|----------|--------|
| 产品行为 | `openspec/changes/<name>/` 的 delta；归档时并进 `openspec/specs/` |
| 用例编号或验收映射 | 另改 `TDD.md`，锚点用 Requirement 名 |
| 背景、场景、交付顺序 | 才改 `PRD.md` |
| 流程不变量 | 另改 `.cursor/rules/*.mdc` |

进行中的变更只放在 `openspec/changes/`。不要另建工单库，不要把行为写回 `PRD.md` 当成第二份规格。不要改 `RAW_PRD.md`。

修 bug 且行为已在规格里时，不走 propose，不写 ADDED / MODIFIED / REMOVED。
