import { promises as fs, constants } from 'fs';
import path from 'path';

async function validateFilePath(filePath, supportedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp']) {
  const errors = [];
  
  if (!filePath || typeof filePath !== 'string') {
    errors.push('文件路径不能为空');
    return { valid: false, errors };
  }
  
  // 检查文件扩展名
  const hasValidExt = supportedExts.some(ext => 
    filePath.toLowerCase().endsWith(ext)
  );
  
  if (!hasValidExt) {
    errors.push(`不支持的文件格式，支持格式：${supportedExts.join(', ')}`);
  }
  
  // 基本路径安全检查
  if (filePath.includes('..')) {
    errors.push('文件路径不能包含".."字符');
  }
  
  if (errors.length) return { valid: false, errors };

  let handle;
  try {
    const coverDir = await fs.realpath(process.env.WECHAT_COVER_DIR || path.join(process.cwd(), 'covers'));
    const resolvedPath = await fs.realpath(filePath);
    const relativePath = path.relative(coverDir, resolvedPath);
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      throw new Error('图片路径超出允许目录（WECHAT_COVER_DIR，默认工作目录下的covers/）');
    }
    if (!supportedExts.includes(path.extname(resolvedPath).toLowerCase())) {
      throw new Error(`不支持的文件格式，支持格式：${supportedExts.join(', ')}`);
    }
    handle = await fs.open(resolvedPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error('图片路径必须是普通文件');
    if (stats.size > 1024 * 1024) throw new Error('图片不能超过1MB');
    // 有界读取，上传直接使用这些字节，防止校验后替换文件。
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 1024 * 1024) throw new Error('图片不能超过1MB');
    const imageBuffer = buffer.subarray(0, length);
    const ext = path.extname(resolvedPath).toLowerCase();
    const signatures = {
      '.png': imageBuffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
      '.jpg': imageBuffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')),
      '.gif': ['GIF87a', 'GIF89a'].some(header => imageBuffer.subarray(0, 6).equals(Buffer.from(header))),
      '.webp': length >= 12 && imageBuffer.subarray(0, 4).equals(Buffer.from('RIFF'))
        && imageBuffer.subarray(8, 12).equals(Buffer.from('WEBP'))
    };
    signatures['.jpeg'] = signatures['.jpg'];
    if (!signatures[ext]) throw new Error('图片魔数无效或与扩展名不匹配');
    return { valid: true, errors: [], resolvedPath, imageBuffer };
  } catch (error) {
    return { valid: false, errors: [`图片文件校验失败: ${error.message}`] };
  } finally {
    if (handle) await handle.close();
  }
}


export { validateFilePath };
