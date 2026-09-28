# Spec Delta

## ADDED Requirements

### Requirement: 底栏不展示当前接口

底栏 MUST NOT 展示当前模型名，也 MUST NOT 展示基地址。底栏 MUST NOT 提供打开 API 设置的入口。用户 MUST 仍能从工具栏打开 API 设置并修改基地址、密钥和模型。

#### Scenario: 底栏没有模型和地址

- **WHEN** 用户已保存模型名和基地址，并打开一篇文件
- **THEN** 底栏不出现该模型名
- **AND** 底栏不出现该基地址

#### Scenario: 工具栏仍能打开设置

- **WHEN** 用户点击工具栏的「API 设置」
- **THEN** 可以修改基地址、密钥和模型
