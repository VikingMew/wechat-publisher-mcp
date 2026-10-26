# 微信公众号工具：Python Skill / MCP

提供可独立使用的 Python Skill 和 Node.js MCP 服务，用于读取本公众号已发布文章、查询图文统计、上传封面和正文图片，并将准备好的 HTML 保存到草稿箱。

两种方式覆盖五项操作：

| MCP 工具 | Python 命令 | 用途 |
| --- | --- | --- |
| `wechat_list_articles` | `list-articles` | 分页读取已发布文章信息，可选包含正文 HTML |
| `wechat_get_article_stats` | `get-article-stats` | 按发表日期读取阅读、分享、收藏等累计统计 |
| `wechat_create_draft` | `create-draft` | 保存单篇 HTML 草稿，返回草稿 ID |
| `wechat_upload_cover` | `upload-cover` | 上传永久封面素材，返回素材 ID |
| `wechat_upload_article_image` | `upload-article-image` | 上传正文图片，返回微信图片 URL |

已删除 Markdown 转换、自动封面生成、发送预览、正式发布及旧发布状态查询入口。服务不处理排版设计；正文 HTML 由调用方准备。

## Python Skill：直接使用

Skill 位于 [`skills/wechat-official-account/`](skills/wechat-official-account/SKILL.md)。需要 **Python 3.10+、Windows、Linux 或 macOS**，只使用标准库，无需 Node.js、npm、pip 或 MCP。整个目录可单独复制到支持 Skill 的 agent 中使用。

