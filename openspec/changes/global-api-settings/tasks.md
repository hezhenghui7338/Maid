# Tasks

## 1. 验收用例

- [x] 1.1 在 `TDD.md` 对照表和模型接口一节增加全局设置用例。AI-05 已被「底栏不展示当前接口」占用，故记为 AI-06（未打开文件时保存的 API 在重新进入后仍用于分析）、AI-07（从存储里的旧设置迁入一次，之后忽略存储内设置）。两条分别锚到 model 的「API 设置全局一份」和「从当前项目迁入一次」。覆盖 AI-06、AI-07。

## 2. 全局设置文件

- [x] 2.1 在 Rust 中按路径解析设置：全局 `settings.json` 已存在则只用它；否则把当前项目的 `.maid/settings.json` 复制成全局文件；两边都没有则返回默认 Ollama 地址且不创建全局文件。`cargo test` 覆盖这三种路径。覆盖 AI-01、AI-05、AI-06。
- [x] 2.2 注册 `load_settings` 与 `save_settings`，只读写应用数据目录的 `settings.json`，不改 `state.json` 的整文件覆盖，也不把设置写回项目目录。确认命令已挂上，且 `cargo test` 仍通过。覆盖 AI-05、AI-06。

## 3. 界面沿用同一份设置

- [x] 3.1 `host` 增加读写全局设置；启动时无项目加载，打开项目时带项目名再加载一次；保存不再要求已打开项目，并停止写入项目内 `.maid/settings.json`。覆盖 AI-05、AI-06。
- [x] 3.2 在 `tests/stories.test.tsx` 锁住：未打开文件也能保存；重新进入后设置仍在且分析请求发往该地址和密钥；打开带旧设置的存储会迁入，全局已存在时存储内另一份不会覆盖。把 `bc-20260928-per-project-api-settings` 升到 `tests/badcases/catalog.jsonl` 并指向该测试，从 `draft.jsonl` 删掉。覆盖 AI-02、AI-06、AI-07。
