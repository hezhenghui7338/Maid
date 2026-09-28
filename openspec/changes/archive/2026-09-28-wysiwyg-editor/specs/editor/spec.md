# Spec Delta

## REMOVED Requirements

### Requirement: 源码与预览同时可见

**Reason**: 分屏源码与预览被单屏所见即所得取代。滚动同步和「预览不可编辑」不再成立。
**Migration**: 以本变更新增的「单屏所见即所得编辑」为准。基础八类语法仍由「基础 Markdown 渲染」覆盖。

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: 基础 Markdown 渲染

**来源**: PRD §13

所见即所得文档 MUST 覆盖标题、段落、列表、引用、代码块、表格、链接和强调，并让用户在同一屏里编辑它们。公式、示意图和复杂扩展语法 MUST NOT 作为当前版本的完成条件。

#### Scenario: 八类基础语法可见

- **WHEN** 用户打开含标题、段落、列表、引用、代码块、表格、链接和强调的文档
- **THEN** 上述八类都在这一屏文档中按对应语义出现
- **AND** 用户能在这一屏里修改其中的文字
