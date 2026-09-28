# Tasks

## 1. 验收用例

- [ ] 1.1 在 `TDD.md` 对照表和模型接口一节增加 AI-05（换项目与未打开项目时沿用同一套 API，分析打到该地址）、AI-06（从当前项目迁入一次，之后忽略项目内设置）。核对两条都锚到 model 的「API 设置全局一份」或「从当前项目迁入一次」。覆盖 AI-05、AI-06。

## 2. 全局设置文件

- [ ] 2.1 在 Rust 中按路径解析设置：全局 `settings.json` 已存在则只用它；否则把当前项目的 `.maid/settings.json` 复制成全局文件；两边都没有则返回默认 Ollama 地址且不创建全局文件。`cargo test` 覆盖这三种路径。覆盖 AI-01、AI-05、AI-06。
- [ ] 2.2 注册 `load_settings` 与 `save_settings`，只读写应用数据目录的 `settings.json`，不改 `state.json` 的整文件覆盖，也不把设置写回项目目录。确认命令已挂上，且 `cargo test` 仍通过。覆盖 AI-05、AI-06。

## 3. 界面沿用同一份设置

- [ ] 3.1 `host` 增加读写全局设置；启动时无项目加载，打开项目时带项目名再加载一次；保存不再要求已打开项目，并停止写入项目内 `.maid/settings.json`。覆盖 AI-05、AI-06。
- [ ] 3.2 在 `tests/stories.test.tsx` 锁住：未打开项目也能保存；换到另一个项目后设置仍在且分析请求发往该地址和密钥；打开带旧设置的项目会迁入，全局已存在时项目内另一份不会覆盖。把 `bc-20260928-per-project-api-settings` 升到 `tests/badcases/catalog.jsonl` 并指向该测试，从 `draft.jsonl` 删掉。覆盖 AI-02、AI-05、AI-06。
