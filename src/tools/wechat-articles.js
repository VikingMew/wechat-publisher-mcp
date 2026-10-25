import { z } from 'zod';
import { getWeChatAPI } from '../services/WeChatAPI.js';
import { validateFilePath } from '../utils/validator.js';
import logger from '../utils/logger.js';

const nonEmpty = () => z.string().refine(value => value.trim().length > 0, '不能为空');

export const listSchema = {
  offset: z.number().int().min(0).default(0).describe('发布记录偏移量，从 0 开始'),
  count: z.number().int().min(1).max(20).default(20).describe('每页发布记录数，1–20'),
  includeContent: z.boolean().default(false).describe('是否返回正文 HTML')
};

export const draftSchema = {
  title: nonEmpty().describe('草稿标题'),
  content: nonEmpty().describe('已准备好的 HTML 正文，原样提交，不转换 Markdown'),
  author: z.string().optional().describe('作者'),
  digest: z.string().optional().describe('摘要；省略时由微信处理'),
  contentSourceUrl: z.string().url().optional().describe('阅读原文链接'),
  thumbMediaId: nonEmpty().optional().describe('已有的永久封面素材 ID；与 coverImagePath 二选一'),
  coverImagePath: nonEmpty().optional().describe('WECHAT_COVER_DIR 内图片路径；与 thumbMediaId 二选一')
};

function isPastDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  const todayInChina = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return value >= '2025-11-01' && value < todayInChina;
}

export const statsSchema = {
  date: z.string().refine(isPastDate, 'date 必须是 2025-11-01 起、北京时间今天之前的有效日期 YYYY-MM-DD')
    .describe('文章发表日期 YYYY-MM-DD；查询发表后最多 30 天内的累计统计快照'),
  msgId: nonEmpty().optional().describe('可选：统计接口返回的 msgId（含文章序号），不是 articleId')
};

const schemas = {
  list: z.object(listSchema).strict(),
  draft: z.object(draftSchema).strict().refine(
    value => (value.thumbMediaId !== undefined) !== (value.coverImagePath !== undefined),
    'thumbMediaId 和 coverImagePath 必须且只能提供一个'
  ),
  stats: z.object(statsSchema).strict()
};

async function execute(operation, params, action) {
  const parsed = schemas[operation].safeParse(params);
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({
        success: false, error: 'INVALID_ARGUMENT',
        message: parsed.error.issues.map(issue => `${issue.path.join('.') || '参数'}: ${issue.message}`).join('; ')
      }) }]
    };
  }
  try {
    const data = await action(parsed.data);
    logger.info('微信操作完成', { operation });
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...data }) }] };
  } catch (error) {
    // 不记录文章、凭据或微信原始响应。
    logger.error('微信操作失败', { operation });
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'WECHAT_OPERATION_FAILED', message: error.message }) }]
    };
  }
}

export function listArticles(params = {}) {
  return execute('list', params, options => getWeChatAPI().listArticles(options));
}

export function getArticleStats(params) {
  return execute('stats', params, options => getWeChatAPI().getArticleStats(options));
}

export function createDraft(params) {
  return execute('draft', params, async options => {
    let thumbMediaId = options.thumbMediaId;
    let cover;
    if (options.coverImagePath !== undefined) {
      cover = await validateFilePath(options.coverImagePath);
      if (!cover.valid) throw new Error(cover.errors.join('; '));
    }
    const api = getWeChatAPI();
    if (cover) thumbMediaId = await api.uploadCoverImage(cover.resolvedPath, cover.imageBuffer);
    return api.createDraft({ ...options, thumbMediaId });
  });
}
