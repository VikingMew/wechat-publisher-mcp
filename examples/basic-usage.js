/**
 * 直接调用示例。凭据仅从服务环境读取。
 * 导入本文件不会执行请求；示例函数需由调用方显式调用。
 */
import { listArticles, getArticleStats, createDraft } from '../src/tools/wechat-articles.js';

export function listHistory() {
  return listArticles({ offset: 0, count: 20, includeContent: false });
}

export function readStats(date) {
  return getArticleStats({ date });
}

export function saveDraft({ title, content, thumbMediaId }) {
  return createDraft({ title, content, thumbMediaId });
}
