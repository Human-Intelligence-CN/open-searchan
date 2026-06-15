# Changelog

## [1.3.1] — 2026-06-15

### 安全

- HTTPS 强制：Service Worker 和设置表单双层拒绝非加密 API URL，防止 API Key 明文泄露
- `sanitizeHTML` 改用 `DOMParser`：避免 `innerHTML` 触发外部资源（img/tracker）请求
- XSS 强化：添加 `foreignObject`、`handler` 等遗漏的 SVG 攻击向量检测
- manifest 添加 `content_security_policy` 声明和 `minimum_chrome_version`
- 错误消息不再暴露完整 API URL
- `appendUserMessage` 增加 `data:image/` 前缀校验

### 修复

- `captureScreen` 添加 `img.onerror` 回调和 20 秒整体超时，防止 Promise 永久挂起
- `abortController` 改为请求局部变量 + `finally` 清理，防止并发覆盖
- `createStreamingBubble` 思考面板 `shown` 判断改用 `=== 'block'`，修复初始状态误判导致需双击展开
- `renderMarkdown` 数学公式用 Unicode 私用区占位符保护，防止 marked 解析破坏 LaTeX 语法
- 非流式兼容路径使用独立 `TextDecoder`，避免流式解码器状态污染
- 选区截图后窗口尺寸变化检测（TOCTOU 防护，>50px 拒绝）
- `screenshotActive` 拆分为选区+处理两个标志，防止处理期间启动新截图
- `document.body.style.userSelect` 保存/恢复原始值，避免破坏宿主页面样式
- Alt+X/C 快捷键在输入框焦点时不再拦截
- thinking toggle 补充 CSS `display: block` 显式设置，确保跨浏览器一致性

### 优化

- 流式 chunk 改为只发增量（`deltaText`/`deltaThinking`），content script 本地累积，避免 O(n²) 数据量
- `concatChunks` 添加 10MB 安全上限
- 对话历史 `conversation` 添加 40 条上限，自动截断最近 20 轮
- `showSidebar` / `switchTab` 共享 `settingsLoading` 互斥锁
- 设置保存消息统一 `setSaveMsg()` 防抖函数，修复 setTimeout 竞态
- 主题状态改用独立 `themeIsLight` 变量，不依赖 CSS class
- CSS 变量定义移至 `body` / `body.os-light`，修复 toggle 按钮和选区边框颜色异常
- overlay 元素尺寸添加 `Math.max(0, ...)` 防御
- SVG tagName 标准化 `.toUpperCase()` 兼容检查
- 删除 `offsetX: 0, offsetY: 0` 死代码
- 清理未使用的 catch 参数

## [1.3.0] — 2026-06-15

### 架构

- API 请求改为 Service Worker Port 代理（content.js 不再直接 fetch，绕过 CORS）
- 移除 manifest.json 中的 `host_permissions: ["*://*/*"]`

### 新增

- AI 思考过程（reasoning_content）展示，支持折叠/展开
- 对话中截图支持点击下载

### 修复

- 快速连续发送时 port 泄漏导致的竞态条件
- 截图模式下误点 overlay 外部区域静默取消截图
- `collectPrompts` 选择器作用域限定到侧边栏
- 主题切换 storage.set 异常未捕获

### 优化

- 提取 PROMPT_COUNT 常量替换硬编码 5
- 提取 switchTab / cancelScreenshot / extractDelta 公共函数，消除重复代码
- sanitizeHTML 移除冗余 DANGEROUS_ATTRS 条件
- callAPI 支持传入预取 settings，sendMessage 避免二次异步调用
- captureAndProceed 加载指示器改用 try-finally
- thinking 区域样式从 JS 内联移至 CSS
- overlay z-index 从 JS !important 移回 CSS
- 移除 saveSettings / removeLoadingIndicator / SIDEBAR_WIDTH 等无用代码
- 合并聊天面板和设置面板重复的滚动条样式

## [1.2.0] — 2026-06

- i18n 国际化支持（中文 / 英文）
- 安全强化
- 性能优化
- 代码清理

## [1.1.0]

- 初始发布
