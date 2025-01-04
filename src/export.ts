import { exec } from 'child_process';
import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { Notice, TFile, App } from 'obsidian';
import { convertToBase64 } from './convertImage';
import { join, normalize, dirname, resolve } from 'path';
import fixPath from 'fix-path';
import { getEngine } from './engine';
import { MarpPluginSettings } from './settings';

const imgPathReg = /!\[[^\]]*\]\(([^)]+)\)/g; // 匹配 ![](path)
const wikiLinkReg = /!\[\[([^\]]+)\]\]/g; // 匹配 ![[path]]

export async function exportSlide(
  app: App,
  file: TFile,
  ext: 'html' | 'pdf' | 'pptx',
  basePath: string,
  themeDir: string,
  exportDir: string,
) {
  if (!file) return;
  const filePath = normalize(join(basePath, file.path));
  const tmpPath = join(exportDir, `${file.basename}.tmp`);
  const tmpEnginePath = join(exportDir, 'engine.js');

  let fileContent = await readFile(filePath, 'utf-8');

  // 处理 ![[../image.png]] 格式的 Wiki 链接
  fileContent = fileContent.replace(wikiLinkReg, (match, path) => {
    const absolutePath = resolve(dirname(filePath), path); // 解析为绝对路径
    return `![](${absolutePath})`; // 转换为 Markdown 图片语法
  });

  // 处理 ![](../image.png) 格式的 Markdown 图片
  const srcBase64TupleList = await Promise.all(
    [...new Set([...fileContent.matchAll(imgPathReg)].map(v => v[1]))].map(
      async v => {
        const absolutePath = resolve(dirname(filePath), v); // 解析为绝对路径
        return [v, await convertToBase64(absolutePath)] as const;
      },
    ),
  );

  // 替换文件内容中的相对路径为 Base64 编码
  for (const [src, base64] of srcBase64TupleList) {
    fileContent = fileContent.replace(
      new RegExp(
        String.raw`(!\[[^\]]*\])\(${src.replace(/\\/g, '\\\\')}\)`,
        'g',
      ),
      `$1(${base64})`,
    );
  }

  // 创建导出目录并写入临时文件
  await mkdir(exportDir, { recursive: true });
  try {
    await writeFile(tmpPath, fileContent);
    await writeFile(tmpEnginePath, getEngine());
  } catch (e) {
    console.error(e);
  }

  // 构建命令
  let cmd: string;

  try {
    await access(themeDir);
    cmd = `"${join(
      basePath,
      '.obsidian',
      'plugins',
      'marp',
      'marp.exe'
    )}" --bespoke.transition --stdin false --allow-local-files --html --theme-set "${themeDir}" -o "${join(
      exportDir,
      file.basename
    )}.${ext}" --engine ${tmpEnginePath} -- "${tmpPath}"`;
  } catch (e) {
    cmd = `"${join(
      basePath,
      '.obsidian',
      'plugins',
      'marp',
      'marp.exe'
    )}" --stdin false --allow-local-files --html --bespoke.transition -o "${join(
      exportDir,
      file.basename
    )}.${ext}" --engine ${tmpEnginePath} -- "${tmpPath}"`;
  }

  // 执行命令
  fixPath();
  new Notice(`Exporting "${file.basename}.${ext}" to "${exportDir}"`, 20000);
  exec(cmd, () => {
    new Notice('Exported successfully', 20000);
    rm(tmpPath);
    rm(tmpEnginePath);

    // 打开文件管理器并选中导出的文件
    const exportedFilePath = join(exportDir, `${file.basename}.${ext}`);
    let openCmd: string;
    switch (process.platform) {
      case 'win32':
        openCmd = `explorer /select,"${exportedFilePath}"`;
        break;
      case 'darwin':
        openCmd = `open -R "${exportedFilePath}"`;
        break;
      case 'linux':
        openCmd = `xdg-open "${dirname(exportedFilePath)}"`;
        break;
      default:
        throw new Error('Unsupported platform');
    }
    exec(openCmd);
  });
}
