import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inspect } from 'node:util';
import { z } from 'zod';

const root = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-offline-'));
const logs = [];
const requests = [];
const env = { DEBUG: '1', WECHAT_APP_ID: 'wx1234567890abcdef', WECHAT_APP_SECRET: 'a'.repeat(32) };
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
let tokenRequests = 0;
let failure = null;
let listResponse = {
  total_count: 3, item_count: 1,
  item: [{ article_id: 'article-123', update_time: 1700000000, private: 'RAW_RESPONSE_SECRET', content: {
    news_item: [
      { title: 'PRIVATE_TITLE', author: '作者', digest: 'PRIVATE_DIGEST', url: 'https://example.com/first', thumb_media_id: 'cover-1', content: '<p>PRIVATE_BODY_CONTENT</p>' },
      { title: '第二篇', url: 'https://example.com/second' }
    ]
  } }]
};
let statsResponse = { is_delay: false, list: [{
  ref_date: '2025-11-01', msgid: '12003_1', title: 'PRIVATE_TITLE', content_url: 'https://example.com/article', publish_type: 1, private: 'RAW_RESPONSE_SECRET',
  detail_list: [
    { stat_date: '2025-11-01', read_user: 8, share_user: 0 },
    { stat_date: '2025-11-02', read_user: 12, share_user: 2, collection_user: 1 }
  ]
}] };
function maybeFail(endpoint) {
  if (failure?.endpoint !== endpoint) return null;
  if (failure.network) throw new Error(`RAW_RESPONSE_SECRET ${env.WECHAT_APP_SECRET}`);
  return { data: { errcode: 48001, errmsg: `RAW_RESPONSE_SECRET ${env.WECHAT_APP_SECRET}` } };
}
const axios = {
  async get(url, config) {
    requests.push({ url, config }); tokenRequests++;
    assert.equal(config.params.secret, env.WECHAT_APP_SECRET);
    return maybeFail('token') || { data: { access_token: 'offline-token', expires_in: 7200 } };
  },
  async post(url, data, config) {
    requests.push({ url, data, config });
    assert.match(url, /access_token=offline-token/);
    const endpoint = new URL(url).pathname;
    const failed = maybeFail(endpoint);
    if (failed) return failed;
    if (endpoint.endsWith('/add_material')) return { data: { media_id: 'cover-123' } };
    if (endpoint.endsWith('/draft/add')) return { data: { media_id: 'draft-123', private: 'RAW_RESPONSE_SECRET' } };
    if (endpoint.endsWith('/freepublish/batchget')) return { data: listResponse };
    if (endpoint.endsWith('/getarticletotaldetail')) return { data: statsResponse };
    throw new Error(`未预期请求: ${endpoint}`);
  }
};
class FormData {
  fields = [];
  append(...args) { this.fields.push(args); }
  getHeaders() { return { 'content-type': 'multipart/form-data; boundary=offline' }; }
}
const registered = new Map();
const context = vm.createContext({
  Buffer, URL, Date,
  process: { env, argv: ['node', 'offline-test'], cwd: () => temp, on() {} },
  console: {
    log() { throw new Error('stdout污染'); },
    warn() { throw new Error('日志必须使用stderr'); },
    error: (...args) => logs.push(inspect(args))
  }
});
const mocks = {
  axios: { default: axios }, 'form-data': { default: FormData }, zod: { z },
  '@modelcontextprotocol/sdk/server/mcp.js': { McpServer: class { registerTool(name, config, callback) { registered.set(name, { ...config, callback }); } } },
  '@modelcontextprotocol/sdk/server/stdio.js': { StdioServerTransport: class {} }
};
const cache = new Map();
function synthetic(key, values) {
  return new vm.SyntheticModule(Object.keys(values), function () {
    for (const [name, value] of Object.entries(values)) this.setExport(name, value);
  }, { context, identifier: key });
}
async function load(specifier, ref = pathToFileURL(root + '/').href) {
  const key = specifier.startsWith('.') || specifier.startsWith('file:') ? new URL(specifier, ref).href : specifier;
  if (cache.has(key)) return cache.get(key);
  let module;
  if (mocks[key]) module = synthetic(key, mocks[key]);
  else if (!key.startsWith('file:')) {
    assert.ok(['fs', 'path', 'url'].includes(key), `禁止加载未替身依赖: ${key}`);
    module = synthetic(key, await import(key));
  } else {
    module = new vm.SourceTextModule(await fs.readFile(fileURLToPath(key), 'utf8'), {
      context, identifier: key, initializeImportMeta(meta) { meta.url = key; }
    });
  }
  cache.set(key, module);
  return module;
}
async function entry(relative) {
  const mod = await load(pathToFileURL(path.join(root, relative)).href);
  if (mod.status === 'unlinked') await mod.link((s, m) => load(s, m.identifier));
  if (mod.status === 'linked') await mod.evaluate();
  return mod.namespace;
}
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
const body = result => JSON.parse(result.content[0].text);
try {
  const { listArticles, createDraft, getArticleStats } = await entry('src/tools/wechat-articles.js');
  const { getWeChatAPI } = await entry('src/services/WeChatAPI.js');
  const { validateFilePath } = await entry('src/utils/validator.js');
  const covers = path.join(temp, 'covers'); await fs.mkdir(covers);
  const cover = path.join(covers, 'cover.png'); await fs.writeFile(cover, png);
  const article = { title: 'PRIVATE_TITLE', content: '<p>PRIVATE_BODY_CONTENT</p>\n<pre>  code\n next</pre>', author: '作者', digest: 'PRIVATE_DIGEST', thumbMediaId: 'existing-cover' };

  await check('默认covers目录及PNG/JPEG/GIF/WebP魔数', async () => {
    assert.equal((await validateFilePath(cover)).valid, true);
    for (const [ext, data] of [['jpg', Buffer.from('ffd8ff00', 'hex')], ['gif', Buffer.from('GIF89a')], ['webp', Buffer.from('RIFF0000WEBP')]]) {
      const file = path.join(covers, `image.${ext}`); await fs.writeFile(file, data);
      assert.equal((await validateFilePath(file)).valid, true, ext);
    }
  });
  await check('拒绝目录遍历、越界符号链接、伪造图片及超限文件', async () => {
    const outside = path.join(temp, 'outside.png'); await fs.writeFile(outside, png);
    const link = path.join(covers, 'link.png'); await fs.symlink(outside, link);
    const large = path.join(covers, 'large.png'); await fs.writeFile(large, Buffer.alloc(1024 * 1024 + 1));
    const fake = path.join(covers, 'fake.png'); await fs.writeFile(fake, 'not an image');
    const directory = path.join(covers, 'dir.png'); await fs.mkdir(directory);
    for (const file of [outside, link, large, fake, directory, '', path.join(covers, '../outside.png')]) {
      assert.equal((await validateFilePath(file)).valid, false, file);
    }
  });
  await check('WECHAT_COVER_DIR与不存在目录', async () => {
    env.WECHAT_COVER_DIR = temp;
    assert.equal((await validateFilePath(path.join(temp, 'outside.png'))).valid, true);
    env.WECHAT_COVER_DIR = path.join(temp, 'missing');
    assert.equal((await validateFilePath(cover)).valid, false);
    delete env.WECHAT_COVER_DIR;
  });
  await check('上传已校验的字节，校验后替换文件不改变上传内容', async () => {
    const validated = await validateFilePath(cover);
    await fs.writeFile(cover, 'replaced');
    await getWeChatAPI().uploadCoverImage(validated.resolvedPath, validated.imageBuffer);
    assert.deepEqual(requests.at(-1).data.fields[0][1], png);
    assert.match(requests.at(-1).url, /type=image/);
    await fs.writeFile(cover, png);
  });
  await check('已有封面创建草稿，HTML原样提交且不发布/预览', async () => {
    const start = requests.length;
    assert.deepEqual(body(await createDraft(article)), { success: true, mediaId: 'draft-123', status: 'draft' });
    const sent = requests.slice(start);
    assert.equal(sent.length, 1);
    assert.match(sent[0].url, /\/draft\/add\?/);
    assert.equal(sent[0].data.articles[0].content, article.content);
    assert.equal(sent[0].data.articles[0].thumb_media_id, article.thumbMediaId);
    assert.equal(sent[0].data.articles[0].digest, article.digest);
  });
  await check('本地封面上传后创建草稿，摘要与作者可省略', async () => {
    const start = requests.length;
    assert.ok(!(await createDraft({ title: '标题', content: '<p>正文</p>', coverImagePath: cover })).isError);
    const sent = requests.slice(start);
    assert.equal(sent.length, 2);
    assert.equal(sent[1].data.articles[0].thumb_media_id, 'cover-123');
    assert.ok(!('author' in sent[1].data.articles[0]));
    assert.ok(!('digest' in sent[1].data.articles[0]));
  });
  await check('草稿参数及封面失败时不创建草稿', async () => {
    const start = requests.length;
    for (const args of [
      { ...article, title: '' }, { ...article, content: 1 }, { ...article, author: 5 },
      { title: 'x', content: '<p>x</p>' }, { ...article, coverImagePath: cover },
      { ...article, thumbMediaId: '' }, { ...article, contentSourceUrl: 'invalid' },
      { ...article, confirmPublish: true },
      { title: 'x', content: '<p>x</p>', coverImagePath: path.join(temp, 'outside.png') }
    ]) assert.equal((await createDraft(args)).isError, true);
    assert.equal(requests.length, start);
    failure = { endpoint: '/cgi-bin/material/add_material' };
    assert.equal((await createDraft({ title: 'x', content: '<p>x</p>', coverImagePath: cover })).isError, true);
    assert.ok(!requests.slice(start).some(r => r.url.includes('/draft/add')));
    failure = null;
  });
  await check('历史文章分页保留多图文分组，默认不返回正文和原始响应', async () => {
    const result = body(await listArticles());
    assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1).data)), { offset: 0, count: 20, no_content: 1 });
    assert.equal(result.totalCount, 3); assert.equal(result.nextOffset, 1);
    assert.equal(result.items[0].articleId, 'article-123');
    assert.equal(result.items[0].articles.length, 2);
    assert.equal(result.items[0].articles[1].index, 1);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_BODY_CONTENT'));
    assert.ok(!JSON.stringify(result).includes('RAW_RESPONSE_SECRET'));
  });
  await check('历史文章可读取HTML，最后一页与空列表正确结束', async () => {
    const result = body(await listArticles({ offset: 2, count: 1, includeContent: true }));
    assert.equal(requests.at(-1).data.no_content, 0);
    assert.equal(result.items[0].articles[0].content, '<p>PRIVATE_BODY_CONTENT</p>');
    assert.equal(result.nextOffset, null);
    const saved = listResponse;
    listResponse = { total_count: 0, item_count: 0, item: [] };
    assert.deepEqual(body(await listArticles()).items, []);
    assert.equal(body(await listArticles()).nextOffset, null);
    listResponse = saved;
  });
  await check('列表参数严格验证，字符串布尔值不被接受', async () => {
    const start = requests.length;
    for (const args of [{ offset: -1 }, { offset: 0.5 }, { count: 0 }, { count: 21 }, { count: '2' }, { includeContent: 'false' }]) {
      assert.equal((await listArticles(args)).isError, true);
    }
    assert.equal(requests.length, start);
  });
  await check('统计按发表日查询，保留累计快照，缺失指标不伪装成零', async () => {
    const result = body(await getArticleStats({ date: '2025-11-01' }));
    assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1).data)), { begin_date: '2025-11-01', end_date: '2025-11-01' });
    const item = result.items[0];
    assert.equal(item.msgId, '12003_1'); assert.equal(item.refDate, '2025-11-01');
    assert.equal(item.snapshots.length, 2);
    assert.equal(item.snapshots[0].readUsers, 8); assert.equal(item.snapshots[1].readUsers, 12);
    assert.equal(item.snapshots[0].shareUsers, 0); assert.equal(item.snapshots[0].favoriteUsers, null);
    assert.equal(item.snapshots[1].favoriteUsers, 1);
    assert.equal(item.url, 'https://example.com/article'); assert.equal(item.publishType, 1);
    assert.equal(result.isDelayed, false);
    assert.ok(!('readCount' in item.snapshots[0]));
    assert.ok(!JSON.stringify(result).includes('RAW_RESPONSE_SECRET'));
  });
  await check('统计ID筛选、空结果和日期校验', async () => {
    assert.equal(body(await getArticleStats({ date: '2025-11-01', msgId: '12003_1' })).items.length, 1);
    assert.deepEqual(body(await getArticleStats({ date: '2025-11-01', msgId: '12003_2' })).items, []);
    const saved = statsResponse;
    statsResponse = { list: [], is_delay: true };
    const empty = body(await getArticleStats({ date: '2025-11-01' }));
    assert.deepEqual(empty.items, []); assert.equal(empty.isDelayed, true);
    statsResponse = saved;
    const start = requests.length;
    for (const date of ['2025-10-31', '2025-11-31', '2024-02-30', '2024-1-1', '', '9999-01-01', new Date(Date.now() + 86400000).toISOString().slice(0, 10)]) {
      assert.equal((await getArticleStats({ date })).isError, true);
    }
    assert.equal(requests.length, start);
  });
  await check('权限/API/网络错误不泄露原始响应或凭据', async () => {
    for (const network of [false, true]) {
      failure = { endpoint: '/cgi-bin/freepublish/batchget', network };
      const result = await listArticles();
      assert.equal(result.isError, true);
      assert.ok(!result.content[0].text.includes('RAW_RESPONSE_SECRET'));
      assert.ok(!result.content[0].text.includes(env.WECHAT_APP_SECRET));
      if (!network) assert.match(body(result).message, /48001/);
    }
    failure = null;
  });
  await check('查询与草稿共享token，按expires_in提前60秒过期，轮换后刷新', async () => {
    const client = getWeChatAPI();
    let before = tokenRequests;
    await createDraft(article); await listArticles(); await getArticleStats({ date: '2025-11-01' });
    assert.equal(tokenRequests, before);
    client.tokenExpireTime = 0;
    const now = Date.now(); await listArticles();
    assert.equal(tokenRequests, ++before);
    assert.ok(client.tokenExpireTime >= now + 7140 * 1000);
    assert.ok(client.tokenExpireTime <= Date.now() + 7140 * 1000);
    env.WECHAT_APP_SECRET = 'b'.repeat(32);
    assert.notEqual(getWeChatAPI(), client); await listArticles(); assert.equal(tokenRequests, ++before);
    env.WECHAT_APP_ID = 'wxabcdef1234567890';
    assert.notEqual(getWeChatAPI(), client); await listArticles(); assert.equal(tokenRequests, ++before);
  });
  await check('凭据仅经环境，缺失或token失败不泄露数据', async () => {
    const start = requests.length;
    delete env.WECHAT_APP_SECRET;
    for (const result of [await listArticles(), await createDraft(article), await getArticleStats({ date: '2025-11-01' })]) {
      assert.equal(result.isError, true); assert.match(body(result).message, /WECHAT_APP_SECRET/);
    }
    assert.equal(requests.length, start);
    env.WECHAT_APP_SECRET = 'c'.repeat(32);
    for (const network of [false, true]) {
      failure = { endpoint: 'token', network };
      const result = await listArticles();
      assert.equal(result.isError, true);
      assert.ok(!result.content[0].text.includes('RAW_RESPONSE_SECRET'));
      assert.ok(!result.content[0].text.includes(env.WECHAT_APP_SECRET));
    }
    failure = null;
  });
  await check('只注册查询与草稿工具，无凭据及发布开关，无Markdown依赖', async () => {
    await entry('src/server.js');
    assert.deepEqual([...registered.keys()], ['wechat_list_articles', 'wechat_get_article_stats', 'wechat_create_draft']);
    for (const tool of registered.values()) {
      for (const field of ['appId', 'appSecret', 'previewMode', 'confirmPublish']) assert.ok(!(field in tool.inputSchema));
    }
    const apiSource = await fs.readFile(path.join(root, 'src/services/WeChatAPI.js'), 'utf8');
    assert.ok(!/freepublish\/submit|mass\/preview|uploadnews/.test(apiSource));
    await assert.rejects(fs.stat(path.join(root, 'src/services/MarkdownConverter.js')), { code: 'ENOENT' });
    assert.ok(requests.every(r => !/freepublish\/submit|mass\/preview|uploadnews/.test(r.url)));
  });
  await check('日志stdout零污染，不记录标题/正文/摘要/凭据/原始响应', async () => {
    const output = logs.join('\n');
    for (const privateText of ['PRIVATE_TITLE', 'PRIVATE_BODY_CONTENT', 'PRIVATE_DIGEST', env.WECHAT_APP_SECRET, env.WECHAT_APP_ID, 'RAW_RESPONSE_SECRET']) assert.ok(!output.includes(privateText));
    const loggerUrl = pathToFileURL(path.join(root, 'src/utils/logger.js')).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import logger from ${JSON.stringify(loggerUrl)}; logger.info('i');logger.debug('d');logger.warn('w');logger.error('e');`], { env: { ...process.env, DEBUG: '1', NODE_ENV: 'development' }, encoding: 'utf8' });
    assert.ifError(child.error);
    assert.equal(child.status, 0); assert.equal(child.stdout, '');
    for (const level of ['INFO', 'DEBUG', 'WARN', 'ERROR']) assert.ok(child.stderr.includes(level));
  });
  await check('真实SDK通过stdio握手、列出工具并调用参数/凭据错误路径', async () => {
    const source = `
      import assert from 'node:assert/strict';
      import { Client } from '@modelcontextprotocol/sdk/client/index.js';
      import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
      const client = new Client({ name: 'offline-regression', version: '1.0.0' });
      const transport = new StdioClientTransport({ command: process.execPath, args: ['src/server.js'], cwd: process.cwd(), env: { WECHAT_APP_ID: '', WECHAT_APP_SECRET: '' }, stderr: 'pipe' });
      let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
      try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(t => t.name), ['wechat_list_articles', 'wechat_get_article_stats', 'wechat_create_draft']);
        await assert.rejects(client.callTool({ name: 'wechat_list_articles', arguments: { count: 21 } }), { code: -32602 });
        const missing = await client.callTool({ name: 'wechat_list_articles', arguments: {} });
        assert.equal(missing.isError, true);
        assert.match(missing.content[0].text, /WECHAT_APP_SECRET/);
        const draft = await client.callTool({ name: 'wechat_create_draft', arguments: { title: 'x', content: '<p>x</p>' } });
        assert.equal(draft.isError, true);
      } finally { await client.close(); }
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: root, env: { ...process.env, WECHAT_APP_ID: '', WECHAT_APP_SECRET: '' }, encoding: 'utf8', timeout: 15000 });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, '');
  });
  assert.equal(passed, 18);
  console.log(`TOTAL ${passed}/18 PASS (offline mocks; no network)`);
} finally { await fs.rm(temp, { recursive: true, force: true }); }
