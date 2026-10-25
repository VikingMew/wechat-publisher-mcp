import axios from 'axios';
import FormData from 'form-data';
import path from 'path';
import logger from '../utils/logger.js';

/**
 * 微信公众号API服务
 * 封装微信公众平台的API调用，包括access_token管理、图片上传、历史文章查询、统计及草稿创建
 */
class WeChatAPI {
  constructor(appId, appSecret) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.accessToken = null;
    this.tokenExpireTime = 0;
    
    logger.debug('WeChatAPI initialized');
  }

  // 新工具只返回选定字段；异常不转发微信正文、请求 URL 或凭据。
  async requestData(endpoint, payload, operation) {
    const accessToken = await this.getAccessToken();
    let data;
    try {
      const response = await axios.post(
        `https://api.weixin.qq.com/${endpoint}?access_token=${accessToken}`,
        payload,
        { timeout: 30000 }
      );
      data = response.data;
    } catch {
      throw new Error(`${operation}请求失败，请检查网络及公众号接口权限`);
    }
    if (data.errcode) {
      if (data.errcode === 47009) throw new Error(`${operation}失败：微信接口已下线（错误码 47009）`);
      const code = Number.isInteger(data.errcode) ? `（错误码 ${data.errcode}）` : '';
      throw new Error(`${operation}失败${code}，请检查公众号接口权限及请求参数`);
    }
    return data;
  }

  async listArticles({ offset = 0, count = 20, includeContent = false }) {
    const data = await this.requestData('cgi-bin/freepublish/batchget', {
      offset, count, no_content: includeContent ? 0 : 1
    }, '读取已发布文章');
    return {
      totalCount: data.total_count,
      itemCount: data.item_count,
      offset,
      nextOffset: offset + data.item_count < data.total_count && data.item_count > 0
        ? offset + data.item_count : null,
      items: data.item.map(item => ({
        articleId: item.article_id,
        updateTime: item.update_time,
        articles: item.content.news_item.map((article, index) => ({
          index,
          title: article.title,
          author: article.author ?? null,
          digest: article.digest ?? null,
          url: article.url ?? null,
          thumbMediaId: article.thumb_media_id ?? null,
          ...(includeContent ? { content: article.content ?? null } : {})
        }))
      }))
    };
  }

  async createDraft({ title, content, author, digest, contentSourceUrl, thumbMediaId }) {
    const article = { title, content, thumb_media_id: thumbMediaId };
    if (author !== undefined) article.author = author;
    if (digest !== undefined) article.digest = digest;
    if (contentSourceUrl !== undefined) article.content_source_url = contentSourceUrl;
    const data = await this.requestData('cgi-bin/draft/add', { articles: [article] }, '保存草稿');
    if (typeof data.media_id !== 'string' || !data.media_id) {
      throw new Error('保存草稿响应缺少 media_id，无法确认草稿已保存');
    }
    return { mediaId: data.media_id, status: 'draft' };
  }

  async getArticleStats({ date, msgId }) {
    const data = await this.requestData('datacube/getarticletotaldetail', {
      begin_date: date, end_date: date
    }, '读取图文统计');
    return {
      date,
      isDelayed: data.is_delay ?? null,
      items: data.list.filter(item => msgId === undefined || item.msgid === msgId).map(item => ({
        msgId: item.msgid,
        title: item.title,
        refDate: item.ref_date,
        url: item.content_url ?? null,
        publishType: item.publish_type ?? null,
        snapshots: item.detail_list.map(detail => ({
          statDate: detail.stat_date,
          readUsers: detail.read_user ?? null,
          shareUsers: detail.share_user ?? null,
          favoriteUsers: detail.collection_user ?? null
        }))
      }))
    };
  }

  async getAccessToken() {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpireTime) return this.accessToken;
    let data;
    try {
      const response = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
        params: { grant_type: 'client_credential', appid: this.appId, secret: this.appSecret },
        timeout: 10000
      });
      data = response.data;
    } catch {
      throw new Error('获取 access_token 请求失败，请检查网络及公众号配置');
    }
    if (!data.access_token) {
      const code = Number.isInteger(data.errcode) ? `（错误码 ${data.errcode}）` : '';
      throw new Error(`获取 access_token 失败${code}，请检查凭据及 IP 白名单`);
    }
    this.accessToken = data.access_token;
    this.tokenExpireTime = now + (data.expires_in - 60) * 1000;
    logger.info('access_token获取成功');
    return this.accessToken;
  }

  async uploadCoverImage(imagePath, validatedBuffer) {
    return this.uploadImage('cgi-bin/material/add_material', imagePath, validatedBuffer, '封面上传', 'media_id', '&type=image');
  }

  async uploadArticleImage(imagePath, validatedBuffer) {
    return this.uploadImage('cgi-bin/media/uploadimg', imagePath, validatedBuffer, '正文图片上传', 'url');
  }

  async uploadImage(endpoint, imagePath, validatedBuffer, operation, resultField, query = '') {
    const contentTypes = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp'
    };
    const formData = new FormData();
    formData.append('media', validatedBuffer, {
      filename: path.basename(imagePath),
      contentType: contentTypes[path.extname(imagePath).toLowerCase()]
    });
    const accessToken = await this.getAccessToken();
    let data;
    try {
      const response = await axios.post(
        `https://api.weixin.qq.com/${endpoint}?access_token=${accessToken}${query}`,
        formData,
        { headers: formData.getHeaders(), timeout: 30000 }
      );
      data = response.data;
    } catch {
      throw new Error(`${operation}请求失败`);
    }
    if (data.errcode || typeof data[resultField] !== 'string' || !data[resultField]) {
      const code = Number.isInteger(data.errcode) ? `（错误码 ${data.errcode}）` : '';
      throw new Error(`${operation}失败${code}`);
    }
    return data[resultField];
  }
}

// 查询、草稿与图片上传共用实例；密钥轮换时替换实例，避免复用旧token。
const clients = new Map();

export function getWeChatAPI() {
  const appId = process.env.WECHAT_APP_ID?.trim();
  const appSecret = process.env.WECHAT_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    throw new Error('缺少环境变量 WECHAT_APP_ID 或 WECHAT_APP_SECRET，请在服务进程环境中配置');
  }
  if (!/^wx[a-zA-Z0-9]{16}$/.test(appId) || appSecret.length !== 32) {
    throw new Error('环境变量格式错误：WECHAT_APP_ID需为wx开头的18位字符，WECHAT_APP_SECRET需为32位');
  }
  let client = clients.get(appId);
  if (!client || client.appSecret !== appSecret) {
    client = new WeChatAPI(appId, appSecret);
    clients.set(appId, client);
  }
  return client;
}

export default WeChatAPI;
