## Environment

- 本仓提供 Node.js MCP 与用户明确要求的独立 Python Skill 两种交付。Node 部分是 ESM；`package.json` 的 `type` 为 `module`，源码导入保持 ESM 语法和 `.js` 扩展名。
- `skills/wechat-official-account/` 是可独立复制的 Skill，运行时使用 Python 3.10+ 标准库、Windows、Linux 或 macOS，不依赖 Node、MCP 或第三方 Python 包。
- 使用 Node.js 18+、npm 8+。仓库不提交 `node_modules/`；在运行任何依赖 npm 的脚本前先执行 `npm ci`。
- `@modelcontextprotocol/sdk` 固定为 `1.15.0`。除非票面明确要求，不要改依赖、版本或 lockfile。
- 微信凭据仅由服务进程环境变量 `WECHAT_APP_ID`、`WECHAT_APP_SECRET` 注入。封面和正文图片共用允许目录，由 `WECHAT_COVER_DIR` 指定，未设置时为当前工作目录下的 `./covers`。

## Codebase-Specific Conventions

### 所有权与边界

- agent 可在票面授权后修改 `src/**`、`scripts/**`、`skills/wechat-official-account/**`，以及 `package.json` 的 `scripts` 段；每次只修改当前票面列出的路径和行为。
- 微信公众平台后台配置、IP 白名单、公众号权限和密钥轮换属于宿主/发布侧，不在本仓实现。
- `.github/**` 属于宿主/发布侧。除非票面明确要求 CI 或发布配置变更，agent 不得修改。

### 职责范围

- **In scope：** 本仓当前只提供已发布文章列表、文章累计统计查询、HTML 草稿创建、永久封面素材上传和正文图片上传，以及 `access_token` 获取与缓存。正文由调用方准备，原样提交，不解析 Markdown、不自动排版、不生成封面。预览、正式发布、草稿更新/删除均没有工具入口。
- **Out of scope：** 排版设计、样式与主题、美化、封面视觉设计和装饰元素创作不属于本仓职责；不得为了这些目的修改本仓代码或新增能力。
- **越界处理：** 当需求目的属于上述职责外事项（例如“把公众号排版做得更好看”）时，不得静默扩大当前票面；agent 应拒绝并另开票。既有代码的职责收敛也须另行跟踪，不得在无关票面中顺手删除或重构。

### 数据流

- 调用链为：Muse/agent → MCP stdio 服务 → `api.weixin.qq.com` → 微信公众号。MCP 服务负责工具参数校验、图片校验/上传、微信 API 调用和返回字段映射。正文 HTML 不作转换。
- Python Skill 调用链为：agent/用户 → `skills/wechat-official-account/scripts/wechat.py` → 微信 API。命令从 stdin 或 `--input` 文件读取 JSON；stdout 输出业务 JSON，退出码 0/1 表示成功/失败，命令用法错误为 2。图片读取、HTTP、字段映射均在 Python 内实现，不调用 Node。
- Python token 仅缓存在单个进程的 API 实例内，按 `expires_in` 提前 60 秒失效，不落盘。每次 CLI 启动重新获取；与 MCP 不共享 token 缓存。
- `src/services/WeChatAPI.js` 在进程内缓存 `access_token`，有效期采用接口返回的 `expires_in`，并提前 60 秒视为失效；缓存过期后的下一次调用重新获取。离线回归夹具返回 `expires_in: 7200`。
- 不得把仓内没有实现或来源的配额写成事实；本仓没有“每日 2000 次”配额实现或依据。

### 当前工具契约

