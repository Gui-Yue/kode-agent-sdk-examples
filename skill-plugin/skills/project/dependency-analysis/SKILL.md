---
name: dependency-analysis
description: 分析项目依赖关系，识别过时、冗余或有安全问题的依赖包
---

# 依赖分析技能

## 概述

定期分析项目依赖是维护健康代码库的关键。本技能帮助你识别和处理依赖相关问题。

**启用时机**: 定期检查或升级依赖时

**声明**: "我正在使用 dependency-analysis 技能来分析项目依赖"

## Node.js 项目

### 基础检查

```bash
# 查看过时的包
npm outdated

# 查看依赖树
npm ls

# 查看某个包被谁依赖
npm ls <package-name>

# 检查安全漏洞
npm audit
```

### 分析 package.json

```bash
# 查看生产依赖
cat package.json | jq '.dependencies'

# 查看开发依赖
cat package.json | jq '.devDependencies'

# 统计依赖数量
cat package.json | jq '.dependencies | length'
```

### 清理无用依赖

```bash
# 使用 depcheck 找出未使用的依赖
npx depcheck

# 删除 node_modules 重新安装
rm -rf node_modules package-lock.json
npm install
```

## Python 项目

### 基础检查

```bash
# 列出已安装的包
pip list

# 检查过时的包
pip list --outdated

# 检查安全漏洞
pip-audit
```

### 分析 requirements.txt

```bash
# 生成依赖树
pipdeptree

# 检查版本冲突
pip check
```

## Go 项目

```bash
# 整理依赖
go mod tidy

# 查看依赖图
go mod graph

# 检查更新
go list -m -u all
```

## 分析报告格式

生成依赖分析报告时，使用以下格式：

```markdown
## 依赖分析报告

### 摘要
- 生产依赖: X 个
- 开发依赖: Y 个
- 过时依赖: Z 个
- 安全漏洞: N 个

### 过时依赖

| 包名 | 当前版本 | 最新版本 | 升级建议 |
|------|----------|----------|----------|
| xxx  | 1.0.0    | 2.0.0    | Major 升级，需测试 |

### 安全漏洞

| 包名 | 严重程度 | 描述 | 修复版本 |
|------|----------|------|----------|
| xxx  | High     | ...  | 1.2.3    |

### 建议操作
1. ...
2. ...
```

## 升级策略

### 保守策略（推荐用于生产）
1. 只升级 patch 版本
2. 升级有安全漏洞的包
3. 每次只升级少量包

### 激进策略（用于开发）
1. 升级到最新版本
2. 运行完整测试套件
3. 检查 breaking changes

## 注意事项

- 升级前先查看 CHANGELOG
- Major 版本升级可能有 breaking changes
- 保持 lock 文件同步
- CI 中加入依赖审计
