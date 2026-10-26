---
name: wechat-official-account
description: 使用 Python 直接调用微信公众号 API，读取已发布文章和阅读、分享、收藏人数，上传封面及正文图片，将准备好的 HTML 保存到草稿箱。适用于公众号内容查询、数据查询和存草稿，不处理 Markdown、排版设计或正式发布；无需 Node.js 或 MCP。
---

# 微信公众号操作

使用本 Skill 自带的 `scripts/wechat.py`，从本文件所在目录解析脚本的绝对路径。需要 Python 3.10+ 和 Windows、Linux 或 macOS，只使用标准库，无需 pip、npm 或 MCP 服务。

## 环境与执行

- 宿主进程环境须提供 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`。只检查是否存在，不显示其值；缺失时请用户通过宿主环境配置，不让用户把密钥写进命令参数、JSON、文件或对话。
- `WECHAT_COVER_DIR` 是封面及正文图片的允许目录，默认当前工作目录的 `./covers`。相对图片路径相对于当前工作目录，不相对于 Skill 或该变量。
- 所有业务命令从 stdin 接收 UTF-8 JSON 对象，也可用 `--input` 读取 UTF-8 参数文件（接受 BOM）。stdout/stderr 使用 UTF-8。输入不包含凭据。
- stdout 输出一个 JSON 结果，成功含 `success: true`，失败含 `success: false`、`error`、`message`；退出码分别为 0 / 1。命令用法错误退出码为 2，诊断写 stderr。
- token 只缓存在单个 Python 进程内，按 `expires_in` 提前 60 秒失效，不落盘。每次启动 CLI 会重新获取 token。

下例的 `/path/to/skill` 必须替换为本 Skill 的实际目录。通过带引号的 heredoc 或程序化 JSON 序列化传入正文，避免 shell 展开 `$`、反引号等文章内容。

```bash
python3 /path/to/skill/scripts/wechat.py list-articles <<'JSON'
{"offset":0,"count":20,"includeContent":false}
JSON
```

Windows PowerShell 使用 `--input`，避免旧版 PowerShell 管道改变中文编码。图片路径可写为 `C:/wechat/covers/cover.png`；反斜杠路径在 JSON 中必须写成 `C:\\wechat\\covers\\cover.png`。

```powershell
'{"imagePath":"C:/wechat/covers/cover.png"}' | Set-Content -Encoding UTF8 .\image-params.json
py -3 C:/path/to/skill/scripts/wechat.py upload-cover --input .\image-params.json
```

宿主需把 `WECHAT_COVER_DIR` 配置为对应图片目录。上面的 Bash heredoc 示例适用于 Linux/macOS；在 PowerShell 中将相同 JSON 写入 UTF-8 文件后使用 `--input`。

## 操作与结果

| 命令 | JSON 参数 | 成功结果（另含 success） |
| --- | --- | --- |
| `list-articles` | `offset` 默认 0；`count` 为 1–20，默认 20；`includeContent` 默认 false | `totalCount`、`itemCount`、`offset`、`nextOffset`、`items` |
| `get-article-stats` | 必需 `date`；可选 `msgId` | `date`、`isDelayed`、`items` |
| `upload-cover` | 必需 `imagePath` | 永久封面素材 `mediaId` |
| `upload-article-image` | 必需 `imagePath` | 正文图片 `url` |
| `create-draft` | 必需 `title`、`content`；`thumbMediaId` / `coverImagePath` 二选一；可选 `author`、`digest`、`contentSourceUrl` | 草稿 `mediaId`、`status: "draft"` |

参数区分大小写，不接受未知字段；布尔值必须是 JSON true/false，不能传字符串。`contentSourceUrl` 必须是 HTTP(S) URL。

### 文章和统计查询

列表走 `freepublish/batchget`，只覆盖微信接口对本账号可见的已发布记录，不包含草稿，不承诺后台全部历史。`count` 的单位是发布记录，每条记录可能含多篇文章。按 `nextOffset` 继续读取，直到它为 null 或已满足用户所需范围。

每条列表记录含 `articleId`、`updateTime`、`articles`；每篇文章含 `index`、`title`、`author`、`digest`、`url`、`thumbMediaId`，要求正文时附带 `content`。`updateTime` 不等同于发表时间。

```bash
python3 /path/to/skill/scripts/wechat.py get-article-stats <<'JSON'
{"date":"2025-11-01"}
JSON
```

统计走 `getarticletotaldetail`。`date` 是文章**发表日期**，必须是 2025-11-01 起至北京时间昨日的有效日期，不是任意统计截止日。可选 `msgId` 是统计接口的文章标识，不能直接用列表的 `articleId` 替代。

统计每项含 `msgId`、`title`、`refDate`、`url`、`publishType` 和 `snapshots`。每个快照含 `statDate`、`readUsers`、`shareUsers`、`favoriteUsers`，对应累计阅读、分享、收藏**人数**。快照覆盖发表后最多 30 天，不要累加；缺失指标为 null，明确的 0 保留为零。空列表不能解释为阅读量为零，`isDelayed` 表示微信的数据延迟标记。数据不是实时统计，非空数据和权限取决于账号。

### 图片与草稿

在用户已要求上传或存草稿的范围内执行对应写操作。仅查询的请求不创建素材或草稿。上传或草稿写入超时后不要自动重试；先报告结果未确认，因为微信可能已完成写入。创建草稿成功后报告 ID，不将其说成已发布。

所有图片必须为允许目录内的普通文件，最大 1 MB，经过 realpath、符号链接边界、扩展名和魔数校验。封面接受 PNG/JPEG/GIF/WebP；正文图片只接受 PNG/JPEG。只上传校验时读取的字节。

```bash
python3 /path/to/skill/scripts/wechat.py upload-cover <<'JSON'
{"imagePath":"/absolute/path/to/covers/cover.png"}
JSON

python3 /path/to/skill/scripts/wechat.py upload-article-image <<'JSON'
{"imagePath":"/absolute/path/to/covers/body.png"}
JSON
```

封面 `mediaId` 来自 `material/add_material?type=image`，用于草稿的 `thumbMediaId`。正文图片 `url` 来自 `media/uploadimg`，由调用方放进 HTML 的 `img src`，不能当作封面 ID 使用。

```bash
python3 /path/to/skill/scripts/wechat.py create-draft <<'JSON'
{"title":"文章标题","content":"<p>已准备好的 HTML。</p>","thumbMediaId":"上一步返回的封面素材 ID"}
JSON
```

有正文图片时，将上传工具实际返回的 URL 放入 `content` 再提交，不能使用示例 URL。也可用 `coverImagePath` 替代 `thumbMediaId`，脚本会先上传封面再存草稿。上传失败时不创建草稿；上传成功但草稿失败时，远端素材可能已保留。

正文原样发送，不转换 Markdown、不自动排版或扫描本地图片链接。微信会自行处理 HTML，可能把 `src` 改为 `data-src`、HTTP 改为 HTTPS、调整图片 URL 的尺寸段。不得承诺读回的 HTML 与输入逐字相同。没有预览、正式发布、草稿更新或删除命令。

## 失败处理

`INVALID_ARGUMENT` 表示输入或图片校验失败，应修正对应参数。`WECHAT_OPERATION_FAILED` 表示凭据、网络、权限或微信响应有问题。按错误提示报告，不读取或打印凭据，不转储 token、HTTP 请求 URL 或微信原始错误响应。IP 白名单、账号权限和密钥轮换由公众号管理员处理，Skill 不绕过这些配置。
