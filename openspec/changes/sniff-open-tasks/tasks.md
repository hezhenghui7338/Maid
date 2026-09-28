# Tasks

## 1. 提示词判据

- [x] 1.1 在 `TDD.md` 增加 TK-07、TK-08，并在第 2 节对照表挂上 tasks「只把未完成事项收成任务」「未完成事项的建议状态」。TK-07：会触发模型的段，请求写明只为本段未完成事项建任务；已写明解决、完成、修好，或放弃、取消、不做时任务为空，且不要求收成「已完成」或「已取消」，也不要求用其他段判断。TK-08：同一请求写明正在做、未完成或执行中时建议「进行中」，只是待办时建议「待确认」。核对这两条出现在 `TDD.md`。
- [x] 1.2 只在 `src/core/model.ts` 的系统提示里追加上述判据，保留现有标签句；`parseModelPayload` 与 `analyzeDocument` 的写回不动。补 Vitest，断言会触发模型的请求满足 TK-07、TK-08。顺带确认模型返回「已完成」时仍写入（AN-04），空任务仍不进状态筛选（TK-04）。运行覆盖这些用例的 Vitest，全部通过。
- [x] 1.3 将 `bc-20260928-sniff-open-tasks` 从 `tests/badcases/draft.jsonl` 升到 `catalog.jsonl`，`status` 为 `covered`，`test` 指向覆盖 TK-07 与 TK-08 的用例，并从 draft 删除该行。核对 catalog 有该 id，draft 不再有该 id。
