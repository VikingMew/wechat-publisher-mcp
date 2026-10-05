/**
 * Markdown转微信HTML转换器
 * 将标准Markdown格式转换为微信接口可消费的语义HTML
 */
class MarkdownConverter {
  /**
   * 将Markdown内容转换为微信公众号所需的HTML结构
   * @param {string} markdownContent Markdown内容
   * @returns {string} 微信接口可消费的HTML内容
   */
  static convertToWeChatHTML(markdownContent) {
    if (!markdownContent || typeof markdownContent !== 'string') {
      return '';
    }

    let html = markdownContent;

    // 1. 先处理代码块（避免被其他规则影响）
    html = this.convertCodeBlocks(html);

    // 2. 处理标题
    html = this.convertHeadings(html);

    // 3. 处理文本格式
    html = this.convertTextFormatting(html);

    // 4. 处理列表
    html = this.convertLists(html);

    // 5. 处理引用
    html = this.convertBlockquotes(html);

    // 6. 处理链接
    html = this.convertLinks(html);

    // 7. 处理表格
    html = this.convertTables(html);

    // 8. 处理段落
    html = this.convertParagraphs(html);

    // 9. 清理标签嵌套
    return this.cleanupHTML(html);
  }

  /**
   * 处理代码块
   */
  static convertCodeBlocks(html) {
    // 处理带语言标识的代码块
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const language = lang || 'text';
      return `<pre data-language="${language}"><code>${this.escapeHtml(code.trim())}</code></pre>`;
    });

    // 处理行内代码
    html = html.replace(/`([^`]+)`/g, (match, code) => `<code>${this.escapeHtml(code)}</code>`);

    return html;
  }

  /**
   * 处理标题
   */
  static convertHeadings(html) {
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');

    return html;
  }

  /**
   * 处理文本格式
   */
  static convertTextFormatting(html) {
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/~~(.*?)~~/g, '<del>$1</del>');

    return html;
  }

  /**
   * 处理列表
   */
  static convertLists(html) {
    // 先处理有序列表
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
    
    // 再处理无序列表
    html = html.replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>');
    
    // 将连续的li标签包装在ul中
    html = html.replace(/(<li[^>]*>.*?<\/li>(\s*<li[^>]*>.*?<\/li>)*)/gs, (match) => {
      return `<ul>${match}</ul>`;
    });

    return html;
  }

  /**
   * 处理引用
   */
  static convertBlockquotes(html) {
    html = html.replace(/^>\s*(.+)$/gm, '<blockquote>$1</blockquote>');
    return html;
  }

  /**
   * 处理链接
   */
  static convertLinks(html) {
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    return html;
  }

  /**
   * 处理表格
   */
  static convertTables(html) {
    // 简单的表格转换（Markdown表格转HTML表格）
    const lines = html.split('\n');
    let inTable = false;
    let tableLines = [];
    let result = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // 检测表格开始（包含 | 的行）
      if (line.includes('|') && !inTable) {
        inTable = true;
        tableLines = [line];
      } else if (line.includes('|') && inTable) {
        tableLines.push(line);
      } else if (inTable) {
        // 表格结束，处理表格
        if (tableLines.length > 0) {
          result.push(this.convertTableToHTML(tableLines));
        }
        inTable = false;
        tableLines = [];
        result.push(line);
      } else {
        result.push(line);
      }
    }

    // 处理最后可能的表格
    if (inTable && tableLines.length > 0) {
      result.push(this.convertTableToHTML(tableLines));
    }

    return result.join('\n');
  }

  /**
   * 将Markdown表格转换为HTML表格
   */
  static convertTableToHTML(tableLines) {
    if (tableLines.length < 2) return tableLines.join('\n');

    const headerLine = tableLines[0];
    const separatorLine = tableLines[1];
    const dataLines = tableLines.slice(2);

    // 解析表头
    const headers = headerLine.split('|').map(h => h.trim()).filter(h => h);
    
    // 检查是否是有效的表格分隔符
    if (!separatorLine.includes('-')) {
      return tableLines.join('\n');
    }

    let tableHTML = '<table>';
    
    // 表头
    tableHTML += '<thead><tr>';
    headers.forEach(header => {
      tableHTML += `<th>${header}</th>`;
    });
    tableHTML += '</tr></thead>';

    // 表格数据
    tableHTML += '<tbody>';
    dataLines.forEach((line) => {
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      tableHTML += '<tr>';
      cells.forEach(cell => {
        tableHTML += `<th>${cell}</th>`;
      });
      tableHTML += '</tr>';
    });
    tableHTML += '</tbody></table>';

    return tableHTML;
  }

  /**
   * 处理段落
   */
  static convertParagraphs(html) {
    // 将双换行转换为段落分隔
    html = html.replace(/\n\s*\n/g, '</p><p>');
    
    // 在开头和结尾添加段落标签
    html = '<p>' + html + '</p>';

    return html;
  }

  /**
   * 清理HTML
   */
  static cleanupHTML(html) {
    // 移除空段落
    html = html.replace(/<p[^>]*>\s*<\/p>/g, '');
    
    // 清理多余的空白
    html = html.replace(/\s+/g, ' ');
    
    // 修复标签嵌套问题
    html = html.replace(/<p[^>]*>(\s*<h[1-6][^>]*>.*?<\/h[1-6]>\s*)<\/p>/g, '$1');
    html = html.replace(/<p[^>]*>(\s*<ul[^>]*>.*?<\/ul>\s*)<\/p>/gs, '$1');
    html = html.replace(/<p[^>]*>(\s*<ol[^>]*>.*?<\/ol>\s*)<\/p>/gs, '$1');
    html = html.replace(/<p[^>]*>(\s*<blockquote[^>]*>.*?<\/blockquote>\s*)<\/p>/gs, '$1');
    html = html.replace(/<p[^>]*>(\s*<pre[^>]*>.*?<\/pre>\s*)<\/p>/gs, '$1');
    html = html.replace(/<p[^>]*>(\s*<table[^>]*>.*?<\/table>\s*)<\/p>/gs, '$1');

    return html;
  }

  /**
   * HTML转义
   */
  static escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}

export default MarkdownConverter;
