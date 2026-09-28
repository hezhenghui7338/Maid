# decisions Specification

## Purpose

锁定当前版本已经拍板的产品边界，以及明确不进入当前版本的事项。未得到明确确认前，不得改写这些条款。来源是原 PRD 第 4、5 节，以及第 14 节里「分析必须手动」和「原文不写回」。

## Requirements

### Requirement: 单屏所见即所得

编辑体验 MUST 是单屏所见即所得。打开文档时，用户看到的 MUST 是已渲染的文档，输入和修改 MUST 发生在这一屏上。产品 MUST NOT 同时展示源码和预览，也 MUST NOT 提供源码模式或源码与所见即所得的切换。磁盘上的正文 MUST 仍是 Markdown。

#### Scenario: 打开文档时只有一屏渲染文档

- **WHEN** 用户在 Maid 项目中打开一篇 Markdown
- **THEN** 界面上只有一屏已渲染的文档
- **AND** 没有并列的源码区
- **AND** 没有切换到源码模式的入口

#### Scenario: 在渲染文档中输入会改动正文

- **WHEN** 用户在这屏文档中输入或修改文字
- **THEN** 屏幕上的文档随输入更新
- **AND** 保存后的 Markdown 包含这次修改

### Requirement: 原文不写回

**来源**: PRD §4、§14

标签、任务和段时间信息 MUST 放在项目内旁路索引。系统 MUST NOT 把它们写回 Markdown，也 MUST NOT 插入 HTML 注释或其他锚点。

#### Scenario: 分析与手改都不改原文

- **WHEN** 用户手动分析一篇文档，或手改标签与任务状态
- **THEN** 该 Markdown 的字节与操作前一致
- **AND** 文件中不出现标签、状态或锚点

### Requirement: 分段由程序完成

**来源**: PRD §4、§14

分段 MUST 由程序按文档结构完成。模型 MUST 只对已经切好的段打标签、嗅探任务。模型 MUST NOT 负责分段，也 MUST NOT 改写原文。

#### Scenario: 模型响应只用于标签和任务

- **WHEN** 用户完成一次分析
- **THEN** 段边界与分段程序在分析前的输出一致
- **AND** Markdown 字节不变
- **AND** 模型响应只被用于标签和任务

### Requirement: 再分析先对齐再生成

**来源**: PRD §4

正文变更后的下一轮分析 MUST 先把新段与上一轮段对齐，并把旧标签和旧任务状态作为参照，然后再生成新结果。

#### Scenario: 一对一的已改段带上上一轮参照

- **WHEN** 一段正文已变，且与上一轮仍能一对一对齐
- **THEN** 本轮模型输入包含上一轮标签和上一轮任务状态
- **AND** 程序在生成新结果之前完成这次对齐

### Requirement: 分析由用户手动触发

**来源**: PRD §4、§14

分析 MUST 由用户手动触发。程序 MUST 只标出哪些段已经过期，MUST NOT 在后台自动调用模型。

#### Scenario: 只改保存不分析时没有模型请求

- **WHEN** 用户打开文档并修改保存，且没有点击分析
- **THEN** 没有发往模型的请求

### Requirement: 平台与模型接口形态

**来源**: PRD §4

应用平台 MUST 是 macOS。模型接口 MUST 是 OpenAI 兼容的 Chat Completions，并且 MUST 能覆盖本机 Ollama 和云端兼容服务。

#### Scenario: 兼容地址可以完成分析

- **WHEN** 用户把模型指到本机 Ollama 或另一个 OpenAI 兼容地址
- **THEN** 同一套手动分析可以运行

### Requirement: 非目标留在范围外

**来源**: PRD §5

当前版本 MUST NOT 提供以下能力：数学公式、示意图的专门编辑；云同步、多人协作、账号体系；知识图谱、双向链接、block 引用；以表格或独立任务卡片作为任务正文的编辑器；在任务面板里改写任务措辞；Windows 或 Linux；未经用户触发的后台自动分析；把用户自选的外部文件夹当作项目打开。

#### Scenario: 界面不能打开外部文件夹

- **WHEN** 用户查看项目入口
- **THEN** 没有把任意外部文件夹当作项目打开的操作
