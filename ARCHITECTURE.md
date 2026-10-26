# WeChat Publisher MCP Architecture

本仓通过 Node.js MCP stdio 服务和独立 Python Skill 提供公众号历史文章、统计查询、图片上传和 HTML 草稿创建。

## 模块与数据流

```text
MCP client
  → src/server.js（工具注册、stdio）
  → src/tools/wechat-articles.js（Zod 参数校验、图片校验/上传、MCP 返回封装）
  → src/services/WeChatAPI.js（token、HTTP 调用、字段映射）
  → api.weixin.qq.com
```

`src/utils/validator.js` 负责本地图片文件边界检查；`src/utils/logger.js` 只写 stderr。`src/index.js` 提供程序入口，包的 bin 和 `npm start` 使用 `src/server.js`。

## Python Skill

`skills/wechat-official-account/SKILL.md` 提供 agent 操作指导；`scripts/wechat.py` 是随 Skill 分发的独立 Python CLI，不依赖仓库其他文件、Node、MCP 或第三方包。运行环境是 Python 3.10+、Windows、Linux 或 macOS。

```text
agent / CLI user
  → wechat.py（JSON 参数、图片校验、token、HTTP、业务字段映射）
  → api.weixin.qq.com
```

五个 Python 命令与下表五项业务操作对应，使用同样的微信接口和业务字段。输入从 stdin 或 `--input` 文件读取，输出直接为 JSON；退出码 0 / 1 表示业务成功 / 失败，命令用法错误为 2。`contentSourceUrl` 只接受 HTTP(S)，输入和图片校验失败统一为 `INVALID_ARGUMENT`。

Python 使用 `urllib.request` 发送 JSON 和 multipart 请求，图片上传直接使用已验证的内存字节。token 只在单次进程的 API 实例内缓存，提前 60 秒失效；每次 CLI 调用重新获取，不使用磁盘缓存，也不与 MCP 共享状态。两种交付均只从环境读取凭据，不自动重试写入。

图片打开按平台选用 `O_BINARY`、`O_NOFOLLOW`、`O_NONBLOCK`；打开前检查普通文件，打开后比较 `lstat` / `fstat` 文件标识并重新解析路径，确认后才读取内容。这样 Windows 缺少 Unix 标志时仍保留文件边界检查。CLI 固定 UTF-8 标准流，参数文件接受 UTF-8 BOM。Windows 分支在 Linux 上模拟验证，尚无原生 Windows 实测记录。

## 微信接口对应关系

| 工具 | 微信接口 | 行为 |
| --- | --- | --- |
| `wechat_list_articles` | `POST /cgi-bin/freepublish/batchget` | offset/count 分页，保留多图文分组；默认 `no_content: 1` |
| `wechat_get_article_stats` | `POST /datacube/getarticletotaldetail` | begin_date/end_date 均为输入发表日；可按统计 msgId 筛选 |
| `wechat_create_draft` | `POST /cgi-bin/draft/add` | 单篇 HTML 草稿，返回 mediaId |
| `wechat_upload_cover` / 草稿本地封面 | `POST /cgi-bin/material/add_material?type=image` | 上传校验后的图片为永久素材，供 thumb_media_id 使用 |
| `wechat_upload_article_image` | `POST /cgi-bin/media/uploadimg` | 上传 PNG/JPEG 正文图片，返回微信 URL |
| 共用 token | `GET /cgi-bin/token` | 从服务环境读取凭据，进程内缓存 |

文章列表的 `articleId` 与统计接口的 `msgId` 不做自动关联。列表返回的更新时间不等同于发表日期。统计使用 `getarticletotaldetail` 的 `detail_list`，将 `read_user`、`share_user`、`collection_user` 映射为阅读、分享、收藏人数，并保留 `statDate` 累计快照和 `is_delay` 延迟标记。允许日期自 2025-11-01 起至北京时间昨日；每篇文章的统计窗口最长为发表后 30 天。缺失指标映射为 `null`，不伪造零值或次数。

