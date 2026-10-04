import { getWeChatAPI } from '../services/WeChatAPI.js';
import { validateStatusParams } from '../utils/validator.js';
import logger from '../utils/logger.js';

/**
 * 微信公众号状态查询工具
 * 提供文章发布状态查询、数据统计等功能
 */
class WeChatStatus {
  /**
   * 查询微信公众号文章状态
   * @param {Object} params 查询参数
   * @returns {Object} MCP格式的响应结果
   */
  static async query(params) {
    const startTime = Date.now();
    
    try {
      logger.info('开始查询状态', { msgId: params.msgId });
      
      // 1. 参数验证
      const validation = validateStatusParams(params);
      if (!validation.valid) {
        throw new Error(`参数验证失败: ${validation.errors.join(', ')}`);
      }

      const { msgId } = params;

      // 2. 初始化微信API
      logger.debug('初始化微信API');
      const wechatAPI = getWeChatAPI();

      // 3. 查询发布状态
      logger.debug('查询发布状态', { msgId });
      const statusData = await wechatAPI.getPublishStatus(msgId);

      const executionTime = Date.now() - startTime;
      logger.info('状态查询成功', { 
        msgId,
        status: statusData.publish_status,
        executionTime: `${executionTime}ms` 
      });

      // 4. 构建成功响应
      const successMessage = this.buildStatusMessage(statusData, executionTime, msgId);

      return {
        content: [{
          type: "text",
          text: successMessage
        }]
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error('状态查询失败', {
        msgId: params.msgId,
        error: error.message,
        executionTime: `${executionTime}ms`,
        stack: error.stack
      });
      
      return {
        content: [{
          type: "text",
          text: this.buildErrorMessage(error)
        }],
        isError: true
      };
    }
  }

  /**
   * 构建状态响应消息
   */
  static buildStatusMessage(statusData, executionTime, msgId) {
    let message = `📊 文章状态查询结果\n\n`;
    
    // 处理微信API的真实响应格式
    message += `📨 消息ID: ${msgId || '未知'}\n`;
    
    // 发布状态
    if (statusData.publish_status !== undefined) {
      const statusText = this.getStatusText(statusData.publish_status);
      message += `📈 状态: ${statusText}\n`;
    }
    
    // 处理文章详情（微信API返回的格式）
    if (statusData.article_detail && statusData.article_detail.item && statusData.article_detail.item.length > 0) {
      const article = statusData.article_detail.item[0];
      
      if (article.title) {
        message += `📱 标题: ${article.title}\n`;
      }
      
      if (article.author) {
        message += `👤 作者: ${article.author}\n`;
      }
      
      if (article.publish_time) {
        message += `📅 发布时间: ${this.formatTimestamp(article.publish_time)}\n`;
      }
      
      // 统计数据
      if (article.stat_info) {
        const stat = article.stat_info;
        message += `👀 阅读量: ${stat.read_num || 0}\n`;
        message += `❤️ 点赞数: ${stat.like_num || 0}\n`;
        
        // 只有当有评论或分享数据时才显示
        if (stat.comment_num > 0) {
          message += `💬 评论数: ${stat.comment_num}\n`;
        }
        if (stat.share_num > 0) {
          message += `📤 分享数: ${stat.share_num}\n`;
        }
      }
      
      // 文章链接
      if (article.url) {
        message += `🔗 文章链接: ${article.url}\n`;
      }
    } else {
      // 如果没有文章详情，可能是刚发布还未生成统计数据
      message += `ℹ️ 文章详情暂未生成，可能需要等待几分钟后重试\n`;
    }
    
    return message;
  }

  /**
   * 构建错误响应消息
   */
  static buildErrorMessage(error) {
    let message = `❌ 状态查询失败: ${error.message}\n\n`;
    
    // 常见错误的解决建议
    if (error.message.includes('access_token')) {
      message += `🔑 认证问题:\n`;
      message += `• 检查AppID和AppSecret是否正确\n`;
      message += `• 确认公众号权限是否足够\n\n`;
    }
    
    if (error.message.includes('msgId') || error.message.includes('not found')) {
      message += `🔍 消息ID问题:\n`;
      message += `• 检查提供的msgId是否正确\n`;
      message += `• 确认消息是否确实存在\n`;
      message += `• 只能查询最近的发布记录\n\n`;
    }
    
    message += `💡 解决建议:\n`;
    message += `• 确认msgId来自发布成功的返回结果\n`;
    message += `• 检查网络连接是否正常\n`;
    message += `• 如果是新发布的文章，请稍等几分钟后重试\n`;
    message += `• 确保查询的是本公众号发布的文章`;
    
    return message;
  }

  /**
   * 获取状态文本
   */
  static getStatusText(status) {
    const statusMap = {
      0: '🟡 发布中',
      1: '🟢 发布成功',
      2: '🔴 发布失败',
      3: '🟠 审核中',
      4: '🔴 审核失败'
    };
    
    return statusMap[status] || `🤔 未知状态(${status})`;
  }

  /**
   * 格式化时间戳
   */
  static formatTimestamp(timestamp) {
    if (!timestamp) return '未知';
    
    try {
      const date = new Date(timestamp * 1000);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (error) {
      return '时间格式错误';
    }
  }
}

export default WeChatStatus;