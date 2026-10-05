import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inspect } from 'node:util';

const root = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-security-'));
const logs = [];
const requests = [];
const env = { DEBUG: '1', WECHAT_APP_ID: 'wx1234567890abcdef', WECHAT_APP_SECRET: 'a'.repeat(32) };
let failUpload = false;
let tokenRequests = 0;
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const context = vm.createContext({
  Buffer, URL, Date, setTimeout: fn => fn(),
  process: { env, argv: ['node', 'offline-test'], cwd: () => temp, on() {} },
  console: {
    log() { throw new Error('stdout污染'); },
    warn() { throw new Error('必须统一stderr'); },
    error: (...args) => logs.push(inspect(args))
  }
});
const registered = new Map();
const axios = {
  async get(url, config) {
    requests.push({ url, config }); tokenRequests++;
    assert.equal(config.params.secret, env.WECHAT_APP_SECRET);
    return { data: { access_token: 'offline-token', expires_in: 7200 } };
  },
  async post(url, data, config) {
    requests.push({ url, data, config });
    assert.match(url, /access_token=offline-token/);
    if (url.includes('add_material')) {
      if (failUpload) throw new Error('offline upload failure');
      return { data: { media_id: 'media-123' } };
    }
    if (url.includes('draft/add')) return { data: { media_id: 'draft-123', privateResponse: 'RAW_RESPONSE_SECRET' } };
    if (url.includes('freepublish/submit')) return { data: { publish_id: '123', msg_id: '456', privateResponse: 'RAW_RESPONSE_SECRET' } };
    if (url.includes('freepublish/get')) return { data: { errcode: 0, publish_status: 1 } };
    if (url.includes('uploadnews')) return { data: { media_id: 'news-123' } };
    if (url.includes('mass/preview')) return { data: { errcode: 0, msg_id: '789' } };
    throw new Error(`未预期请求: ${url}`);
  }
};
class FormData {
  fields = [];
  append(...args) { this.fields.push(args); }
  getHeaders() { return { 'content-type': 'multipart/form-data; boundary=offline' }; }
}
const type = () => ({ describe() { return this; }, optional() { return this; }, default(value) { this.defaultValue = value; return this; } });
const mocks = {
  axios: { default: axios }, 'form-data': { default: FormData }, zod: { z: { string: type, boolean: type } },
  '@modelcontextprotocol/sdk/server/mcp.js': { McpServer: class { registerTool(name, config, callback) { registered.set(name, { ...config, callback }); } } },
  '@modelcontextprotocol/sdk/server/stdio.js': { StdioServerTransport: class {} }
};
const cache = new Map();
function synthetic(key, values) {
  return new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context, identifier: key });
}
async function load(specifier, ref = pathToFileURL(root + '/').href) {
  const key = specifier.startsWith('.') || specifier.startsWith('file:') ? new URL(specifier, ref).href : specifier;
  if (cache.has(key)) return cache.get(key);
  let module;
  if (mocks[key]) module = synthetic(key, mocks[key]);
  else if (!key.startsWith('file:')) {
    assert.ok(['fs', 'fs/promises', 'path', 'url'].includes(key), `禁止加载未替身依赖: ${key}`);
    module = synthetic(key, await import(key));
  } else {
    module = new vm.SourceTextModule(await fs.readFile(fileURLToPath(key), 'utf8'), {
      context, identifier: key, initializeImportMeta(meta) { meta.url = key; },
      async importModuleDynamically(spec, referencing) {
        const dynamic = await load(spec, referencing.identifier);
        if (dynamic.status === 'unlinked') await dynamic.link((s, m) => load(s, m.identifier));
        if (dynamic.status === 'linked') await dynamic.evaluate();
        return dynamic;
      }
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
try {
  const { default: Publisher } = await entry('src/tools/wechat-publisher.js');
  const { default: MarkdownConverter } = await entry('src/services/MarkdownConverter.js');
  const { default: Status } = await entry('src/tools/wechat-status.js');
  const { getWeChatAPI } = await entry('src/services/WeChatAPI.js');
  const { validateFilePath, sanitizeParams } = await entry('src/utils/validator.js');
  const covers = path.join(temp, 'covers'); await fs.mkdir(covers);
  const cover = path.join(covers, 'cover.png'); await fs.writeFile(cover, png);
  const article = { title: 'PRIVATE_TITLE', content: 'PRIVATE_BODY_CONTENT', author: '作者', coverImagePath: cover, previewOpenId: 'real_openid' };

  await check('默认covers目录及PNG/JPEG/GIF/WebP魔数', async () => {
    assert.equal((await validateFilePath(cover)).valid, true);
    const signatures = { jpg: Buffer.from('ffd8ff00','hex'), jpeg: Buffer.from('ffd8ffee','hex'), gif: Buffer.from('GIF89a'), webp: Buffer.from('RIFF0000WEBP') };
    for (const [ext, data] of Object.entries(signatures)) {
      const file = path.join(covers, `valid.${ext}`); await fs.writeFile(file, data);
      assert.equal((await validateFilePath(file)).valid, true, ext);
    }
  });
  await check('拒绝遍历、目录外路径/符号链接、伪造魔数、超限文件及空路径', async () => {
    const outside = path.join(temp, 'outside.png'); await fs.writeFile(outside, png);
    const symlink = path.join(covers, 'linked.png'); await fs.symlink(outside, symlink);
    const fake = path.join(covers, 'fake.png'); await fs.writeFile(fake, 'secret-file-content');
    const large = path.join(covers, 'large.png'); await fs.writeFile(large, Buffer.alloc(1024 * 1024 + 1));
    for (const [ext, text] of [['gif', 'GIF89a'], ['webp', 'RIFF0000WEBP']]) {
      const forged = path.join(covers, `forged.${ext}`);
      await fs.writeFile(forged, Buffer.from([...Buffer.from(text)].map(b => b | 0x80)));
      assert.equal((await validateFilePath(forged)).valid, false);
    }
    const dir = path.join(covers, 'directory.png'); await fs.mkdir(dir);
    for (const file of ['', outside, symlink, fake, large, dir, `${covers}/../outside.png`, path.join(covers, 'absent.png')]) {
      assert.equal((await validateFilePath(file)).valid, false, file);
    }
  });
  await check('自定义WECHAT_COVER_DIR及不存在目录明确失败', async () => {
    env.WECHAT_COVER_DIR = temp;
    assert.equal((await validateFilePath(path.join(temp, 'outside.png'))).valid, true);
    env.WECHAT_COVER_DIR = path.join(temp, 'missing');
    assert.equal((await validateFilePath(cover)).valid, false);
    delete env.WECHAT_COVER_DIR;
  });
  await check('校验后的字节不会随文件替换改变', async () => {
    const validated = await validateFilePath(cover);
    await fs.writeFile(cover, 'REPLACED_SECRET');
    await getWeChatAPI().uploadCoverImage(validated.resolvedPath, validated.imageBuffer);
    assert.deepEqual(requests.at(-1).data.fields[0][1], png);
    await fs.writeFile(cover, png);
  });
  await check('默认预览/无确认不会触发真实发布', async () => {
    for (const extra of [{}, { previewMode: false }, { confirmPublish: true }, { previewMode: true, confirmPublish: true }]) {
      const start = requests.length;
      const result = await Publisher.publish({ ...article, ...extra });
      assert.ok(!result.isError);
      assert.ok(requests.slice(start).some(r => r.url.includes('mass/preview')));
      assert.ok(!requests.slice(start).some(r => r.url.includes('freepublish/submit')));
    }
    const start = requests.length;
    const result = await Publisher.publish({ ...article, previewMode: false, previewOpenId: undefined });
    assert.equal(result.isError, true); assert.match(result.content[0].text, /未发布，缺少 confirmPublish/);
    assert.equal(requests.length, start);
  });
  await check('严格布尔确认，字符串不能绕过门禁', async () => {
    const result = await Publisher.publish({ ...article, previewMode: false, confirmPublish: 'true' });
    assert.equal(result.isError, true);
    assert.equal(sanitizeParams({ confirmPublish: 'false' }).confirmPublish, 'false');
  });
  await check('显式确认真实发布，微信token仍在query', async () => {
    const start = requests.length;
    const result = await Publisher.publish({ ...article, previewMode: false, confirmPublish: true, previewOpenId: undefined });
    assert.ok(!result.isError);
    const sent = requests.slice(start);
    assert.ok(sent.some(r => r.url.includes('draft/add')));
    assert.ok(sent.some(r => r.url.includes('freepublish/submit')));
    assert.equal(sent.find(r => r.url.includes('draft/add')).data.articles[0].title, article.title);
  });
  await check('发布/查询共享实例和token，过期与密钥轮换刷新', async () => {
    const client = getWeChatAPI(); const before = tokenRequests;
    assert.ok(!(await Status.query({ msgId: '123' })).isError);
    assert.equal(getWeChatAPI(), client); assert.equal(tokenRequests, before);
    client.tokenExpireTime = 0; await Status.query({ msgId: '123' }); assert.equal(tokenRequests, before + 1);
    env.WECHAT_APP_SECRET = 'b'.repeat(32);
    assert.notEqual(getWeChatAPI(), client); await Status.query({ msgId: '123' }); assert.equal(tokenRequests, before + 2);
    env.WECHAT_APP_ID = 'wxabcdef1234567890'; assert.notEqual(getWeChatAPI(), client);
    env.WECHAT_APP_ID = 'wx1234567890abcdef';
  });
  await check('工具参数中的凭据无效，环境缺失明确报错', async () => {
    delete env.WECHAT_APP_SECRET;
    const start = requests.length;
    for (const result of [await Publisher.publish({ ...article, appSecret: 'a'.repeat(32) }), await Status.query({ msgId: '123', appSecret: 'a'.repeat(32) })]) {
      assert.equal(result.isError, true); assert.match(result.content[0].text, /WECHAT_APP_SECRET/);
    }
    assert.equal(requests.length, start); env.WECHAT_APP_SECRET = 'b'.repeat(32);
  });
  await check('无效封面和上传失败中止流程', async () => {
    const before = requests.length;
    const result = await Publisher.publish({ ...article, coverImagePath: path.join(covers, 'fake.png'), previewMode: false, confirmPublish: true });
    assert.equal(result.isError, true); assert.equal(requests.length, before);
    failUpload = true;
    const fail = await Publisher.publish({ ...article, previewMode: false, confirmPublish: true });
    assert.equal(fail.isError, true); assert.match(fail.content[0].text, /未发布/);
    assert.ok(!requests.slice(before).some(r => r.url.includes('freepublish/submit'))); failUpload = false;
  });
  await check('语义HTML无视觉装饰；无封面不上传，显式封面仍上传', async () => {
    const html = MarkdownConverter.convertToWeChatHTML(`# 一级\n\n## 二级\n\n### 三级\n\n#### 四级\n\n正文 **粗体** *斜体* ~~删除~~ [链接](https://example.com) 和 \`<行内代码>\`\n\n- 列表\n\n> 引用\n\n| 表头 |\n| --- |\n| 单元格 |\n\n\`\`\`html\n<tag>&value\n\`\`\``);
    assert.doesNotMatch(html, /style\s*=|<style/i);
    assert.doesNotMatch(html, /🔹|▶|•/);
    for (const tag of ['h1', 'h2', 'h3', 'h4', 'p', 'strong', 'em', 'del', 'a', 'ul', 'li', 'blockquote', 'table', 'pre', 'code']) {
      assert.match(html, new RegExp(`<${tag}(?:\\s|>)`), tag);
    }
    assert.match(html, /&lt;tag&gt;&amp;value/);
    assert.match(html, /&lt;行内代码&gt;/);

    let start = requests.length;
    let result = await Publisher.publish({ ...article, coverImagePath: undefined });
    assert.ok(!result.isError);
    assert.ok(!requests.slice(start).some(r => r.url.includes('add_material')));
    assert.ok(requests.slice(start).some(r => r.url.includes('uploadnews')));
    assert.ok(requests.slice(start).some(r => r.url.includes('mass/preview')));
    assert.equal(Publisher.generateCoverImage, undefined);
    assert.ok(!(await fs.readdir(temp)).some(n => n.startsWith('auto-cover-')));

    start = requests.length;
    result = await Publisher.publish(article);
    assert.ok(!result.isError);
    assert.ok(requests.slice(start).some(r => r.url.includes('add_material')));
  });
  await check('保留可达test_openid模拟预览，拒绝test_消息ID', async () => {
    const before = requests.length;
    assert.equal((await getWeChatAPI().previewArticle({ previewOpenId: 'test_openid' })).success, true);
    assert.equal(requests.length, before);
    assert.equal((await Status.query({ msgId: 'test_123' })).isError, true);
  });
  await check('MCP schema无凭据字段，安全默认值与共享logger', async () => {
    await entry('src/server.js');
    for (const tool of registered.values()) { assert.ok(!('appId' in tool.inputSchema)); assert.ok(!('appSecret' in tool.inputSchema)); }
    const schema = registered.get('wechat_publish_article').inputSchema;
    assert.equal(schema.previewMode.defaultValue, true); assert.equal(schema.confirmPublish.defaultValue, false);
    await entry('examples/basic-usage.js');
  });
  await check('全链路不向stdout记录日志，不泄露正文/标题/摘要/凭据/原始响应', async () => {
    const output = logs.join('\n');
    for (const privateText of [article.title, article.content, env.WECHAT_APP_SECRET, env.WECHAT_APP_ID, 'RAW_RESPONSE_SECRET']) assert.ok(!output.includes(privateText), privateText);
    const loggerUrl = pathToFileURL(path.join(root, 'src/utils/logger.js')).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import logger from ${JSON.stringify(loggerUrl)}; logger.info('i');logger.debug('d');logger.warn('w');logger.error('e');`], { env: { ...process.env, DEBUG: '1', NODE_ENV: 'development' }, encoding: 'utf8' });
    assert.equal(child.status, 0); assert.equal(child.stdout, '');
    for (const level of ['INFO','DEBUG','WARN','ERROR']) assert.ok(child.stderr.includes(level));
  });
  console.log(`TOTAL ${passed}/${passed} PASS (offline mocks; no network)`);
} finally { await fs.rm(temp, { recursive: true, force: true }); }
