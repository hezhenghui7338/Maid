# Spec Delta

## ADDED Requirements

### Requirement: Maid 自管存储

存储 MUST 由 Maid 放在自己的固定位置。用户 MUST NOT 选择这个存储根，也 MUST NOT 把本机任意外部文件夹当作存储根打开。存储根下 MUST 直接是文件夹和 Markdown 文件，文件夹 MUST 能嵌套。界面 MUST NOT 提供新建项目或在项目之间切换。索引 MUST 放在存储根内的旁路目录，不混入正文。

#### Scenario: 存储根下没有项目入口

- **WHEN** 用户打开 Maid 并查看侧栏
- **THEN** 没有项目列表，也没有新建项目
- **AND** 用户可以在存储根下新建文件夹或 Markdown 文件
- **AND** 这些内容位于 Maid 的固定存储位置下
- **AND** 用户不能通过挑选本机任意文件夹来进入或更换存储根

### Requirement: 在选中位置新建文件

用户 MUST 能以文件夹和文件组成的树浏览存储。新建文件时，用户 MUST 只填写名称，MUST NOT 填写跨目录的相对路径。选中文件夹时，新文件 MUST 出现在该文件夹内；选中文件时，新文件 MUST 出现在该文件所在的文件夹内；未选中任何节点时，新文件 MUST 出现在存储根。新建文件 MUST 再次打开时内容仍在。

#### Scenario: 在选中文件夹里新建文件

- **WHEN** 用户选中一个文件夹，新建一篇 Markdown 并写入一段文字
- **THEN** 该文件出现在这个文件夹里
- **AND** 再次打开时内容仍在

#### Scenario: 选中文件时新建到同级

- **WHEN** 用户选中一篇文件并新建 Markdown
- **THEN** 新文件与被选中的文件位于同一文件夹

### Requirement: 新建文件夹

用户 MUST 能新建文件夹。新建时 MUST 只填写名称。选中文件夹时，新文件夹 MUST 出现在其内部；选中文件时，新文件夹 MUST 出现在该文件所在文件夹；未选中时，新文件夹 MUST 出现在存储根。文件夹 MUST 能再嵌套文件夹和文件。

#### Scenario: 在选中文件夹里再建一层

- **WHEN** 用户选中一个文件夹并新建文件夹
- **THEN** 新文件夹出现在被选中的文件夹内
- **AND** 用户能继续在新文件夹里新建文件

## MODIFIED Requirements

### Requirement: 文档文件 id

**来源**: PRD §7.2

每份文档 MUST 在旁路索引里有一个稳定的文件 id。这个 id MUST NOT 写入 Markdown。路径 MUST 只用于打开和展示文件，不作为身份。在存储树内改名后，文件 id MUST 保持不变。检索和跳转都以文档内的段为粒度。

#### Scenario: 改名后文件 id 不变

- **WHEN** 用户在存储树内更改一篇已分析文档的文件名
- **THEN** 该文档的文件 id 不变
- **AND** Markdown 中不出现这个 id

## REMOVED Requirements

### Requirement: Maid 自管项目

**Reason**: 用户确认不再把「项目」当作必须新建和切换的一层。一个管理范围可以是文件，也可以是文件夹。
**Migration**: 由「Maid 自管存储」取代。原有项目文件夹在打开存储根时当作普通文件夹，其索引归并到存储根旁路目录，文件 id 保留。

### Requirement: 在项目中新建 Markdown

**Reason**: 新建文件不再先进入某个项目，也不再让用户手填跨目录相对路径。
**Migration**: 由「在选中位置新建文件」和「新建文件夹」取代。
