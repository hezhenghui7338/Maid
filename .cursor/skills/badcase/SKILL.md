---
name: badcase
description: >-
  Harvest, dedupe, and promote conversation bad cases into tests/badcases,
  then gate releases so previously fixed failures cannot silently return.
  Use in every Maid coding session when the user corrects the agent, reports
  a regression, says a fix came back, a test exposes a real invariant, or when
  preparing a release / tauri build.
---

# Bad Case 采集与发布回归

对话即采集。目录是真源；测试/规则是锁。发布先跑 `scripts/check-badcases.py`，draft 未清空则失败。

## 何时必须记

- 用户纠错，或说「不对 / 还是 / 又坏了 / 之前修过」
- 已确认的产品 bug、回归、JSON/API 契约破裂
- 测试失败暴露的真实不变量（不是 flaky 误杀）
- agent 改完引入的倒退

## 何时不记

- 同一回合内 agent 自己改掉的笔误
- 纯风格偏好、一次性探索
- 尚未确认的猜测

## 文件

| 文件 | 用途 |
|------|------|
| `tests/badcases/draft.jsonl` | 本会话未升格；开发中可有；**禁止带进 release** |
| `tests/badcases/catalog.jsonl` | 正式集：`covered` / `rule` / `wontfix` |
| `scripts/check-badcases.py` | 发布完整性检查 |

写入前用 `rg` 对 `catalog.jsonl` + `draft.jsonl` 搜 `dedupe_key` 与 `title`。命中则更新那一行，不另开条目。

## Schema（一行一条 JSON）

必填：`id` `title` `symptom` `root_cause` `source` `status` `layer` `repro` `dedupe_key`

| 字段 | 说明 |
|------|------|
| `id` | 稳定 id：`bc-YYYYMMDD-slug`。draft 可用 `bc-draft-…`，升格时改稳定 id |
| `source` | `chat:<uuid>`（本机会话）或 `dogfood` / `pr` |
| `status` | `draft` \| `covered` \| `rule` \| `wontfix` |
| `layer` | `vitest` \| `rust` \| `rule` |
| `test` | `path` 或 `path::symbol`；可字符串或字符串数组。`draft` / `wontfix` 可空。TypeScript 的 symbol 用测试名或函数名 |
| `rule` | 可选。`.cursor/rules/` 下文件名，如 `prd-clarify.mdc` |
| `repro` | 最短复现（命令或操作） |
| `dedupe_key` | 短英文 slug |

## 对话里怎么做

1. **发现即写**：追加 `draft.jsonl` 一行，`status: draft`。不打断用户问要不要记。
2. **本任务在修这个坑**：同变更写最小回归测试 → 将该行挪到 `catalog.jsonl`，`status: covered`，填 `test`。从 draft 删掉。
3. **流程不变量**：落 `.cursor/rules/*.mdc`，catalog `status: rule`，`layer: rule`，`test` 为规则文件名。
4. **明确不锁**：catalog `status: wontfix`，写清 `root_cause`。
5. **收尾**：若本对话写过 draft，用一句话列出 id（不贴大段 JSON）。
6. **发布**：先 `python3 scripts/check-badcases.py`。失败则升格、补测试或标 `wontfix`，再打包。

## 与 OpenSpec apply 的衔接

采集规则不变，badcase 不写进 OpenSpec schema。本轮变更走 OpenSpec、且正在修这个坑时：在同一个 change 里补最小回归测试，把该行升到 `catalog.jsonl`，并在 `tasks.md` 里写上 badcase id。行为规格本身没变时，不要为这条 badcase 再写一份 delta。

前端用例放现有 `tests/`，用 Vitest，不要新建专门的 badcase 测试标记。Rust 用例放 `src-tauri` 里现有测试；检查脚本只核对指针存在，执行仍走 `cargo test` / `npm test`。

## 检查失败条件

`scripts/check-badcases.py` 非零退出当：

- `draft.jsonl` 有非空 JSON 行
- `catalog.jsonl` 出现 `status: draft`（draft 只属于 draft 文件）
- `covered` 的 `test` 路径不存在，或代码文件里找不到 `::symbol`
- `status: rule` 但 `.cursor/rules/` 中对应文件不存在
- 缺必填字段，或 `id` / `dedupe_key` 重复
