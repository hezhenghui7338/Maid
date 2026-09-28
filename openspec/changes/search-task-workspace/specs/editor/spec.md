# Spec Delta

## ADDED Requirements

### Requirement: 写作与整理分属两屏

用户 MUST 能在写作屏写文档。写作屏的主区域 MUST 是文件树和正在编辑的文档。写作屏 MUST NOT 在文档下方或文档一角固定一块检索结果或任务列表。进入整理工作区时，该主区域 MUST 让给整理工作区。

#### Scenario: 写作时主区域只有文档

- **WHEN** 用户打开一篇 Markdown 并留在写作屏
- **THEN** 主区域显示该文档
- **AND** 文档下方没有检索命中列表，也没有任务状态下拉