在 Codex 中安装到技能目录（默认 `~/.codex/skills`；已有同名安装时先确认其内容）：

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/wechat-official-account "${CODEX_HOME:-$HOME/.codex}/skills/"
```

在新会话中用 `$wechat-official-account` 调用，例如“用 `$wechat-official-account` 读取历史文章”或“上传这张封面并把这篇 HTML 存到草稿箱”。凭据和图片目录使用下方环境变量表，需由宿主注入；安装 Skill 本身不包含凭据。

也可直接运行脚本，不需要 agent：

```bash
python3 skills/wechat-official-account/scripts/wechat.py list-articles <<'JSON'
{"offset":0,"count":20,"includeContent":false}
JSON
```

五个命令使用下文相应 MCP 工具的 JSON 参数与业务结果字段。Python 的 `contentSourceUrl` 限制为 HTTP(S) URL；图片或参数校验失败均返回 `INVALID_ARGUMENT`。所有参数默认从 stdin 读取，也可用 `--input /absolute/path/params.json` 读取 UTF-8 JSON 文件。`--help` 查看命令列表。

Python stdout 直接输出一个 JSON 对象；业务成功退出码为 0，失败为 1，用法错误为 2。token 只在单次进程内按 `expires_in` 缓存，提前 60 秒失效；每次启动 CLI 重新获取，不在磁盘存储凭据或 token。完整操作说明见 [SKILL.md](skills/wechat-official-account/SKILL.md)。

Windows PowerShell 可直接使用仓库中的脚本：

```powershell
'{"imagePath":"C:/wechat/covers/cover.png"}' | Set-Content -Encoding UTF8 .\image-params.json
py -3 .\skills\wechat-official-account\scripts\wechat.py upload-cover --input .\image-params.json
```

由宿主设置 `WECHAT_COVER_DIR=C:/wechat/covers` 及公众号凭据。`--input` 接受带或不带 BOM 的 UTF-8 JSON；stdin/stdout/stderr 统一使用 UTF-8。旧版 PowerShell 建议使用参数文件，避免管道编码改变中文。Windows 安装 Skill 时，可将整个 `skills/wechat-official-account` 目录复制到 `$env:CODEX_HOME/skills`，未配置时复制到 `$HOME/.codex/skills`。

## Node.js MCP：安装和接入

需要 Node.js 18+、npm 8+。在仓库目录执行：

```bash
npm ci
```

MCP 客户端配置示例，将路径替换为本机绝对路径：

```json
{
  "mcpServers": {
    "wechat-publisher": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/wechat-publisher-mcp/src/server.js"]
    }
  }
}
```

两种方式均通过宿主的安全环境注入功能或父进程环境提供以下变量。真实凭据不要写进配置文件、仓库或 AI 对话。

| 变量 | 说明 |
| --- | --- |
| `WECHAT_APP_ID` | 必需，公众号 AppID |
| `WECHAT_APP_SECRET` | 必需，公众号 AppSecret |
| `WECHAT_COVER_DIR` | 可选，本地封面和正文图片的允许目录；默认服务工作目录下的 `./covers` |
| `DEBUG` | 仅 Node MCP：设置为非空值时输出调试日志 |
| `NODE_ENV` | 仅 Node MCP：设为 `production` 时关闭 INFO 日志 |

MCP 服务所有日志写 stderr，stdout 只传输 JSON-RPC。MCP 仅支持 stdio，没有 HTTP 监听或 `--help` / `--version` 命令行功能。应由 MCP 客户端直接启动 Node，不使用 `npm start` 作为 stdio 启动命令。

公众号侧需要配置调用机器的出口 IP 白名单，并具备对应的草稿、发布记录及数据分析接口权限。这些配置由公众号管理员处理。本服务不会绕过权限、抓取后台页面或读取其他公众号的数据。

## 读取历史文章

调用 `wechat_list_articles`：

```json
{ "offset": 0, "count": 20, "includeContent": false }
```

- `offset`：非负整数，默认 `0`。
- `count`：整数 `1–20`，默认 `20`，单位为发布记录；一条记录可含多篇文章。
- `includeContent`：严格布尔值，默认 `false`；设为 `true` 返回正文 HTML。

成功结果包含 `totalCount`、`itemCount`、`offset`、`nextOffset` 和 `items`。按返回的 `nextOffset` 继续查询；`null` 表示本次结果没有下一页。

每条记录包含 `articleId`、`updateTime`、`articles`。其中每篇文章包含从 `0` 开始的 `index`、`title`、`author`、`digest`、`url`、`thumbMediaId`；要求正文时附带 `content`。保留多图文分组，不将更新时间标注为群发时间。

底层调用 `freepublish/batchget`，范围是该接口对当前公众号返回的已成功发布记录，不包含草稿；不承诺获取后台全部历史记录。

## 查询阅读、分享、收藏统计

调用 `wechat_get_article_stats`：

```json
{ "date": "2025-11-01" }
```

`date` 是**文章发表日期**，必须是 `2025-11-01` 起、北京时间今天之前的有效 `YYYY-MM-DD` 日期。底层调用 `getarticletotaldetail`，每次查询一天。可选传入该统计接口返回的 `msgId`（例如 `12003_1`）筛选文章。

成功结果包含 `date`、`isDelayed` 和 `items`。`isDelayed` 保留微信返回的数据延迟标记，缺失时为 `null`。每项包含 `msgId`、`title`、`refDate`、`url`、`publishType`、`snapshots`；`publishType` 为 `0` 表示已通知、`1` 表示未开启通知。每个快照包含：

| 字段 | 含义 |
| --- | --- |
| `statDate` | 统计截止日期 |
| `readUsers` | 阅读人数 |
| `shareUsers` | 分享人数 |
| `favoriteUsers` | 微信收藏人数 |

这些是发表后截至相应统计日的**累计快照**，不要把多个快照相加。缺失指标返回 `null`；接口明确返回的 `0` 保留为零。无记录或筛选未命中时返回空 `items`，不代表阅读量为零。

统计不是实时数据，每篇文章仅统计发表日起最多 30 天内的数据；具体可见数据、更新时效及权限由微信决定。当前接入指标是人数，不将其标注为阅读或分享次数。`articleId` 与统计 `msgId` 属于不同标识，不能直接互换。本服务不承诺未接入的点赞、评论等指标。字段和统计口径参见[微信官方接口说明](https://developers.weixin.qq.com/doc/service/api/wedata/news/api_getarticletotaldetail.html)。

## 上传封面和正文图片

两个上传工具都接受 `imagePath`，图片必须位于 `WECHAT_COVER_DIR`（默认 `./covers`）内，最大 1 MB。相对路径按服务工作目录解析；校验普通文件、realpath/符号链接边界、扩展名和图片魔数。上传直接使用校验时读取的字节。

调用 `wechat_upload_cover`（支持 PNG/JPEG/GIF/WebP）：

```json
{ "imagePath": "/absolute/path/to/covers/cover.png" }
```

成功返回：

```json
{ "success": true, "mediaId": "permanent-cover-media-id" }
```

该 `mediaId` 来自永久素材接口 `material/add_material?type=image`，可作为 `wechat_create_draft` 的 `thumbMediaId`。独立上传不会创建草稿。

调用 `wechat_upload_article_image`（仅支持 JPG/JPEG/PNG）：

```json
{ "imagePath": "/absolute/path/to/covers/article-image.png" }
```

成功返回：

```json
{ "success": true, "url": "http://mmbiz.qpic.cn/example" }
```

将返回的 `url` 原样放入正文 HTML 的 `<img src="…">`，再调用 `wechat_create_draft`。正文图片走 `media/uploadimg`，返回 URL，不返回封面素材 ID；参见[微信官方图片上传说明](https://developers.weixin.qq.com/doc/service/api/material/permanent/api_uploadimage.html)。服务不扫描 HTML 自动上传本地图片。重复上传会再次请求微信，已上传图片不会在后续草稿失败时自动删除。

## 保存草稿

调用 `wechat_create_draft`，使用已有的永久封面素材 ID：

```json
{
  "title": "文章标题",
  "content": "<p>已经准备好的 HTML 正文。</p>",
  "author": "作者",
  "digest": "文章摘要",
  "thumbMediaId": "existing-permanent-media-id"
}
```

也可以用 `coverImagePath` 替代 `thumbMediaId`：

```json
{
  "title": "文章标题",
  "content": "<p>已经准备好的 HTML 正文。</p>",
  "coverImagePath": "/absolute/path/to/covers/cover.png"
}
```

`title`、`content` 为非空字符串；`author`、`digest` 和 `contentSourceUrl`（阅读原文 URL）可选。封面 `thumbMediaId` / `coverImagePath` 必须且只能提供一个。不提供摘要时交给微信处理。

本地封面必须是允许目录内的普通文件，最大 1 MB，支持 PNG/JPEG/GIF/WebP，并通过扩展名、魔数和 realpath/符号链接边界校验。相对路径相对于服务工作目录解析，不自动拼到 `WECHAT_COVER_DIR` 下。上传使用校验时读取的字节；校验或上传失败会中止草稿创建。

成功结果：

```json
{ "success": true, "mediaId": "draft-media-id", "status": "draft" }
```

结果表示已保存草稿，可以在公众号后台查看和编辑。服务不会发送预览或正式发布。重复调用会新建草稿，不会更新已有草稿。

正文按输入原样提交：不解析 Markdown、不插入样式、不自动上传或改写正文图片。正文图片应先通过 `wechat_upload_article_image` 上传，再使用返回的 URL；外部图片可能被微信过滤。微信可能将图片 `src` 改为 `data-src` 并将 URL 改为 HTTPS，读回 HTML 不保证与提交内容逐字相同。最终内容以微信处理后的草稿为准。

## 返回格式与错误

工具结果位于 MCP `content[0].text`，内容为 JSON。成功含 `success: true` 及上述业务字段。操作失败设置 `isError: true`，JSON 含 `success: false`、`error`、`message`；`error` 为 `INVALID_ARGUMENT` 或 `WECHAT_OPERATION_FAILED`。MCP schema 层的参数错误由 SDK 返回协议错误。

错误只提供必要说明和微信数字错误码，不直接返回微信原始响应、请求 URL 或凭据。权限错误需要在公众号后台核实权限；统计空列表与接口失败是不同结果。

## 验证

Python Skill 的离线回归仅使用标准库，不需要安装 Node 依赖：

```bash
python3 -B scripts/python-skill-regression.py
```

预期 18 项测试全部通过（`Ran 18 tests` / `OK`），覆盖参数、分页、统计、上传、草稿、token、文件边界和错误脱敏；并将脚本复制到临时目录，用 `python3 -S` 验证可脱离仓库及第三方包运行。测试使用固定假凭据和 HTTP 替身，不联网。

Windows 兼容回归覆盖缺少 Unix 文件标志时的上传/草稿、二进制字节保留、文件替换拒绝，以及非 UTF-8 默认流和 BOM 输入。本次在 Linux 上通过这些模拟测试，尚未在原生 Windows 上实测。Windows 运行完整回归需开启开发者模式或具备创建符号链接的权限；符号链接测试不跳过。

原有 Node.js MCP 的回归：

```bash
npm ci
node --experimental-vm-modules scripts/offline-regression.mjs
git diff --check
```

回归预期最后一行：

```text
TOTAL 22/22 PASS (offline mocks; no network)
```

也可以在依赖安装后运行 `npm test`。测试覆盖 HTTP 模拟调用、独立封面/正文图片上传、上传结果组成 HTML 草稿、HTML 原样提交、草稿不发布、分页、多图文、统计快照、token 缓存、图片安全、日志隐私及真实 MCP SDK stdio 握手；不使用真实公众号凭据或访问微信。

离线验证不能替代公众号联调。实际接入后需验证历史列表、一个有统计数据的发表日期，以及一篇测试草稿在后台可见。

### 真实接口联调记录

2026-10-26 使用微信接口测试号完成以下验证：

| 项目 | 实测结果 |
| --- | --- |
| 获取 `access_token` | 成功 |
| 历史文章列表 | 通过真实 MCP 工具调用成功，返回空列表 |
| 文章统计 | 查询 2026-10-25，通过真实 MCP 工具调用成功，返回空列表，`isDelayed: false` |
| 本地封面上传 | 成功上传为永久图片素材 |
| 创建草稿 | 成功；随后通过微信草稿详情接口读回，确认标题匹配且正文存在 |
| 独立封面上传工具 | 通过真实 MCP 调用成功，返回的素材 ID 可创建草稿 |
| 正文图片上传工具 | 通过真实 MCP 调用成功，返回微信图片 URL |
| 带正文图片的草稿 | 通过真实 MCP 创建成功；读回确认标题匹配、正文图片指向同一图片资源 |

图片联调中微信将 `src` 改为 `data-src`，将 HTTP 改为 HTTPS，并改写图片 URL 末尾的尺寸段；验证按图片资源路径匹配，不要求整条 URL 字符串相等。

联调创建了测试草稿及封面/正文图片，没有发送预览或正式发布。本次图片接口验证额外留下两篇标题含“可删除”的测试草稿，方便在后台查看；服务没有自动清理远端测试素材。凭据、token、素材 ID 和微信原始响应不保存在仓库中。

联调发现旧统计接口 `getarticletotal` 返回 `47009`（接口已下线），已改用 `getarticletotaldetail`；本项目不回退到旧接口。

以上结果证明本次测试号的接口连通和草稿写入链路可用，不代表所有账号均有相同权限。测试号没有已发表文章及统计记录，真实非空列表、多页历史数据和阅读、分享、收藏人数仍需使用有数据的公众号验收；离线回归覆盖这些返回结构和字段映射。

同日新增的 Python Skill 已通过纯 Python CLI（使用 `python3 -S`，无第三方包）完成五项真实调用：历史列表和统计均成功返回空列表，永久封面与正文图片上传成功，草稿创建成功。另通过微信草稿详情接口读回，确认标题及正文图片资源匹配。本次留下了一篇 `Python Skill 完整链路测试（可删除）` 草稿及测试图片，未发送预览或正式发布；凭据及接口原始响应未保存到文件。