旧 `getarticletotal` 在真实接口测试中返回 47009（接口已下线），不保留该接口的兼容或回退路径。字段口径见[微信官方说明](https://developers.weixin.qq.com/doc/service/api/wedata/news/api_getarticletotaldetail.html)。

## 草稿行为

工具先验证参数及本地封面，再获取 API 客户端。提供已有 `thumbMediaId` 时直接创建草稿；提供本地图片时校验并上传图片，再调用 `draft/add`。两种封面来源互斥。

正文 HTML 原样提交。作者、摘要、阅读原文链接仅在调用方提供时发送。不进行 Markdown 转换、样式生成、自动封面生成、自动正文图片上传或 URL 改写。正文图片可通过独立工具上传，由调用方将返回 URL 放入 HTML。预览、正式发布、发布状态查询及模拟成功分支已删除；没有旧入口兼容层。

微信 API 写入操作止于上传封面/正文图片和创建草稿。草稿结果不生成文章 URL，不声称已发布。若图片上传成功但草稿创建失败，上传的永久素材可能仍保留在公众号中；服务不自动删除素材，也不自动重试写入。

## 安全与契约

- stdout 只承载 JSON-RPC，日志仅记录操作类型、结果和必要诊断信息。
- `WECHAT_APP_ID` / `WECHAT_APP_SECRET` 仅通过进程环境注入，不进入工具 schema。
- 客户端按 AppID 缓存在进程内；AppSecret 改变时替换实例。token 按 `expires_in` 缓存，提前 60 秒失效；失效后的下一次调用重新获取。
- 本地封面及正文图片限制于 `WECHAT_COVER_DIR`（默认当前工作目录下 `covers`），保留普通文件、1 MB、图片魔数及路径边界校验。正文图片仅接受 PNG/JPEG。上传使用已校验字节，不再次按路径读取。
- 查询返回选定业务字段，错误不包含微信原始响应、HTTP 请求 URL 或凭据。
- 业务结果封装为 MCP 文本中的 JSON；schema 拒绝由 MCP SDK 处理，其余失败返回 `isError: true`。

公众号权限、IP 白名单和密钥轮换由宿主/公众号管理侧负责。服务没有持久化数据库、队列、自动重试或历史爬取能力。

## 文档对齐

本次行为契约同时体现在 `README.md`（使用方式）、`AGENTS.md`（agent 边界）和离线回归。仓库维持现有 No owner 登记计划：当前无 `docs/*-design.md` 或 L3 owner，本文件提供架构背景；正式设计 owner 的建立仍需独立设计票，不在本次功能收敛中引入文档层级。

| 行为 | 实现 | 验证 |
| --- | --- | --- |
| 查询、图片上传与存草稿 | server.js / wechat-articles.js / WeChatAPI.js | 工具清单、无发布请求、真实 stdio 握手 |
| 独立图片上传 | uploadCover / uploadArticleImage | multipart、结果字段、格式/路径限制、失败脱敏、上传结果组成草稿 |
| 独立 Python Skill | skills/wechat-official-account/scripts/wechat.py | Python 离线 HTTP 替身、CLI JSON/退出码、复制后在 python3 -S 下运行 |
| HTML 不转换 | createDraft | 对比提交正文的完整字符串 |
| 分页和累计统计 | listArticles / getArticleStats | 多图文、末页、空结果、缺失指标、累计快照 |
| 凭据、token、图片、日志边界 | WeChatAPI.js / validator.js / logger.js | 环境缺失、轮换/过期、路径/魔数、日志隐私 |

`scripts/offline-regression.mjs` 共 22 项，HTTP 使用替身，Zod 和 MCP SDK 使用实际锁定依赖；stdio 子进程只调用无凭据及无效参数路径，不访问真实微信。

`scripts/python-skill-regression.py` 共 18 项，只使用标准库、HTTP 替身、固定假凭据和临时目录，验证 Python 五项操作及其文件、凭据、错误和命令行边界，不访问真实微信。
