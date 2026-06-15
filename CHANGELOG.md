# Changelog

## [1.2.0] — 2026-06-15

### 新增
- 完整 i18n 国际化支持，新增英文 (`_locales/en/`)，全部 52 条 UI 文本可通过浏览器语言自动切换
- `.gitignore` 文件（排除 zip、IDE、macOS、node_modules）

### 改进
- **XSS 安全强化**: `sanitizeHTML` 新增移除 SVG 攻击向量 (`animate`, `set`, `animateMotion`, `animateTransform`) 和多属性 `javascript:` 协议检测 (`href`, `src`, `xlink:href`, `action`, `formaction`)
- **流式 API 调用**: `XMLHttpRequest` 替换为 `fetch` + `ReadableStream`，解决大响应 `responseText.slice()` 性能问题和多字节 Unicode 兼容性
- **请求取消机制**: 新增 `AbortController` 支持，新请求自动取消旧请求，120s 超时自动中止
- **缓存同步**: 新增 `chrome.storage.onChanged` 监听，多标签页设置自动同步
- **`escapeHtml` 性能优化**: DOM 方式改为查表法字符串替换
- **代码去重**: 提取 `getActivePromptText()` / `abortActiveRequest()` 公共函数

### 清理
- manifest.json 的 `name`/`description`/`commands` 改用 `__MSG_*__` 引用
- 移除未使用 CSS：`.os-header-actions`、`.os-header-btn`、`.os-loading-dots`、`@keyframes osDotBounce`
- 移除 `web_accessible_resources`（所有资源已通过 `content_scripts` 注入）

---

## [1.1.0] — 2026-06
- 首次发布
- Alt+Z 框选截图 → AI 多模态模型 → 右边栏对话
- Markdown + LaTeX 渲染
- 5 个可自定义提示词槽位
- 亮色/暗色主题切换
- 流式 SSE 打字机回复
