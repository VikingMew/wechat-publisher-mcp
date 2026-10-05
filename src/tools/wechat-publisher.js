import { getWeChatAPI } from '../services/WeChatAPI.js';
import MarkdownConverter from '../services/MarkdownConverter.js';
import { validatePublishParams, validateFilePath } from '../utils/validator.js';
import logger from '../utils/logger.js';

/**
 * 微信公众号发布工具
 * 提供文章发布的核心功能，包括Markdown转换、图片上传、文章发布等
 */
class WeChatPublisher {
  /**
   * 发布文章到微信公众号
   * @param {Object} params 发布参数
   * @returns {Object} MCP格式的响应结果
   */
  static async publish(params) {
    const startTime = Date.now();
    
    try {
      const previewMode = params.previewMode !== false || params.confirmPublish !== true;
      logger.info('开始发布流程', { previewMode });

      // 1. 参数验证
      const validation = validatePublishParams(params);
      if (!validation.valid) {
        throw new Error(`参数验证失败: ${validation.errors.join(', ')}`);
      }

      const {
        title,
        content, 
        author,
        coverImagePath,
        previewOpenId
      } = params;

      // 2. 初始化微信API
      logger.debug('初始化微信API');
      const wechatAPI = getWeChatAPI();

      // 3. 转换Markdown为微信HTML
      logger.debug('转换Markdown内容');
      const htmlContent = MarkdownConverter.convertToWeChatHTML(content);
      logger.debug('Markdown转换完成', { 
        originalLength: content.length, 
        htmlLength: htmlContent.length 
      });

      // 4. 校验并上传显式提供的封面图
      let thumbMediaId = null;
      if (coverImagePath !== undefined) {
        const coverValidation = await validateFilePath(coverImagePath);
        if (!coverValidation.valid) {
          throw new Error(coverValidation.errors.join(', '));
        }

        try {
          logger.debug('开始上传封面图', { path: coverValidation.resolvedPath });
          thumbMediaId = await wechatAPI.uploadCoverImage(
            coverValidation.resolvedPath,
            coverValidation.imageBuffer
          );
          logger.info('封面图上传成功', { mediaId: thumbMediaId });
        } catch (error) {
          throw new Error(`封面图上传失败，未发布: ${error.message}`);
        }
      }

      // 5. 发布或预览文章
      let result;
      if (previewMode) {
        if (!previewOpenId) {
          throw new Error('未发布，预览模式需要提供previewOpenId参数');
        }
        
        logger.debug('开始预览文章', { previewOpenId });
        result = await wechatAPI.previewArticle({
          title,
          content: htmlContent,
          author,
          thumbMediaId,
          previewOpenId
        });
        
      } else {
        logger.debug('开始正式发布文章');
        result = await wechatAPI.publishArticle({
          title,
          content: htmlContent, 
          author,
          thumbMediaId
        });
      }

      const executionTime = Date.now() - startTime;
      logger.info(`文章${previewMode ? '预览' : '发布'}成功`, { 
        ...result, 
        executionTime: `${executionTime}ms` 
      });

      // 6. 构建成功响应
      const successMessage = this.buildSuccessMessage({
        title,
        author,
        result,
        previewMode,
        executionTime,
        thumbMediaId
      });

      return {
        content: [{
          type: "text",
          text: (previewMode && params.confirmPublish !== true ? '未发布，缺少 confirmPublish；已走预览路径。\n' : '') + successMessage
        }]
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error('发布流程失败', {
        error: error.message,
        executionTime: `${executionTime}ms`,
        stack: error.stack
      });
      
      return {
        content: [{
          type: "text",
          text: this.buildErrorMessage(error, params)
        }],
        isError: true
      };
    }
  }

  /**
   * 构建成功响应消息
   */
  static buildSuccessMessage({ title, author, result, previewMode, executionTime, thumbMediaId }) {
    const mode = previewMode ? '预览' : '发布';
    const icon = previewMode ? '👀' : '✅';
    
    let message = `${icon} 文章${mode}成功！\n\n`;
    message += `📱 标题: ${title}\n`;
    message += `👤 作者: ${author}\n`;
    
    if (result.articleUrl) {
      message += `🔗 链接: ${result.articleUrl}\n`;
    }
    
    if (result.publishId) {
      message += `📊 发布ID: ${result.publishId}\n`;
    }
    
    if (result.msgId) {
      message += `📨 消息ID: ${result.msgId}\n`;
    }
    
    if (thumbMediaId) {
      message += `🖼️ 封面图: 已上传\n`;
    }
    
    message += `⏱️ 处理时间: ${executionTime}ms\n`;
    
    if (!previewMode) {
      message += `\n🎉 您的文章已成功发布到微信公众号！读者可以在公众号中看到这篇文章。`;
    } else {
      message += `\n👀 预览已发送到指定用户，请检查微信查看效果。`;
    }
    
    return message;
  }

  /**
   * 构建错误响应消息
   */
  static buildErrorMessage(error, params) {
    let message = `❌ 发布失败: ${error.message}\n\n`;
    
    // 常见错误的解决建议
    if (error.message.includes('access_token')) {
      message += `🔑 AppID/AppSecret问题:\n`;
      message += `• 检查微信公众号AppID和AppSecret是否正确\n`;
      message += `• 确认公众号类型是否支持发布接口\n`;
      message += `• 验证公众号是否已认证\n\n`;
    }
    
    if (error.message.includes('ip')) {
      message += `🌐 IP白名单问题:\n`;
      message += `• 将服务器IP添加到微信公众平台的IP白名单\n`;
      message += `• 登录微信公众平台 -> 开发 -> 基本配置 -> IP白名单\n\n`;
    }
    
    if (error.message.includes('media') || error.message.includes('图')) {
      message += `🖼️ 封面图问题:\n`;
      message += `• 检查图片路径是否正确\n`;
      message += `• 确认图片格式为PNG、JPG或JPEG\n`;
      message += `• 验证图片大小不超过1MB\n\n`;
    }
    
    message += `💡 通用解决方案:\n`;
    message += `• 检查网络连接是否正常\n`;
    message += `• 确认所有必需参数都已提供\n`;
    message += `• 查看微信公众平台是否有维护通知\n`;
    message += `• 如问题持续，请联系技术支持`;
    
    return message;
  }
}

export default WeChatPublisher;
