# Spec Delta

## ADDED Requirements

### Requirement: 文件栏用加号新建

左侧文件栏 MUST NOT 再显示「新建、导入、改名、删除、导出」文字按钮。已选择项目时，左侧文件栏左下角 MUST 有一个加号，点击后只新建 Markdown，并沿用填写相对路径后写入文件树的方式。没有项目时该加号 MUST 不可用。顶栏新建项目 MUST 保持独立，MUST NOT 并进这个加号。

#### Scenario: 点加号新建文件

- **WHEN** 用户已选择项目，点击左侧文件栏左下角加号，并填入相对路径
- **THEN** 新 Markdown 出现在文件树中
- **AND** 再次打开时内容仍在

#### Scenario: 文件栏没有文字操作按钮

- **WHEN** 用户查看左侧文件栏
- **THEN** 看不到名为「新建」「导入」「改名」「删除」或「导出」的文字按钮

#### Scenario: 没有项目时加号不可用

- **WHEN** 当前没有选择项目
- **THEN** 左下角加号不可用