- `wechat_list_articles`：按 `offset` / `count` 分页读取微信接口可见的已发布记录；`includeContent` 默认 `false`。保留多图文分组，`nextOffset: null` 表示本次结果无下一页。
- `wechat_get_article_stats`：按发表日 `date`（2025-11-01 起、北京时间今天之前的 YYYY-MM-DD）查询 `getarticletotaldetail`，可用统计接口返回的 `msgId` 筛选；保留发表后最多 30 天的累计人数快照及 `isDelayed`，不把人数标注为次数，缺失指标为 `null`，不累加快照、不将 `articleId` 当作 `msgId`。权限和可查询范围以公众号接口为准。
- `wechat_create_draft`：`content` 为已准备的 HTML；`thumbMediaId` / `coverImagePath` 必须二选一；返回 `mediaId` 和 `status: "draft"`。不处理正文图片 URL，不保证外部图片被微信保留。
- `wechat_upload_cover`：接收 `imagePath`，上传永久图片素材并返回 `mediaId`，可用于草稿的 `thumbMediaId`。
- `wechat_upload_article_image`：接收 `imagePath`，调用 `media/uploadimg` 并返回 `url`；仅接受 JPG/JPEG/PNG。调用方将 URL 放入正文 HTML。两个上传工具都受 `WECHAT_COVER_DIR`、1 MB 和文件校验约束，上传失败不返回成功结果。
- MCP 返回 `content[0].text` 内的 JSON；操作成功含 `success: true`，操作失败含 `success: false`、`error`、`message` 并设置 `isError: true`。协议层 schema 拒绝由 MCP SDK 返回错误。
- Python 命令依次为 `list-articles`、`get-article-stats`、`create-draft`、`upload-cover`、`upload-article-image`；使用上述 JSON 参数和业务字段，结果直接输出为 JSON。Python 的 `contentSourceUrl` 限制为 HTTP(S)，参数及图片校验失败均为 `INVALID_ARGUMENT`。凭据不得进入 CLI 参数或输入 JSON。

## Code Value Rules

- 优先做满足票面所需的最小改动，沿用现有模块边界、命名和 ESM 风格。
- 不为假设场景增加安全、冗余、防误用、版本、兼容、fallback 或防御性设计；只有票面明确要求时才实现。
- MCP 工具输入、返回值和错误必须保持可预测；不要把服务内部对象或微信原始响应直接暴露给调用方。
- 日志记录操作结果和必要的非敏感诊断信息，不记录文章正文、标题、摘要、凭据或微信原始响应。

## Pre-release Stance

- 本项目按预发布项目处理。除非票面明确要求，不保留旧接口兼容层、不增加迁移路径、不维护并行实现。
- 可以直接修正当前契约并同步相应测试和文档；不要预置版本协商、弃用期或未来开关。
- 删除或替换实现时保持范围最小，避免顺手重构相邻模块。

## Documentation Layers

- 源码和可执行回归是运行时行为的事实来源；`README.md` 面向使用者，`ARCHITECTURE.md` 提供架构背景，根目录 `AGENTS.md` 是 agent 的工作入口契约。
- 仓库当前没有 `docs/` 分层体系，也没有 `docs/*-design.md` owning design。不要自行引入 L0–L5 目录或设计文档层级。
- No owner: true。当前登记计划是：本仓无 docs 体系，因此没有 owner 文档需要同步；`AGENTS.md` 是第一份面向 agent 的契约文档。未来若需正式分层设计文档或将本契约升级为正式规范，应另开设计票登记新 L3 owner 或并入已有 owner，不在无关票面中预置。

## Tests and Validation

- Python Skill 回归：`python3 -B scripts/python-skill-regression.py`，预期 18 项通过（`Ran 18 tests` / `OK`）；不需要 npm，不使用真实凭据、不联网。覆盖独立拷贝在 `python3 -S` 下执行、API 字段映射、图片边界、上传/草稿及错误脱敏。
- Windows 兼容测试在 Linux 上模拟缺失 Unix 标志、二进制模式、文件替换和旧编码流；不能把模拟通过表述为原生 Windows 验收。Windows 运行完整回归需创建符号链接权限或开发者模式，不跳过该测试。Python CLI 标准流为 UTF-8，参数文件支持 UTF-8 BOM。

- 首次验证或依赖清理后安装锁定依赖：

  ```bash
  npm ci
  ```

  期望：命令退出码为 0，严格按 `package-lock.json` 安装依赖，且 `package-lock.json` 不产生改动。

- 运行仓库的离线回归：

  ```bash
  node --experimental-vm-modules scripts/offline-regression.mjs
  ```

  期望：命令退出码为 0，末行是 `TOTAL 22/22 PASS (offline mocks; no network)`。`--experimental-vm-modules` 不可省略，否则当前 Node 环境会因 `vm.SourceTextModule` 不可用而失败。

