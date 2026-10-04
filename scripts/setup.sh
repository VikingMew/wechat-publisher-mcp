#!/bin/bash

# 微信公众号发布MCP服务 - 快速安装配置脚本
# Quick Setup Script for WeChat Publisher MCP Service

set -e

echo "📱 微信公众号发布MCP服务 - 快速配置向导"
echo "============================================="
echo ""

# 检查Node.js版本
echo "🔍 检查Node.js环境..."
if ! command -v node &> /dev/null; then
    echo "❌ 未找到Node.js，请先安装Node.js 16+版本"
    echo "   下载地址: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo "❌ Node.js版本过低($NODE_VERSION)，需要16+版本"
    exit 1
fi

echo "✅ Node.js版本: $(node -v)"

# 检查npm
if ! command -v npm &> /dev/null; then
    echo "❌ 未找到npm包管理器"
    exit 1
fi

echo "✅ npm版本: $(npm -v)"
echo ""

# 安装依赖
echo "📦 安装项目依赖..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ 依赖安装失败"
    exit 1
fi

echo "✅ 依赖安装完成"
echo ""

# 凭据只通过启动服务的父进程环境提供，不读取或生成config.json。
echo "🔧 请在启动MCP客户端/服务前设置环境变量："
echo "   WECHAT_APP_ID、WECHAT_APP_SECRET（必需）"
echo "   WECHAT_COVER_DIR（可选，默认工作目录下的covers/）"
echo "   请使用客户端的安全环境注入功能，不要把密钥贴入AI对话或写入项目文件。"
echo ""

# MCP客户端配置提示
echo "🔌 MCP客户端配置"
echo "================"
echo ""
echo "将此服务添加到您的AI工具中："
echo ""

echo "Claude Desktop 配置 (~/.config/claude/claude_desktop_config.json):"
cat << 'EOF'
{
  "mcpServers": {
    "wechat-publisher": {
      "command": "node",
      "args": ["./src/server.js"],
      "cwd": "/path/to/wechat-publisher-mcp",
      "env": {
        "LOG_LEVEL": "INFO"
      }
    }
  }
}
EOF

echo ""
echo "或者全局安装后使用："
cat << 'EOF'
{
  "mcpServers": {
    "wechat-publisher": {
      "command": "wechat-publisher-mcp"
    }
  }
}
EOF

echo ""

# 只检查环境变量是否存在，不生成带凭据的测试脚本，也不输出密钥。
if [ -z "${WECHAT_APP_ID:-}" ] || [ -z "${WECHAT_APP_SECRET:-}" ]; then
    echo "⚠️  当前环境缺少WECHAT_APP_ID或WECHAT_APP_SECRET，请在服务启动环境中设置"
else
    echo "✅ 当前环境已提供微信凭据（未执行联网测试）"
fi

echo ""

# 完成提示
echo "🎉 安装配置完成！"
echo "================="
echo ""
echo "下一步："
echo "1. 确保服务进程获得WECHAT_APP_ID和WECHAT_APP_SECRET环境变量"
echo "2. 在微信公众平台配置IP白名单"
echo "3. 将MCP服务添加到您的AI工具配置中"
echo "4. 重启AI工具以加载MCP服务"
echo ""
echo "使用方法："
echo "- 在AI工具中说: '帮我发布一篇文章到微信公众号'"
echo "- 提供标题、内容、作者等信息"
echo "- AI会自动调用发布服务"
echo ""
echo "更多帮助："
echo "- 查看 README.md 了解详细用法"
echo "- 运行 'npm run example' 查看代码示例"
echo "- 查看 examples/ 目录中的示例文件"
echo ""
echo "📧 如有问题，请提交Issue或联系技术支持"
echo ""

# 询问是否全局安装
read -p "是否全局安装此服务以便在任何地方使用? (y/n): " global_install

if [ "$global_install" = "y" ] || [ "$global_install" = "Y" ]; then
    echo "🌐 正在全局安装..."
    npm link
    
    if [ $? -eq 0 ]; then
        echo "✅ 全局安装成功！现在可以使用 'wechat-publisher-mcp' 命令"
    else
        echo "❌ 全局安装失败，可能需要管理员权限"
        echo "   请尝试: sudo npm link"
    fi
fi

echo ""
echo "🚀 准备就绪！开始您的AI内容创作之旅吧！" 