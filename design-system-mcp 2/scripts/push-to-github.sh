#!/usr/bin/env bash
set -euo pipefail
remote_url="${1:?请传入已创建的空 GitHub 仓库 URL}"
case "$remote_url" in
  https://github.com/*/*|git@github.com:*/*) ;;
  *) printf '%s\n' '请输入 GitHub HTTPS 或 SSH 仓库 URL' >&2; exit 1 ;;
esac
project_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$project_directory"
if [[ -e .git ]]; then
  printf '%s\n' '本项目已有 Git 仓库；请按 README 手动核对分支和远程地址后上传。' >&2
  exit 1
fi
npm test
git init
git add .
git commit -m "feat: bootstrap ZERO design-system MCP and assembler skill"
git branch -M main
git remote add origin "$remote_url"
git push -u origin main
