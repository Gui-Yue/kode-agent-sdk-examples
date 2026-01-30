---
name: using-git-worktrees
description: 使用 Git Worktree 创建隔离的工作空间，支持同时在多个分支上工作
---

# 使用 Git Worktrees

## 概述

Git worktrees 允许你在同一个仓库下创建多个工作目录，每个目录可以检出不同的分支，实现真正的并行开发。

**启用时机**: 当需要在新功能上工作但不想影响当前工作目录时

**声明**: "我正在使用 using-git-worktrees 技能来创建隔离工作空间"

## 核心命令

### 创建 Worktree

```bash
# 创建新分支并关联 worktree
git worktree add ../feature-branch -b feature/new-feature

# 基于现有分支创建 worktree
git worktree add ../hotfix-branch hotfix/urgent-fix
```

### 管理 Worktree

```bash
# 列出所有 worktrees
git worktree list

# 删除 worktree（需要先删除目录）
git worktree remove ../feature-branch

# 清理无效的 worktree 引用
git worktree prune
```

## 工作流程

### 1. 检查现有 Worktrees

```bash
git worktree list
```

### 2. 创建新的工作空间

```bash
# 推荐放在 .worktrees 目录（需要加入 .gitignore）
mkdir -p .worktrees
git worktree add .worktrees/feature-auth -b feature/auth
```

### 3. 在新空间中工作

```bash
cd .worktrees/feature-auth
# 安装依赖
npm install
# 开始开发
```

### 4. 完成后清理

```bash
cd ../..
git worktree remove .worktrees/feature-auth
```

## 最佳实践

| 场景 | 建议 |
|------|------|
| 紧急修复 | 创建 hotfix worktree，不打断当前工作 |
| 代码审查 | 创建 review worktree 检出 PR 分支 |
| 并行功能 | 每个功能一个 worktree |
| 测试不同版本 | 检出不同 tag 到 worktree |

## 注意事项

- 同一分支只能有一个 worktree
- 删除 worktree 目录后要运行 `git worktree prune`
- `.worktrees` 目录应加入 `.gitignore`
