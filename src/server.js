#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import WeChatPublisher from './tools/wechat-publisher.js';
import WeChatStatus from './tools/wechat-status.js';

import logger from './utils/logger.js';

// 创建MCP服务器
const server = new McpServer({
  name: "wechat-publisher-mcp",
  version: "1.0.0"
});

// 注册微信发布工具
server.registerTool(
  "wechat_publish_article",
  {
    description: "将文章发布到微信公众号，支持Markdown格式",
    inputSchema: {
      title: z.string().describe("文章标题"),
      content: z.string().describe("Markdown格式的文章内容"),
      author: z.string().describe("作者名称"),
      coverImagePath: z.string().optional().describe("封面图片路径"),
      previewMode: z.boolean().default(true).describe("是否为预览模式"),
      confirmPublish: z.boolean().default(false).describe("真实发布必须显式为true，并设置previewMode为false"),
      previewOpenId: z.string().optional().describe("预览用户OpenID")
    }
  },
  async (params) => {
    const { title, content, author, coverImagePath, previewMode, confirmPublish, previewOpenId } = params;
    logger.info('收到文章发布请求');
    
    try {
      // 调用实际的发布逻辑
      const result = await WeChatPublisher.publish({
        title,
        content,
        author,
        coverImagePath,
        previewMode,
        confirmPublish,
        previewOpenId
      });
      
      return result;
    } catch (error) {
      logger.error(`发布失败: ${error.message}`);
      return {
        content: [{
          type: "text",
          text: `❌ 发布失败: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

// 注册状态查询工具
server.registerTool(
  "wechat_query_status",
  {
    description: "查询文章发布状态和统计数据",
    inputSchema: {
      msgId: z.string().describe("消息ID"),
    }
  },
  async (params) => {
    const { msgId } = params;
    logger.info(`Querying status for message: ${msgId}`);
    
    try {
      // 调用实际的查询逻辑
      const result = await WeChatStatus.query({
        msgId
      });
      
      return result;
    } catch (error) {
      logger.error(`查询失败: ${error.message}`);
      return {
        content: [{
          type: "text",
          text: `❌ 查询失败: ${error.message}`
        }],
        isError: true
      };
    }
  }
);



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