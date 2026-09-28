# Proposal

## Why

接口地址、密钥和模型是整台应用的调用配置，不是某篇项目资料的属性。现在它们写在每个项目的 `.maid/settings.json` 里，切换或新建项目就会回到默认本机 Ollama，用户必须再配一次。

## What Changes

- API 设置（基地址、密钥、模型）改为应用级一份，所有项目共用。
- 保存不再依赖当前是否打开了项目，也不再写入项目目录。
- 尚无全局设置时，用当前已打开项目里的 `.maid/settings.json` 作为全局设置迁入一次；之后不再读取项目内该文件。
- 没有可迁移文件时，仍使用默认本机 Ollama 地址与任意非空密钥约定。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `model`：在「可更换兼容地址」之外，增加 API 设置全局保存与跨项目沿用。不改动 `decisions`：接口形态仍是 OpenAI 兼容 Chat Completions，分析仍须用户手动触发。

## Impact

- 前端：`src/ui/App.tsx` 的设置读取、保存和「请先选择项目」提示。
- 本机存储：应用数据目录中的全局设置文件；项目内 `.maid/settings.json` 只在首次迁移时读取。
- 验收：`TDD.md` 模型接口用例；回归 `bc-20260928-per-project-api-settings`。
- 导出、索引和 Markdown 正文不受影响。
