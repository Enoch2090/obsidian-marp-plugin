import {
  FileSystemAdapter,
  ItemView,
  TFile,
  ViewStateResult,
  WorkspaceLeaf,
} from 'obsidian';
import { convertHtml } from './convertImage';
import { exportSlide } from './export';
import { marp } from './marp';
import { MarpPluginSettings } from './settings';
import { join, dirname, resolve } from 'path';

export const MARP_PREVIEW_VIEW_TYPE = 'marp-preview-view';

interface PreviewViewState {
  file: TFile | null;
}

export class PreviewView extends ItemView implements PreviewViewState {
  file: TFile | null;
  settings: MarpPluginSettings;
  constructor(leaf: WorkspaceLeaf, settings: MarpPluginSettings) {
    super(leaf);
    this.file = null;
    this.settings = settings;
  }

  getViewType(): string {
    return MARP_PREVIEW_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Marp Preview';
  }

  // Function to replace Wikilinks with the desired format
  replaceImageLinks(markdown: string, filePath: string): string {
    // 处理 ![]() 格式的图片链接
    const imgPathReg = /!\[[^\]]*\]\(([^)]+)\)/g;
    markdown = markdown.replace(imgPathReg, (match, path) => {
      if (path.startsWith('http') || path.startsWith('data:')) {
        return match; // 跳过 URL 和 Base64 图片
      }
      const normalizedPath = path.replace(/\\/g, '/'); // 规范化路径分隔符为正斜杠
      const vaultRelativePath = this.resolveVaultRelativePath(filePath, normalizedPath); // 解析 Vault 相对路径
      return match.replace(path, vaultRelativePath); // 替换为 Vault 相对路径
    });

    // 处理 ![[]] 格式的图片链接
    const wikilinkRegex = /!\[\[(.+?)\]\]/g;
    markdown = markdown.replace(wikilinkRegex, (match, name) => {
      const vaultRelativePath = this.resolveVaultRelativePath(filePath, name.replace(/\\/g, '/')); // 解析 Vault 相对路径
      return `![](${vaultRelativePath})`;
      // return `![[${vaultRelativePath}]]`;
    });

    return markdown;
  }

  resolveVaultRelativePath(filePath: string, relativePath: string): string {
    const normalizedFilePath = filePath.replace(/\\/g, '/'); // 规范化文件路径分隔符为正斜杠
    const normalizedRelativePath = relativePath.replace(/\\/g, '/'); // 规范化相对路径分隔符为正斜杠

    // 获取当前文件的目录路径
    const currentDir = dirname(normalizedFilePath);

    // 解析相对路径
    const segments = currentDir.split('/');
    const relativeSegments = normalizedRelativePath.split('/');
    console.log(`Current dir: ${currentDir}`);
    console.log(`Relative path: ${normalizedRelativePath}`);
    for (const segment of relativeSegments) {
      if (segment === '..') {
        // 上一级目录
        if (segments.length > 0) {
          segments.pop(); // 移除最后一个目录
        }
      } else if (segment !== '.' && segment !== '') {
        // 当前目录或空路径忽略，其他情况添加到路径中
        segments.push(segment);
      }
    }

    // // 拼接为 Vault 相对路径
    const vaultRelativePath = segments.join('/');
    console.log(`Vault relative path: ${vaultRelativePath}`);
    // return `../../../${normalizedRelativePath}`;
    return `${vaultRelativePath}`;
    // return `${normalizedRelativePath}`;
  }


  async renderPreview() {
    if (!this.file) return;
    const originContent = await this.app.vault.cachedRead(this.file);
    const filePath = this.file.path;

    // 使用 replaceImageLinks 统一处理图片链接
    let content = this.replaceImageLinks(originContent, filePath);
    console.log(content);
    const { html, css } = marp.render(content);
    const doc = await convertHtml(html);
    const container = this.containerEl.children[1];
    container.empty();
    container.appendChild(doc.body.children[0]);
    container.createEl('style', { text: css });
  }

  addActions() {
    const basePath = (
      this.app.vault.adapter as FileSystemAdapter
    ).getBasePath();
    const themeDir = join(basePath, this.settings.themeDir);
    const exportDir = join(basePath, this.settings.exportDir);
    this.addAction('presentation', 'Export as PPTX', () => {
      if (this.file) {
        exportSlide(this.app, this.file, 'pptx', basePath, themeDir, exportDir);
      }
    });
    this.addAction('file-text', 'Export as PDF', () => {
      if (this.file) {
        exportSlide(this.app, this.file, 'pdf', basePath, themeDir, exportDir);
      }
    });
    this.addAction('file-code-2', 'Export as HTML', () => {
      if (this.file) {
        exportSlide(this.app, this.file, 'html', basePath, themeDir, exportDir);
      }
    });
  }

  async onOpen() {
    this.registerEvent(this.app.vault.on('modify', this.onChange.bind(this)));
    this.addActions();
  }

  async onClose() {
    // Nothing to clean up.
  }

  onChange() {
    if (!this.settings.autoReload) return;
    this.renderPreview();
  }

  async setState(state: PreviewViewState, result: ViewStateResult) {
    if (state.file) {
      this.file = state.file;
    }
    await this.renderPreview();
    return super.setState(state, result);
  }

  getState(): PreviewViewState {
    return {
      file: this.file,
    };
  }
}
