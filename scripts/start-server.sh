#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 服务仅支持stdio；MCP_TRANSPORT/MCP_PORT/MCP_HOST未被代码读取。
# 启动提示写入stderr，stdout留给JSON-RPC。
if [[ $# -gt 0 ]]; then
  echo "不支持启动参数；此服务仅支持stdio" >&2
  exit 1
fi

echo -e "${YELLOW}🚀 Starting WeChat Publisher MCP Server (stdio)...${NC}" >&2

# Check if package.json exists
if [[ ! -f "$PROJECT_ROOT/package.json" ]]; then
  echo -e "${RED}❌ Error: package.json not found in $PROJECT_ROOT${NC}" >&2
  echo -e "${RED}   Please make sure you're running the script from the correct directory${NC}" >&2
  exit 1
fi

# 启动过程不自动安装依赖，避免污染stdout或隐式联网。
if [[ ! -d "$PROJECT_ROOT/node_modules" ]]; then
  echo -e "${RED}❌ 缺少node_modules，请先单独安装依赖${NC}" >&2
  exit 1
fi

# Start the server
echo -e "${GREEN}✅ Starting server...${NC}" >&2
cd "$PROJECT_ROOT" && exec node src/server.js 