/**
 * 日志工具
 * 所有级别仅写入stderr，stdout保留给MCP JSON-RPC协议
 */

const logger = {
  info: (message, ...args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[INFO] ${message}`, ...args);
    }
  },
  
  error: (message, error) => {
    if (error && error.stack) {
      console.error(`[ERROR] ${message}\n${error.stack}`);
    } else {
      console.error(`[ERROR] ${message}`, error || '');
    }
  },
  
  debug: (message, ...args) => {
    if (process.env.DEBUG) {
      console.error(`[DEBUG] ${message}`, ...args);
    }
  },
  
  warn: (message, ...args) => {
    console.error(`[WARN] ${message}`, ...args);
  }
};

export default logger;