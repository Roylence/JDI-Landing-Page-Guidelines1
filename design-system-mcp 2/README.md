# ZERO 动态设计系统 MCP

基于《落地页模板库》的可运行 TypeScript MCP 服务，面向页面生成 Agent。项目使用用户指定的 `@modelcontextprotocol/sdk` 包和 stdio 传输，固定依赖版本并提交 lockfile。

设计来源：[ZERO 设计稿](https://relay.jd.com/file/design?id=2115284788339286017&page_id=7%3A11630)。初始快照取自 2026-10-28：14 个模块分类、21 个模块变体、69 个原生变量，品牌语义色为 `color/brand/default → red/600 → #E2211C`。另有 3 套由既有模块组合的业务模板、6 个明确标为工程策略的 Token，共 24 个资产、75 个 Token。

## 运行

需要 Node.js 22 或更高版本。

```sh
cd design-system-mcp
npm ci
npm run build
npm test
npm start
```

`npm start` 启动后等待 MCP 客户端通过 stdin/stdout 通信，不显示网页，也不向 stdout 打印普通日志。开发时可用 `npm run dev`。更换机器或项目目录后无需修改服务代码，数据路径基于模块位置解析。

## 接入 Cursor / 其他 MCP 客户端

复制 `.cursor/mcp.json.example` 为 `.cursor/mcp.json`，将路径改为此项目的真实绝对路径：

```json
{
  "mcpServers": {
    "design-system": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/design-system-mcp/dist/index.js"]
    }
  }
}
```

若客户端找不到 Node，将 `command` 改成 Node 可执行文件的绝对路径。启用服务后应能看到以下三个 Tool。可选环境变量 `DESIGN_SYSTEM_DATA_FILE` 指向另一个完整快照文件；相对路径相对于启动目录解析，推荐绝对路径。工具参数不接受文件路径。

| Tool | 示例参数 | 返回 |
| --- | --- | --- |
| `search_assets` | `{"category":"hero","keyword":"Banner","limit":10,"offset":0}` | ID、名称、分类、来源节点、总数、下一页偏移 |
| `get_asset_structure` | `{"asset_id":"zero-7-5994"}` | 语义树、文案、布局意图、Token 引用 |
| `get_design_tokens` | `{}` 或 `{"prefix":"color/brand/"}` | 原始 Token、解析后的别名、CSS 变量 |

所有成功响应均附带 `revision`（文件内容 SHA-256）、`readAt` 与 `source`。未知 ID 返回 `isError:true`；无匹配搜索返回空数组。输入验证、Token 值/单位、别名循环、缺失引用、重复资产 ID 和坐标字段均有校验。失败时不生成兜底资产。

## 动态更新的边界

每次 Tool 调用都重读 `data/design-system.json`，因此本地文件更新无需重启进程；这是“实时读取最新本地映射”，不是每次访问远端 ZERO。使用一个文件承载资产与 Token，避免两个文件分别更新造成版本错配。Agent 仍须核对多次调用的 revision 是否一致。

要同步远端设计稿，先启动并登录 ZERO 桌面端，确认 `zero status` 正常，再执行：

```sh
npm run build
npm run sync:zero
```

同步脚本执行已保存的只读导出脚本，读取全量原生变量和模块文本，生成临时文件，通过实际 MCP 协议校验后原子替换快照。CLI 的 `--yes` 是脚本命令的执行要求；本项目导出脚本只有读取操作，不修改设计稿。新增或删除分类、节点顺序/命名语义变化应人工审阅适配规则。多模式集合会拒绝同步，需先实现显式 mode 映射。脚本/模式/原生 API 变化时，按 ZERO 官方文档更新脚本后再执行。

也可先导出，再导入：

```sh
zero --json design script --designId 2115284788339286017 \
  --file scripts/export-zero.js \
  --description '只读导出模块文本和设计变量' --yes > /tmp/zero-export.json
npm run import:zero -- /tmp/zero-export.json
```

独立运行 `zero design script` 前应按 CLI 要求阅读 `zero docs show design/SKILL.md` 和相关 API/变量文档。`sync:zero` 已读取必要文档；执行者也应先审阅导出脚本。

### 数据来源与转换

- 原生变量保留名称、来源 ID、类型和别名；数值 Token 使用 px 单位。
- 文本与层级来自原稿；语义角色、最近字号 Token、stack 布局和默认间距是显式工程适配规则，不是逐像素布局结果。不要直接把这些默认值视为所有变体的视觉定稿。
- `breakpoint/mobile=768px`、`breakpoint/tablet=1024px`、`columns/one|two|three` 和 `line-clamp/subtitle=2` 是新增工程策略，`origin=implementation-policy`；原稿变量标为 `origin=zero`。
- 语义树不包含 x/y、绝对变换或绝对边界。素材保留来源节点 ID；插画、标志等应从 ZERO 正式导出并接入项目资产管理，不依赖临时 localhost 链接。
- 模板文案和客户证据仍须业务审核。此项目没有创建真实报价、评价、接口数据或已实现的 UI 组件。

## Skill

完整规约按要求位于 `.cursor/skills/design-system-assembler.md`。同时提供内容一致的 `.cursor/skills/design-system-assembler/SKILL.md`，供 Cursor 原生发现。修改时同步两份文件，测试会检查一致性。四步 SOP 是可观察的执行与交付流程，不要求模型公开内部推理。

## GitHub 首次上传

先在 GitHub 创建一个空仓库（不要预生成 README、License 或 .gitignore），确保本机已具备该仓库的写入权限；HTTPS 使用 Git credential helper/PAT，或使用 SSH。不要把令牌写进 URL、脚本或仓库。

在本项目目录执行以下步骤，将 `YOUR_ORG/YOUR_REPO` 替换为实际仓库：

```sh
npm ci
npm test
git init
git add .
git commit -m "feat: bootstrap ZERO design-system MCP and assembler skill"
git branch -M main
git remote add origin https://github.com/YOUR_ORG/YOUR_REPO.git
git push -u origin main
```

也可执行 `bash scripts/push-to-github.sh https://github.com/YOUR_ORG/YOUR_REPO.git`，它会检查当前目录、运行验证后完成相同步骤；已有 `.git` 时会停止，避免覆盖既有仓库设置。上述指令由使用者执行，本次生成未创建 GitHub 仓库、未推送任何文件。首次提交包含来源设计文本与节点 ID，请选择团队允许的仓库可见性。

## 文件结构

```text
package.json / package-lock.json / tsconfig.json
src/index.ts                         三个 Tool、数据校验、别名解析
data/design-system.json              可编辑且带来源的本地资产与 Token 快照
scripts/export-zero.js               ZERO 只读导出脚本
scripts/sync-zero.mjs                 同步/导入与语义适配
scripts/validate-snapshot.mjs         通过实际 MCP 验证候选快照
scripts/push-to-github.sh             使用者执行的首次上传脚本
tests/protocol.test.mjs               stdio 端到端测试
.cursor/mcp.json.example              MCP 客户端配置示例
.cursor/skills/design-system-assembler.md
.cursor/skills/design-system-assembler/SKILL.md
```

## 参考

- [MCP TypeScript SDK v1：Server](https://ts.sdk.modelcontextprotocol.io/server)（本项目遵循所要求的 `@modelcontextprotocol/sdk` 包 API）
- [Cursor Agent Skills](https://cursor.com/docs/skills)（原生发现入口为技能目录中的 `SKILL.md`）

## 本机安装与联调验证

已安装到 Codex 和 Cursor 的用户技能目录，并注册 `design-system` MCP。新回合或重新加载 MCP 后可使用技能；新会话的自动发现需要由宿主完成。

```sh
npm run test:installed
```

此检查读取两端已安装 Skill，核对与项目版本一致，再使用 Cursor 实际 MCP 配置执行 AI 开发者工具场景：读取 Token、检索模板、选择模块、读取结构、验证来源及 Token 引用，最后生成 `verification/skill-mcp-smoke.json`。该本机报告不加入 Git；测试显式执行 Skill SOP，不宣称验证了宿主模型的自动触发。
