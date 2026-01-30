---
name: commit-message-guide
description: 编写清晰、规范的 Git 提交信息，遵循 Conventional Commits 规范
---

# Git 提交信息指南

## 概述

好的提交信息是项目历史的重要组成部分。本技能帮助你编写清晰、一致、有意义的提交信息。

**启用时机**: 准备提交代码时

**声明**: "我正在使用 commit-message-guide 技能来编写提交信息"

## Conventional Commits 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type（必需）

| Type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `docs` | 文档变更 |
| `style` | 代码格式（不影响功能） |
| `refactor` | 重构（既不是新功能也不是修复） |
| `perf` | 性能优化 |
| `test` | 添加或修改测试 |
| `chore` | 构建过程或辅助工具变动 |

### Scope（可选）

影响范围，如：`auth`、`api`、`ui`、`config`

### Subject（必需）

- 使用祈使语气（"add feature" 而非 "added feature"）
- 首字母不大写
- 结尾不加句号
- 不超过 50 字符

## 示例

### 简单提交

```
feat(auth): add login with Google OAuth

fix(api): handle null response from external service

docs: update README with new installation steps
```

### 带正文的提交

```
feat(cart): add quantity validation

- Validate quantity is positive integer
- Show error message for invalid input
- Disable checkout button when validation fails

Closes #123
```

### Breaking Change

```
feat(api)!: change response format for user endpoint

BREAKING CHANGE: User endpoint now returns nested
address object instead of flat fields.

Before: { "street": "123 Main St", "city": "NYC" }
After: { "address": { "street": "123 Main St", "city": "NYC" } }
```

## 工作流程

### 1. 查看变更

```bash
git status
git diff --staged
```

### 2. 分析变更类型

- 是新功能？→ `feat`
- 是修复？→ `fix`
- 只是格式？→ `style`

### 3. 确定范围

- 影响了哪个模块？
- 如果影响多个模块，考虑拆分提交

### 4. 编写信息

```bash
git commit -m "feat(auth): add password reset functionality"
```

## 常见错误

| 错误 | 正确 |
|------|------|
| `update code` | `fix(parser): handle escaped quotes` |
| `fix bug` | `fix(auth): prevent session timeout on remember-me` |
| `WIP` | 使用 `--fixup` 或完成后再提交 |
| `misc changes` | 拆分成多个有意义的提交 |

## 提交前检查清单

- [ ] type 是否正确？
- [ ] scope 是否准确？
- [ ] subject 是否清晰？
- [ ] 如果有 breaking change，是否标注了？
- [ ] 是否引用了相关 issue？
