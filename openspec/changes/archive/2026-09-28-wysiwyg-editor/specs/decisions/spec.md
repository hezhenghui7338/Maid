# Spec Delta

## REMOVED Requirements

### Requirement: 源码编辑加实时预览

**Reason**: 用户确认当前版本改为单屏所见即所得，不再接受源码与预览分屏，也不接受两者切换。
**Migration**: 以本变更新增的「单屏所见即所得」为准。

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: 非目标留在范围外

**来源**: PRD §5

当前版本 MUST NOT 提供以下能力：数学公式、示意图的专门编辑；云同步、多人协作、账号体系；知识图谱、双向链接、block 引用；以表格或独立任务卡片作为任务正文的编辑器；在任务面板里改写任务措辞；Windows 或 Linux；未经用户触发的后台自动分析；把用户自选的外部文件夹当作项目打开。

#### Scenario: 界面不能打开外部文件夹

- **WHEN** 用户查看项目入口
- **THEN** 没有把任意外部文件夹当作项目打开的操作
