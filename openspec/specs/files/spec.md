# files Specification

## Purpose

描述当前版本对项目内 Markdown 文件的改名、删除、导入和导出，以及不做移动。来源是原 PRD 第 7.5 节。

## Requirements

### Requirement: 改名保留索引

**来源**: PRD §7.5

在同一项目内改名时，文件 id MUST 不变，该文档下的段、标签和任务 MUST 全部保留，并仍能在新路径上检索和回跳。

#### Scenario: 改名后状态还在

- **WHEN** 一篇已分析的文档在同一项目内被改名
- **THEN** 文件 id 不变
- **AND** 段、标签和任务仍可在新路径上检索和回跳

### Requirement: 删除清除索引

**来源**: PRD §7.5

删除文件时，该文件 id 下的段、标签和任务 MUST 一并从索引中删除，检索 MUST NOT 再命中它们。

#### Scenario: 删除后检索不再命中

- **WHEN** 用户删除一篇已分析的文档
- **THEN** 该文件 id 下的段、标签和任务从索引消失

### Requirement: 导出只有正文

**来源**: PRD §7.5

导出或把文件拷出项目时，结果 MUST 只含 Markdown 正文，MUST NOT 包含索引里的标签、任务、状态和文件 id。

#### Scenario: 导出文件与当前正文一致

- **WHEN** 用户把一篇已分析的文档导出到项目外
- **THEN** 导出结果与当前 Markdown 正文一致
- **AND** 其中没有标签、任务、状态和文件 id

### Requirement: 不提供移动

**来源**: PRD §7.5

当前版本 MUST NOT 提供移动文件。系统 MUST NOT 把文件迁到其他目录后再自动接回原来的索引。在系统里把文件挪到项目内另一个目录时，新位置 MUST NOT 继承原文件 id 上的标签和任务，原记录 MUST 按删除处理。

#### Scenario: 产品内没有移动操作

- **WHEN** 用户在 Maid 的文件操作中查找移动
- **THEN** 没有移动操作
- **AND** 在系统里挪到项目内另一目录后打开的文件不继承原文件 id 上的标签和任务

### Requirement: 导入只有正文

**来源**: PRD §7.5

从项目外导入 Markdown 时，系统 MUST 只把正文拷进当前项目。拷入结果 MUST NOT 包含原处索引里的标签、任务和状态。导入 MUST NOT 把外部文件夹整份认成项目。

#### Scenario: 导入不带入外部索引

- **WHEN** 用户把一篇外部 Markdown 导入当前 Maid 项目
- **THEN** 文件树中出现该正文，内容与外部原文一致
- **AND** 项目中不出现外部索引
- **AND** 导入结果上没有标签、任务和状态
- **AND** 外部文件夹本身不会变成一个 Maid 项目
