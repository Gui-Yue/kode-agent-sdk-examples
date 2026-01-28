/**
 * 安全命令白名单：这些 bash 命令不需要人工审批，自动放行。
 * 判断标准：只读、无副作用、不修改文件系统、不执行任意代码。
 */

// 安全命令前缀（命令本身或 command + 空格）
const SAFE_COMMAND_PREFIXES: string[] = [
  // 文件/目录查看（只读）
  'ls', 'cat', 'head', 'tail', 'less', 'more',
  'wc', 'file', 'stat', 'du', 'df',
  'find', 'locate', 'tree',

  // 文本搜索（只读）
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack',

  // 系统信息（只读）
  'pwd', 'whoami', 'id', 'which', 'type', 'where',
  'echo', 'printf',
  'date', 'uptime', 'uname', 'hostname',
  'env', 'printenv',
  'free', 'top -bn1', 'ps', 'lsof',
  'nproc', 'lscpu', 'arch',

  // 网络查询（只读）
  'curl', 'wget -O -', 'wget --spider', 'wget -q',
  'ping -c', 'dig', 'nslookup', 'host',

  // 版本/帮助查看
  'node --version', 'node -v', 'node -e',
  'npm list', 'npm ls', 'npm view', 'npm info', 'npm show',
  'npm --version', 'npm -v',
  'npx --version',
  'pnpm list', 'pnpm ls', 'pnpm --version',
  'python --version', 'python3 --version', 'python -V', 'python3 -V',
  'pip list', 'pip show', 'pip3 list', 'pip3 show',
  'go version', 'rustc --version', 'cargo --version',
  'java -version', 'javac -version',

  // Git 只读操作
  'git status', 'git log', 'git diff', 'git show',
  'git branch', 'git tag', 'git remote',
  'git ls-files', 'git ls-tree', 'git rev-parse',
  'git describe', 'git blame', 'git shortlog',
  'git stash list', 'git config --list', 'git config --get',

  // 包管理只读
  'npm run lint', 'npm run typecheck', 'npm run check',
  'npm run build', 'npm run test', 'npm test', 'npm run dev',
  'pnpm run lint', 'pnpm run build', 'pnpm run test', 'pnpm test',
  'npx tsc --noEmit', 'npx tsc',

  // 项目构建/测试（通常安全）
  'tsc', 'eslint', 'prettier --check', 'jest', 'vitest', 'mocha',
  'pytest', 'go test', 'cargo test',
  'make check', 'make test', 'make lint',

  // jq / yq 数据处理（只读）
  'jq', 'yq',

  // 其他只读
  'diff', 'cmp', 'md5sum', 'sha256sum', 'shasum',
  'sort', 'uniq', 'cut', 'awk', 'sed -n', 'tr',
  'basename', 'dirname', 'realpath', 'readlink',
];

// 危险子字符串黑名单（即使命令前缀匹配，包含这些也拒绝自动放行）
const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s/,             // 删除
  /\brmdir\b/,
  /\bmkdir\b/,
  /\bmv\s/,             // 移动/重命名
  /\bcp\s/,             // 复制
  /\bchmod\b/,          // 权限修改
  /\bchown\b/,
  /\bsudo\b/,
  /\bsu\s/,
  />\s*/,               // 输出重定向（可能覆盖文件）
  /\bdd\b/,
  /\bkill\b/,
  /\bpkill\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bsystemctl\b/,
  /\bservice\b/,
  /\bnpm\s+publish\b/,
  /\bgit\s+push\b/,
  /\bgit\s+reset\b/,
  /\bgit\s+checkout\b/,
  /\bgit\s+merge\b/,
  /\bgit\s+rebase\b/,
  /\bgit\s+commit\b/,
  /\bgit\s+add\b/,
  /\bcurl\s.*(-X\s*(POST|PUT|DELETE|PATCH)|-d\s)/i,  // curl 写操作
  /\bwget\s.*-O\s+[^-]/,  // wget 下载到文件
  /`[^`]+`/,            // 反引号子命令
  /\$\(/,               // $() 子命令（放宽到仅阻止在危险上下文中）
  /\|\s*(bash|sh|zsh|exec)\b/,  // 管道到 shell
  /;\s*(rm|mv|cp|chmod|chown|sudo)\b/, // 分号后跟危险命令
];

/**
 * 从 inputPreview 中提取 bash 命令字符串。
 * inputPreview 的结构未知，尝试多种常见字段名。
 */
function extractCommand(inputPreview: unknown): string | null {
  if (!inputPreview) return null;
  if (typeof inputPreview === 'string') return inputPreview.trim();
  if (typeof inputPreview === 'object') {
    const preview = inputPreview as Record<string, unknown>;
    // 尝试所有可能的字段名
    const candidates = [
      preview.command, preview.cmd, preview.script, preview.args,
      preview.input, preview.shell, preview.exec, preview.run,
      preview.content, preview.code, preview.value,
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c.trim();
    }
    // 如果是嵌套对象，尝试 JSON stringify 再提取
    // 也可能 inputPreview 本身就是 { command: "ls" } 的简写
    const keys = Object.keys(preview);
    if (keys.length === 1 && typeof preview[keys[0]] === 'string') {
      return (preview[keys[0]] as string).trim();
    }
    // 最后尝试：把整个对象 JSON 化看看是否能匹配
    try {
      const json = JSON.stringify(preview);
      // 如果对象很短，可能就是命令本身
      if (json.length < 500) return json;
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * 判断命令是否安全（可自动放行）。
 * 返回 true = 安全，自动 allow；返回 false = 需要人工审批。
 */
export function isSafeCommand(inputPreview: unknown): boolean {
  const command = extractCommand(inputPreview);
  if (!command) return false;

  // 先检查危险模式
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return false;
  }

  // 提取第一个命令词（处理前导空格、env vars 等）
  const normalized = command.replace(/^\s*(env\s+\S+=\S+\s+)*/, '').trim();

  // 检查是否匹配安全命令前缀
  for (const prefix of SAFE_COMMAND_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(prefix + ' ') || normalized.startsWith(prefix + '\t')) {
      return true;
    }
  }

  return false;
}