- 离线回归使用 HTTP 替身、临时目录和固定夹具，并使用真实 Zod 与 MCP SDK 验证参数和 stdio 握手。子进程中的微信环境变量为空，不联网，也不调用真实微信 API；测试不得依赖真实 AppID、AppSecret、OpenID 或公众号。

## Quality Gates

提交或推送评审前按顺序运行以下门禁：

1. 安装门禁：

   ```bash
   npm ci
   ```

   通过标准：退出码为 0，且 lockfile 无改动。

2. 功能门禁：

   ```bash
   node --experimental-vm-modules scripts/offline-regression.mjs
   python3 -B scripts/python-skill-regression.py
   ```

   通过标准：Node 22 项全部通过，末行是 `TOTAL 22/22 PASS (offline mocks; no network)`；Python 18 项通过，输出 `OK`。

3. 补丁格式门禁：

   ```bash
   git diff --check
   ```

   通过标准：退出码为 0 且无输出。

4. 票面范围门禁：

   ```bash
   git diff --name-only origin/main...HEAD
   ```

   通过标准：输出的每个路径都由当前票面授权，没有额外文件。

### 标定与豁免

- 未来引入任何豁免、白名单或阈值时，必须在同一变更中写清适用规则、证据、owner 和退出条件。
- 只报告不阻断的项必须明确标记为 report-only；不得让其表现为隐式通过或伪装成硬门禁。
- 存量问题挂到可审计基线，新代码即时阻断；不得借存量基线放过新增违规。
- 禁止设置“某日期起转硬”的时间炸弹。门禁转硬必须由明确的后续变更、验证证据和 owner 审批完成。

## Required Rules

以下四条是硬边界，违反任何一条即实现错误：

1. **stdout 零污染。** MCP stdio 的 stdout 只承载 JSON-RPC 协议；Python CLI 的业务命令 stdout 只输出结果 JSON。所有诊断日志一律写 stderr。违反会污染协议帧或 JSON、导致客户端解析失败，因此属于实现错误。
2. **凭据只经环境变量。** `WECHAT_APP_ID`、`WECHAT_APP_SECRET` 不得进入工具 schema，不得打印、入库、写入文件或进入日志。违反会造成凭据泄露并破坏宿主密钥边界，因此属于实现错误。
3. **只存草稿，不预览或正式发布。** 写操作止于封面/正文图片上传及 `draft/add`；不注册预览/发布工具，不调用 `freepublish/submit`、群发或预览接口。不得通过参数或旧入口恢复发布。违反可能造成未授权真实发布，因此属于实现错误。
4. **封面和正文图片路径受 `WECHAT_COVER_DIR` 约束。** 默认目录为 `./covers`；不得绕过 realpath/符号链接边界、普通文件、1 MB 上限和 PNG/JPEG/GIF/WebP 图片魔数校验；正文图片仅接受 PNG/JPEG。违反可能读取或上传允许目录外文件，因此属于实现错误。

## PR Requirements

- PR 标题必须包含 Linear ID，例如 `VIK-23: add repository agent contract`。
- PR body 末尾必须以独立一行写 `Fixes <ID>`，提交 VIK-23 时写 `Fixes VIK-23`。
- 改动只限票面范围；PR body 列出实际改动、逐条门禁命令及实测结果、偏差和 blocker。
- 提交 review 前对照实际 diff 复核 owning-design 声明。若改动触及运行时行为、`lib/**` 或运行时配置语义，必须在同一 PR 更新 owning L3 design 及其 documentation-alignment row；若缺少 owner，必须在 PR body 披露，并在同一 PR 新登记 L3 owner 或并入已有 owner。
- 不提交凭据、真实用户数据、生成的 `node_modules/` 或临时验证产物。

## Docs Update Policy

- 文档必须描述当前已实现、可验证的行为；不要把计划、猜测、外部配额或未实现能力写成事实。
- 行为、命令、环境变量、工具 schema 或运行时配置发生变化时，在同一变更中更新相应用户文档、agent 契约和 owning design；纯内部重构只在外部契约受影响时更新说明。
- 对只改文档的票，逐条回查源码和可执行测试，并确保文档没有扩大实现承诺。
- 本仓当前 No owner 登记计划保持为：没有 `docs/*-design.md` 可同步，`AGENTS.md` 是现有 agent 契约；未来通过单独设计票建立或归并 L3 owner。本规则不是缺少 owner 时跳过登记的豁免。
