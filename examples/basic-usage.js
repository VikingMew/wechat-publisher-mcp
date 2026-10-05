#!/usr/bin/env node

/**
 * 微信公众号发布MCP服务 - 基本使用示例
 * 
 * 本示例展示如何在Node.js环境中直接使用微信发布功能
 * 
 * 注意：实际使用时，通常通过MCP协议从AI工具调用，而不是直接调用
 */

import WeChatPublisher from '../src/tools/wechat-publisher.js';
import { fileURLToPath } from 'url';
import WeChatStatus from '../src/tools/wechat-status.js';

// 凭据由工具从WECHAT_APP_ID/WECHAT_APP_SECRET读取，不传入工具参数。
const config = {
  previewOpenId: process.env.WECHAT_PREVIEW_OPEN_ID
};

// 示例文章内容
const articleContent = `
# 🚀 AI赋能内容创作：微信公众号自动发布实战

## 📖 概述

本文介绍如何使用微信公众号自动发布服务，实现AI生成内容的一键发布。

## ✨ 主要特性

- **结构转换**：将Markdown语义结构转换为微信接口可消费的HTML标签
- **封面处理**：仅在显式提供封面路径时校验并上传图片
- **预览模式**：发布前可先预览效果
- **状态查询**：实时跟踪文章发布状态

## 🛠️ 技术实现

### 核心API

\`\`\`javascript
// 发布文章
const result = await publisher.publish({
  title: '文章标题',
  content: markdownContent,
  author: '作者名称',
  previewMode: true,
  previewOpenId: process.env.WECHAT_PREVIEW_OPEN_ID
});
\`\`\`

### 状态查询

\`\`\`javascript
// 查询状态
const status = await publisher.queryStatus({
  msgId: result.msgId
});
\`\`\`

## 📊 效果展示

本服务对输入内容执行以下最小转换：

1. **语义结构**：转换标题、段落、强调、列表、引用和链接
2. **代码结构**：转换代码块和行内代码，并转义代码块内容
3. **表格结构**：将Markdown表格转换为HTML表格标签
4. **无视觉装饰**：不注入主题、颜色、字体、间距或标题装饰

## 🎯 总结

微信公众号发布服务负责把输入内容提交到微信预览或发布接口，文章视觉效果由调用方提供的内容决定。

---

**关于作者**：PromptX技术团队致力于AI工具和自动化解决方案的开发。
`;

async function example1_basicPublish() {
  console.log('🚀 示例1：基础文章发布');
  
  try {
    const result = await WeChatPublisher.publish({
      title: '🔥 AI赋能内容创作：微信公众号自动发布实战教程',
      content: articleContent,
      author: '技术团队',
      ...config,
      previewMode: true  // 正式发布须显式设置false和confirmPublish: true
    });

    console.log('✅ 发布成功！');
    console.log('📊 发布结果：', result);
    
    return result;
  } catch (error) {
    console.error('❌ 发布失败：', error.message);
    throw error;
  }
}

async function example2_previewMode() {
  console.log('👀 示例2：预览模式发布');
  
  if (!config.previewOpenId) {
    console.log('⚠️  预览模式需要配置previewOpenId，跳过此示例');
    return;
  }
  
  try {
    const result = await WeChatPublisher.publish({
      title: '📝 预览测试：微信公众号自动发布功能',
      content: '这是一篇预览测试文章，用于验证发布功能是否正常工作。',
      author: '测试作者',
      ...config,
      previewMode: true,
      previewOpenId: config.previewOpenId
    });

    console.log('✅ 预览发送成功！');
    console.log('📊 预览结果：', result);
    
    return result;
  } catch (error) {
    console.error('❌ 预览失败：', error.message);
    throw error;
  }
}

async function example3_queryStatus(msgId) {
  console.log('📊 示例3：查询文章状态');
  
  if (!msgId) {
    console.log('⚠️  需要提供msgId，跳过此示例');
    return;
  }
  
  try {
    const status = await WeChatStatus.query({
      msgId,
      ...config
    });

    console.log('✅ 状态查询成功！');
    console.log('📈 文章状态：', status);
    
    return status;
  } catch (error) {
    console.error('❌ 状态查询失败：', error.message);
    throw error;
  }
}

async function example4_withCoverImage() {
  console.log('🖼️ 示例4：带封面图的文章发布');
  
  try {
    // 注意：这里需要提供真实存在的图片文件路径
    const coverImagePath = './covers/cover-example.png';
    
    const result = await WeChatPublisher.publish({
      title: '带显式封面的文章',
      content: articleContent,
      author: '设计团队',
      coverImagePath,  // 添加封面图
      ...config,
      previewMode: true
    });

    console.log('✅ 带封面图发布成功！');
    console.log('📊 发布结果：', result);
    
    return result;
  } catch (error) {
    console.error('❌ 发布失败：', error.message);
    if (error.message.includes('图片文件不存在')) {
      console.log('💡 提示：请确保封面图片文件存在');
    }
    throw error;
  }
}

// 主函数：运行所有示例
async function runExamples() {
  console.log('📱 微信公众号发布MCP服务 - 使用示例');
  console.log('=====================================\n');
  
  // 检查配置
  if (!process.env.WECHAT_APP_ID || !process.env.WECHAT_APP_SECRET) {
    console.error('❌ 请先设置环境变量WECHAT_APP_ID和WECHAT_APP_SECRET');
    process.exit(1);
  }
  
  try {
    // 示例1：基础发布
    const publishResult = await example1_basicPublish();
    
    // 等待一会儿，然后查询状态
    if (publishResult && publishResult.content[0].text.includes('msgId')) {
      setTimeout(async () => {
        const msgIdMatch = publishResult.content[0].text.match(/消息ID:\s*(\d+)/);
        if (msgIdMatch) {
          await example3_queryStatus(msgIdMatch[1]);
        }
      }, 5000);
    }
    
    // 示例2：预览模式
    // await example2_previewMode();
    
    // 示例4：带封面图发布（如果图片存在）
    // await example4_withCoverImage();
    
  } catch (error) {
    console.error('❌ 示例运行失败：', error.message);
    process.exit(1);
  }
}

// 如果直接运行此文件，执行示例
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runExamples();
}

export {
  example1_basicPublish,
  example2_previewMode,
  example3_queryStatus,
  example4_withCoverImage
};
