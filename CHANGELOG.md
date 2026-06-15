# Changelog

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
