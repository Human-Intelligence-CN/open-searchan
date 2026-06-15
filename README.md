# OPEN SEARCHAN ~ 开放识图酱

> Alt+Z 框选截图 → AI 多模态模型 → 右边栏对话  
> **识图 · 翻译 · 解答** 三位一体浏览器扩展

## 功能

| 能力 | 触发方式 | 说明 |
|------|---------|------|
| 🔍 AI 识图 | Alt+Z 框选 → 自动发送 | 选中页面任意区域，AI 解读图片内容 |
| 🌐 框选翻译 | 设置提示词为"翻译此内容" | 框选外文区域，AI 即时翻译 |
| ✍️ 框选解答 | 设置提示词为题目相关指令 | 框选试题/文章，AI 分析并解答 |
| 💬 连续追问 | 输入框 Enter 发送 | 纯文本多轮对话，上下文持续保留 |
| 📐 LaTeX 渲染 | 自动 | AI 回复中的数学公式渲染为排版数学 |
| 🎨 亮色/暗色 | 头部 🌙 按钮 | 一键切换，偏好保存 |

## 安装
1. 打开 `chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `os-extension` 目录

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Alt+Z` | 框选截图并自动发送 AI |
| `Alt+X` | 切换侧边栏显示/隐藏 |
| `Alt+C` | 清空当前对话 |

## 首次使用

1. 按 `Alt+X` 打开侧边栏
2. 切换到 ⚙️ 设置面板
3. 填写 API 地址、API Key、模型名称
4. 配置 5 个可选提示词（截图时自动使用激活的那个）
5. 保存设置

## 提示词用法示例

设置面板提供 5 个可自定义提示词槽位，单选激活。根据不同场景切换：

| 提示词 | 场景 |
|--------|------|
| `请详细描述这张图片的内容` | 通用识图 |
| `把图中的文字翻译成中文` | 框选翻译 |
| `请解答图中的题目，给出详细步骤` | 框选解题 |
| `分析这张截图中的 UI 设计问题` | 设计评审 |
| `提取图中表格数据，输出 JSON` | 数据提取 |

## 技术架构

```
Alt+Z (Chrome Extension Command)
  │
  ▼
Background Service Worker
  │  ① chrome.commands → activeTab → 通知 content script
  │  ② chrome.tabs.captureVisibleTab → GPU 帧缓冲静默截图
  │  ③ chrome.runtime.connect Port → 代理 API 请求绕过 CORS
  │
  ▼
Content Script
  │  选区叠加层 (拖拽框选) → Canvas 裁剪 → JPEG 压缩
  │  侧边栏 UI (Chat + Settings 面板)
  │  marked + KaTeX → Markdown + LaTeX 渲染
  │
  ▼
Port 长连接 (chrome.runtime.connect)
  │  content ↔ SW 双向消息
  │  SW 代发 fetch(SSE stream) → 解析 delta → 增量回传（非累积全文）
  │  HTTPS 强制校验（双层：SW 端 + 设置表单预检）
  │  AbortController 两段超时（fetch 180s + stream 300s），局部变量隔离防并发
  │
  ▼
OpenAI 兼容 API
  │  POST /chat/completions (stream: true)
  │  支持 reasoning_content 思考过程（可折叠展开）
  │  非流式兼容回退解析完整 JSON
```

### 数据流

- **截图**: Alt+Z → content 选区 → `captureVisibleTab` → Canvas 裁剪 JPEG → base64 → Port → SW fetch → API
- **对话**: content 构建 messages → Port 发给 SW → SW fetch SSE → 逐 delta 增量回传 → content 累积渲染
- **流式优化**: SW 只发送增量（`deltaText`/`deltaThinking`），content 侧本地累积，避免 O(n²) 数据传输
- **设置**: `chrome.storage.local` 读写，content 和 SW 均可访问，`storage.onChanged` 多标签页同步
- **主题**: CSS 变量定义在 `body`/`body.os-light`，一键切换暗色/亮色，偏好存入 storage
- **对话管理**: 最多保留 20 轮（40 条消息），自动截断旧消息，防止上下文窗口溢出

## 项目结构

```
open-searchan/
├── manifest.json          # MV3 清单（CSP 声明、最小权限、Alt+Z 命令）
├── background.js          # Service Worker（截图捕获 + Port 流式代理 + SSE 增量解析）
├── content.js             # Content Script（侧边栏 UI + 选区截图 + 聊天 + XSS 防护）
├── content.css            # 样式（CSS 变量主题定义在 body，暗/亮双主题）
├── marked.min.js          # Markdown → HTML 渲染（输出经 sanitizeHTML 消毒）
├── katex.min.js           # LaTeX 数学公式渲染（Unicode 占位符保护）
├── katex.min.css          # KaTeX 样式
├── _locales/              # 国际化（zh_CN / en，55 个翻译键）
│   ├── zh_CN/messages.json
│   └── en/messages.json
└── icons/                 # 扩展图标（16 / 48 / 128 px）
```

## 依赖

- [marked](https://github.com/markedjs/marked) — Markdown 解析
- [KaTeX](https://katex.org/) — LaTeX 数学公式渲染

## 安全与隐私

- **HTTPS 强制**：SW 层拒绝非加密 API 请求，设置表单预检双重拦截
- **XSS 防护**：`DOMParser` 消毒（不触发外部资源）+ `escapeHtml` 转义 + 事件属性/javascript: 协议过滤
- **API Key**：仅存储在本地 `chrome.storage.local`，不同步到云端
- **截图数据**：仅通过 HTTPS 发送到用户自行配置的 API 端点，不经过第三方
- **CSP 声明**：`script-src 'self'; object-src 'self'`，禁止内联脚本
- **无数据收集**：不包含任何埋点、统计或遥测代码
- **最小权限**：仅申请 `storage`、`activeTab`、`tabs` 三项权限

## License

MIT
