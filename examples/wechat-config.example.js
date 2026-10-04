/**
 * 微信公众号配置示例
 * 凭据只从服务进程环境读取，不在文件中填写真实密钥
 */

export const wechatConfig = {
  // 微信公众号AppID环境变量
  appId: process.env.WECHAT_APP_ID,
  
  // 微信公众号AppSecret环境变量
  appSecret: process.env.WECHAT_APP_SECRET
};

// MCP工具自动读取上述环境变量，无需将凭据作为工具参数传入。
