#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fileURLToPath } from 'url';
import {
  listArticles, getArticleStats, createDraft, uploadCover, uploadArticleImage,
  listSchema, statsSchema, draftSchema, uploadSchema
} from './tools/wechat-articles.js';
import logger from './utils/logger.js';

const server = new McpServer({ name: 'wechat-publisher-mcp', version: '1.0.0' });

server.registerTool('wechat_list_articles', {
  description: '分页读取本公众号已成功发布的文章列表，可选返回正文 HTML',
  inputSchema: listSchema
}, listArticles);

server.registerTool('wechat_get_article_stats', {
  description: '按发表日期读取文章累计阅读、分享、收藏人数；不是实时数据，msgId 与 articleId 不通用',
  inputSchema: statsSchema
}, getArticleStats);

server.registerTool('wechat_create_draft', {
  description: '将 HTML 正文保存到公众号草稿箱，返回草稿 mediaId',
  inputSchema: draftSchema
}, createDraft);

server.registerTool('wechat_upload_cover', {
  description: '上传本地封面为永久图片素材，支持 PNG/JPEG/GIF/WebP，返回可用于草稿 thumbMediaId 的 mediaId',
  inputSchema: uploadSchema
}, uploadCover);

server.registerTool('wechat_upload_article_image', {
  description: '上传本地 JPG/PNG 正文图片，返回可插入 HTML img src 的微信 URL',
  inputSchema: uploadSchema
}, uploadArticleImage);

logger.info('WeChat Publisher MCP Server initialized');

// 启动服务器函数
async function startServer() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('WeChat Publisher MCP Server connected via stdio');
    return server;
  } catch (error) {
    logger.error('Failed to start server', error);
    throw error;
  }
}

// Start server if running directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().catch(error => {
    logger.error('Failed to start server', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down...');
    process.exit(0);
  });
}

// 包装类
class WeChatMCPServer {
  constructor() {
    this.server = server;
  }
  
  async start() {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info('WeChat Publisher MCP Server connected via stdio');
      return this.server;
    } catch (error) {
      logger.error('Failed to start server', error);
      throw error;
    }
  }
}

export default WeChatMCPServer;
