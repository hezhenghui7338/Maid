# model Specification

## Purpose

描述手动分析时如何调用 OpenAI 兼容接口、输出如何受约束，以及失败时如何保留上一轮。来源是原 PRD 第 14 节里除拍板锁以外的运行约束；拍板锁见 decisions。

## Requirements

### Requirement: 兼容 Chat Completions

**来源**: PRD §14

模型调用 MUST 统一走 OpenAI 兼容的 Chat Completions。分析结果 MUST 按接口返回的 JSON 写入索引。

#### Scenario: 请求发往兼容补全接口

- **WHEN** 用户使用一个 OpenAI 兼容地址手动分析一段
- **THEN** 请求发往该地址的 chat completions
- **AND** 分析结果按返回的 JSON 写入索引

### Requirement: 本机 Ollama

**来源**: PRD §14

本机 Ollama 的默认地址 MUST 是 `http://localhost:11434/v1`。API key MUST 可以是该服务接受的任意非空字符串。

#### Scenario: 默认 Ollama 地址可完成分析

- **WHEN** 兼容桩监听 `http://localhost:11434/v1/chat/completions`，且任意非空 API key 都接受，用户用该地址手动分析一段
- **THEN** 请求发往该路径
- **AND** 分析结果按桩的 JSON 写入索引

### Requirement: 可更换兼容地址

**来源**: PRD §14

用户 MUST 能改用其他 OpenAI 兼容的云端地址和密钥。更换之后，同一套分析 MUST 仍可运行，请求 MUST 发往新地址并带上新密钥。

#### Scenario: 更换基地址和密钥后请求跟上

- **WHEN** 用户把基地址和密钥改到另一兼容桩，再分析一段
- **THEN** 请求发往新地址并带上新密钥
- **AND** 分析流程与使用本机 Ollama 时相同

### Requirement: 输出字段受约束

**来源**: PRD §11.3、§14

输出 MUST 使用 JSON 模式或 JSON schema。字段 MUST NOT 超出模型输出结构所定义的标签和任务。状态 MUST 属于四态。非法状态、超出字段的输出 MUST NOT 写入索引。已有上一轮时 MUST 保留上一轮，并告知这段没有更新。

#### Scenario: 非法状态与额外字段被拒绝

- **WHEN** 桩返回状态「未完成」，并额外带一个未定义字段
- **THEN** 这组输出不写入索引
- **AND** 已有上一轮时保留上一轮
- **AND** 界面告知这段没有更新

### Requirement: 失败保留上一轮

**来源**: PRD §14

分析失败时，系统 MUST 保留上一轮索引，并告知这段没有更新。

#### Scenario: 模型错误时索引不变

- **WHEN** 一段已有标签和任务，用户再次分析这段已变化的正文，且模型请求返回错误
- **THEN** 这段索引仍是失败前的标签、任务和状态
- **AND** 界面告知这段没有更新
