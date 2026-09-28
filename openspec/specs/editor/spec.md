# editor Specification

## Purpose

描述用户如何进入 Maid 自己创建的项目、编辑 Markdown，以及文档在索引中的身份。来源是原 PRD 第 7.1、7.2 节和第 13 节。

## Requirements

### Requirement: Maid 自管项目

**来源**: PRD §7.1

项目 MUST 由 Maid 创建，存放在 Maid 自己的固定存储位置中。用户 MUST NOT 选择这个存储根目录，也 MUST NOT 把本机任意外部文件夹当作项目打开。一个项目 MUST 等于该存储位置下的一个文件夹。用户 MUST 能在已创建的项目之间切换，并新建项目。索引 MUST 存放在该文件夹内的旁路目录中，不混入正文。

#### Scenario: 新建项目只出现在 Maid 存储中

- **WHEN** 用户在 Maid 中新建一个项目
- **THEN** 该项目出现在项目列表中
- **AND** 其文件夹位于 Maid 的固定存储位置下
- **AND** 用户不能通过挑选本机任意文件夹来创建或进入项目

### Requirement: 单屏所见即所得编辑

编辑器 MUST 只显示一篇已渲染的文档。用户 MUST 能直接在这屏文档里输入和修改。修改 MUST 写回该文件的 Markdown。界面 MUST NOT 并列源码区，MUST NOT 提供源码模式。

#### Scenario: 输入发生在渲染文档上

- **WHEN** 用户打开一篇文档并在其中输入文字
- **THEN** 输入出现在这同一屏已渲染的文档里
- **AND** 界面没有与之并列的源码区

#### Scenario: 再次打开仍是这份 Markdown

- **WHEN** 用户在渲染文档中写入一段文字并再次打开该文件
- **THEN** 这段文字仍在
- **AND** 文件内容是 Markdown

### Requirement: 基础 Markdown 渲染

**来源**: PRD §13

所见即所得文档 MUST 覆盖标题、段落、列表、引用、代码块、表格、链接和强调，并让用户在同一屏里编辑它们。公式、示意图和复杂扩展语法 MUST NOT 作为当前版本的完成条件。

#### Scenario: 八类基础语法可见

- **WHEN** 用户打开含标题、段落、列表、引用、代码块、表格、链接和强调的文档
- **THEN** 上述八类都在这一屏文档中按对应语义出现
- **AND** 用户能在这一屏里修改其中的文字

### Requirement: 在项目中新建 Markdown

**来源**: PRD §7.1、§13

用户 MUST 能以文件树浏览项目，并在项目中新建 Markdown。新建文件 MUST 出现在项目文件夹和文件树中，再次打开时内容仍在。

#### Scenario: 新建文件可再次打开

- **WHEN** 用户在项目中新建一篇 Markdown 并写入一段文字
- **THEN** 文件出现在项目文件夹和文件树中
- **AND** 再次打开时内容仍在

### Requirement: 文档文件 id

**来源**: PRD §7.2

每份文档 MUST 在旁路索引里有一个稳定的文件 id。这个 id MUST NOT 写入 Markdown。路径 MUST 只用于打开和展示文件，不作为身份。同一项目内改名后，文件 id MUST 保持不变。检索和跳转都以文档内的段为粒度。

#### Scenario: 改名后文件 id 不变

- **WHEN** 用户在同一项目内更改一篇已分析文档的文件名
- **THEN** 该文档的文件 id 不变
- **AND** Markdown 中不出现这个 id
