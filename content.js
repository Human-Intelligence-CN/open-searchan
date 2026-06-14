'use strict';
(function () {
    const SIDEBAR_WIDTH = 400;
    const MAX_IMAGE_DIM = 1920;

    // ========== Storage 封装 ==========
    const storage = {
        _cache: null,
        async get() {
            if (this._cache) return this._cache;
            const keys = ['os_api_url', 'os_api_key', 'os_model', 'os_max_tokens', 'os_theme',
                'os_prompt_1', 'os_prompt_2', 'os_prompt_3', 'os_prompt_4', 'os_prompt_5', 'os_prompt_active'];
            const result = await chrome.storage.local.get(keys);
            this._cache = {
                apiUrl: result.os_api_url || '',
                apiKey: result.os_api_key || '',
                model: result.os_model || '',
                prompts: [
                    result.os_prompt_1 || '',
                    result.os_prompt_2 || '',
                    result.os_prompt_3 || '',
                    result.os_prompt_4 || '',
                    result.os_prompt_5 || '',
                ],
                promptActive: parseInt(result.os_prompt_active) || 1,
                maxTokens: parseInt(result.os_max_tokens) || 1024,
                theme: result.os_theme || 'light',
            };
            return this._cache;
        },
        async set(obj) {
            const map = {};
            if (obj.apiUrl !== undefined) map.os_api_url = obj.apiUrl;
            if (obj.apiKey !== undefined) map.os_api_key = obj.apiKey;
            if (obj.model !== undefined) map.os_model = obj.model;
            if (obj.maxTokens !== undefined) map.os_max_tokens = String(obj.maxTokens);
            if (obj.theme !== undefined) map.os_theme = obj.theme;
            if (obj.prompts !== undefined) {
                obj.prompts.forEach((v, i) => { map[`os_prompt_${i + 1}`] = v; });
            }
            if (obj.promptActive !== undefined) map.os_prompt_active = String(obj.promptActive);
            await chrome.storage.local.set(map);
            this._cache = null;
        },
    };

    // ========== DOM 构建 ==========
    const sidebar = document.createElement('div');
    sidebar.id = 'os-sidebar';
    sidebar.className = 'os-hidden os-light';
    sidebar.innerHTML = `
    <div class="os-header">
      <span class="os-header-title">&#128269; OPEN SEARCHAN</span>
      <button class="os-theme-btn" title="切换亮色/暗色模式">&#9728;&#65039;</button>
    </div>
    <div class="os-tabs">
      <div class="os-tab os-active" data-tab="chat">&#128172; 对话</div>
      <div class="os-tab" data-tab="settings">&#9881;&#65039; 设置</div>
    </div>
    <div class="os-panel os-active" data-panel="chat">
      <div class="os-chat-messages">
        <div class="os-empty">Alt+Z 选区截图并自动发送<br>Alt+X 切换侧边栏 &middot; Alt+C 清空对话</div>
      </div>
      <div class="os-chat-input-area">
        <textarea class="os-chat-input" placeholder="输入追问… (Enter 发送, Shift+Enter 换行)" rows="1"></textarea>
        <button class="os-chat-send-btn">发送</button>
      </div>
    </div>
    <div class="os-panel" data-panel="settings">
      <form class="os-settings-form">
        <div class="os-form-group"><label>API 地址</label><input type="url" id="os-api-url" placeholder="https://api.xiaomimimo.com/v1/chat/completions" autocomplete="off"><div class="os-hint">OpenAI 兼容的 Chat Completions 端点</div></div>
        <div class="os-form-group"><label>API Key <button type="button" class="os-clear-key" title="清除 API Key">&#128465;</button></label><input type="text" id="os-api-key" placeholder="sk-..." autocomplete="off"><div class="os-hint">仅保存在本地浏览器中</div></div>
        <div class="os-form-group"><label>模型名称</label><input type="text" id="os-model" placeholder="mimo-v2.5" autocomplete="off"><div class="os-hint">例如 mimo-v2.5, mimo-v2</div></div>
        <div class="os-form-group"><label>默认提示词（选择一个启用）</label><div class="os-prompt-list" id="os-prompt-list"></div><div class="os-hint">截图后自动使用选中的提示词，空提示词不生效</div></div>
        <div class="os-form-group"><label>最大输出 Token</label><input type="number" id="os-max-tokens" placeholder="1024" min="64" max="16384" autocomplete="off"><div class="os-hint">AI 单次回复最大 token 数</div></div>
        <button type="submit" class="os-save-btn">&#128190; 保存设置</button>
        <div class="os-save-msg"></div>
        <div class="os-disclaimer"><p><b>Open Searchan v1.1</b></p><p>&copy; 2026 singal. All rights reserved.</p><p style="margin-top:8px;">免责声明：本工具仅供学习与研究用途。使用者应自行承担使用风险，开发者不对因使用本工具而产生的任何损失或法律责任负责。</p></div>
      </form>
    </div>
  `;

    const toggleBtn = document.createElement('div');
    toggleBtn.id = 'os-toggle-btn';
    toggleBtn.textContent = '◀';
    toggleBtn.title = '收起/展开侧边栏';

    const overlay = document.createElement('div');
    overlay.id = 'os-overlay';
    overlay.innerHTML = `
    <div class="os-overlay-piece" id="os-otop"></div>
    <div class="os-overlay-piece" id="os-obottom"></div>
    <div class="os-overlay-piece" id="os-oleft"></div>
    <div class="os-overlay-piece" id="os-oright"></div>
    <div id="os-selection-border"></div>
    <div id="os-overlay-hint">拖拽鼠标选择截图区域 · Esc 取消</div>
  `;

    document.body.appendChild(sidebar);
    document.body.appendChild(toggleBtn);
    document.body.appendChild(overlay);

    const $ = (sel) => sidebar.querySelector(sel);
    const messagesEl = $('.os-chat-messages');
    const inputEl = $('.os-chat-input');
    const sendBtn = $('.os-chat-send-btn');
    const settingsForm = $('.os-settings-form');
    const saveMsgEl = $('.os-save-msg');

    const oTop = document.getElementById('os-otop');
    const oBottom = document.getElementById('os-obottom');
    const oLeft = document.getElementById('os-oleft');
    const oRight = document.getElementById('os-oright');
    const selBorder = document.getElementById('os-selection-border');

    // ========== 设置读写 ==========
    async function getSettings() { return storage.get(); }
    async function saveSettings(url, key, model, prompts, promptActive, maxTokens) {
        await storage.set({ apiUrl: url, apiKey: key, model, prompts, promptActive, maxTokens });
    }
    async function loadSettingsToForm() {
        const s = await getSettings();
        document.getElementById('os-api-url').value = s.apiUrl;
        document.getElementById('os-api-key').value = s.apiKey;
        document.getElementById('os-model').value = s.model;
        document.getElementById('os-max-tokens').value = s.maxTokens;
        renderPromptList(s.prompts, s.promptActive);
    }

    // 渲染 5 个提示词槽位
    function renderPromptList(prompts, active) {
        const container = document.getElementById('os-prompt-list');
        if (!container) return;
        container.innerHTML = '';
        for (let i = 0; i < 5; i++) {
            const div = document.createElement('div');
            div.className = 'os-prompt-row';
            div.innerHTML = `
        <input type="text" class="os-prompt-input" id="os-prompt-${i + 1}" placeholder="提示词 ${i + 1}（留空则跳过）" value="${escapeHtml(prompts[i])}" autocomplete="off">
        <input type="radio" name="os-prompt-active" value="${i + 1}" ${(i + 1 === active) ? 'checked' : ''}>
      `;
            container.appendChild(div);
        }
    }

    // 收集当前 5 个提示词和选中项
    function collectPrompts() {
        const prompts = [];
        let active = 1;
        for (let i = 0; i < 5; i++) {
            const input = document.getElementById(`os-prompt-${i + 1}`);
            prompts.push(input ? input.value.trim() : '');
        }
        const radio = document.querySelector('input[name="os-prompt-active"]:checked');
        if (radio) active = parseInt(radio.value);
        return { prompts, active };
    }

    // ========== 对话状态 ==========
    let conversation = [];

    function resetConversation() {
        conversation = [];
        messagesEl.querySelectorAll('.os-msg, .os-loading').forEach(el => el.remove());
        if (!messagesEl.querySelector('.os-empty')) {
            const div = document.createElement('div');
            div.className = 'os-empty';
            div.innerHTML = 'Alt+Z 选区截图并自动发送<br>Alt+X 切换侧边栏 &middot; Alt+C 清空对话';
            messagesEl.appendChild(div);
        }
    }

    // ========== 侧边栏显隐 ==========
    function showSidebar() {
        sidebar.classList.remove('os-hidden');
        loadSettingsToForm();
    }
    function hideSidebar() { sidebar.classList.add('os-hidden'); }
    function toggleSidebar() {
        sidebar.classList.contains('os-hidden') ? showSidebar() : hideSidebar();
    }

    // ========== Tab 切换 ==========
    sidebar.querySelector('.os-tabs').addEventListener('click', (e) => {
        const tab = e.target.closest('.os-tab');
        if (!tab) return;
        const tabName = tab.dataset.tab;
        sidebar.querySelectorAll('.os-tab').forEach(t => t.classList.remove('os-active'));
        sidebar.querySelectorAll('.os-panel').forEach(p => p.classList.remove('os-active'));
        tab.classList.add('os-active');
        const panel = sidebar.querySelector(`[data-panel="${tabName}"]`);
        if (panel) panel.classList.add('os-active');
        if (tabName === 'settings') loadSettingsToForm();
    });

    toggleBtn.addEventListener('click', toggleSidebar);

    // 主题切换
    const themeBtn = sidebar.querySelector('.os-theme-btn');
    function setTheme(light) {
        sidebar.classList.toggle('os-light', light);
        themeBtn.textContent = light ? '☀️' : '🌙';
        storage.set({ theme: light ? 'light' : 'dark' });
    }
    themeBtn.addEventListener('click', () => setTheme(!sidebar.classList.contains('os-light')));

    // ========== 聊天消息渲染 ==========
    function removeEmptyState() {
        const el = messagesEl.querySelector('.os-empty');
        if (el) el.remove();
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // XSS 防护：移除危险标签和事件属性
    function sanitizeHTML(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        // 移除危险标签
        div.querySelectorAll('script,iframe,object,embed,applet,meta,link,style,base').forEach(el => el.remove());
        // 移除事件属性和 javascript: 协议
        const walk = (node) => {
            if (node.nodeType === 1) {
                for (const attr of [...node.attributes]) {
                    if (attr.name.startsWith('on') || /^javascript:/i.test(attr.value)) {
                        node.removeAttribute(attr.name);
                    }
                }
            }
            for (const child of [...node.childNodes]) walk(child);
        };
        walk(div);
        return div.innerHTML;
    }

    function renderMarkdown(text) {
        let html = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) =>
            `<div class="math-block">${escapeHtml(m.trim())}</div>`);
        html = html.replace(/(?<!\$)\$(?!\$)([^\$]+?)\$(?!\$)/g, (_, m) =>
            `<span class="math-inline">${escapeHtml(m.trim())}</span>`);
        html = (typeof marked !== 'undefined') ? marked.parse(html) : escapeHtml(text).replace(/\n/g, '<br>');
        if (typeof katex !== 'undefined' && document.compatMode !== 'BackCompat') {
            const div = document.createElement('div');
            div.innerHTML = sanitizeHTML(html);
            div.querySelectorAll('.math-block').forEach(el => {
                try { el.outerHTML = katex.renderToString(el.textContent, { displayMode: true, throwOnError: false }); } catch (_) { }
            });
            div.querySelectorAll('.math-inline').forEach(el => {
                try { el.outerHTML = katex.renderToString(el.textContent, { displayMode: false, throwOnError: false }); } catch (_) { }
            });
            html = div.innerHTML;
        }
        return sanitizeHTML(html);
    }

    function scrollToBottom() {
        requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
    }

    function appendUserMessage(imageSrc, promptText) {
        removeEmptyState();
        const div = document.createElement('div');
        div.className = 'os-msg os-msg-user';
        let h = '<div class="os-msg-label">你</div><div class="os-msg-bubble">';
        if (imageSrc) h += `<img src="${imageSrc}" alt="截图">`;
        h += `<span class="os-prompt-text">${escapeHtml(promptText)}</span></div>`;
        div.innerHTML = h;
        const img = div.querySelector('img');
        if (img) img.addEventListener('click', () => window.open(img.src));
        messagesEl.appendChild(div);
        scrollToBottom();
    }

    function createStreamingBubble() {
        removeEmptyState();
        removeLoadingIndicator();
        const div = document.createElement('div');
        div.className = 'os-msg os-msg-ai';
        div.innerHTML = '<div class="os-msg-label">AI</div>'
            + '<div class="os-thinking-toggle" style="display:none;cursor:pointer;font-size:11px;color:var(--os-muted);padding:2px 8px;user-select:none;">💭 思考过程 ▸</div>'
            + '<div class="os-thinking-content" style="display:none;font-size:12px;color:var(--os-text-dim);background:var(--os-header);padding:8px 12px;border-radius:8px;margin-bottom:6px;white-space:pre-wrap;border-left:2px solid var(--os-border);"></div>'
            + '<div class="os-msg-bubble"></div>';
        const bubble = div.querySelector('.os-msg-bubble');
        const toggle = div.querySelector('.os-thinking-toggle');
        const thinkingEl = div.querySelector('.os-thinking-content');
        toggle.addEventListener('click', () => {
            const shown = thinkingEl.style.display !== 'none';
            thinkingEl.style.display = shown ? 'none' : 'block';
            toggle.textContent = shown ? '💭 思考过程 ▸' : '💭 思考过程 ▾';
        });
        messagesEl.appendChild(div);
        let lastThinking = '';
        return {
            update(text, thinking) {
                if (thinking && thinking !== lastThinking) {
                    lastThinking = thinking;
                    thinkingEl.textContent = thinking;
                    toggle.style.display = 'block';
                }
                bubble.innerHTML = renderMarkdown(text);
                scrollToBottom();
            },
            error(text) { bubble.innerHTML = `<span style="color:var(--os-red);">${escapeHtml(text)}</span>`; },
        };
    }

    function removeLoadingIndicator() {
        const el = document.getElementById('os-loading-indicator');
        if (el) el.remove();
    }
    function appendErrorMessage(errorText) {
        removeEmptyState();
        removeLoadingIndicator();
        const div = document.createElement('div');
        div.className = 'os-msg os-msg-ai';
        div.innerHTML = `<div class="os-msg-label">错误</div><div class="os-msg-bubble" style="color:var(--os-red);">${escapeHtml(errorText)}</div>`;
        messagesEl.appendChild(div);
        scrollToBottom();
    }

    // ========== 截图 (chrome.tabs.captureVisibleTab) ==========
    async function captureScreen() {
        if (!chrome.runtime?.id) {
            console.error('[OS] Extension context invalidated, page refresh needed');
            throw new Error('扩展已更新，请刷新页面后重试');
        }
        return new Promise((resolve, reject) => {
            try {
                chrome.runtime.sendMessage({ type: 'capture' }, (resp) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (resp && resp.dataUrl) {
                        const img = new Image();
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            canvas.width = img.width;
                            canvas.height = img.height;
                            canvas.getContext('2d').drawImage(img, 0, 0);
                            resolve({
                                canvas,
                                offsetX: 0, offsetY: 0,
                                scaleX: img.width / window.innerWidth,
                                scaleY: img.height / window.innerHeight,
                            });
                        };
                        img.src = resp.dataUrl;
                    } else if (resp && resp.error) {
                        reject(new Error(resp.error));
                    } else {
                        reject(new Error('截图返回为空'));
                    }
                });
            } catch (e) {
                reject(new Error('扩展已更新，请刷新页面后重试'));
            }
        });
    }

    // ========== API 调用 (流式) ==========
    function callAPI(userContent, onChunk, callback) {
        getSettings().then(s => {
            if (!s.apiUrl || !s.apiKey || !s.model) {
                callback(new Error('请先在设置面板中填写 API 地址、API Key 和模型名称'));
                return;
            }
            const userMsg = { role: 'user', content: userContent };
            const systemMsg = {
                role: 'system',
                content: `You are Open Searchan, an AI assistant developed by singal-人类智慧研究社, focusing on identify image and response. Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. \n\n请始终使用中文回复。使用 Markdown 格式组织内容。数学表达式使用 LaTeX：行内 $...$，块级 $$...$$。`,
            };
            const messages = [systemMsg, ...conversation, userMsg];
            const body = {
                model: s.model,
                messages,
                max_completion_tokens: s.maxTokens,
                stream: true,
                thinking: { type: 'enabled' },
            };

            const xhr = new XMLHttpRequest();
            xhr.open('POST', s.apiUrl);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('api-key', s.apiKey);
            let fullText = '', thinkingText = '', lastIdx = 0;

            xhr.onprogress = function () {
                const chunk = xhr.responseText.slice(lastIdx);
                lastIdx = xhr.responseText.length;
                const lines = chunk.split('\n');
                for (const line of lines) {
                    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
                    try {
                        const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta;
                        if (delta?.reasoning_content) { thinkingText += delta.reasoning_content; onChunk(fullText, thinkingText); }
                        if (delta?.content) { fullText += delta.content; onChunk(fullText, thinkingText); }
                    } catch (_) { }
                }
            };

            xhr.onload = function () {
                if (xhr.status === 200 && fullText) {
                    conversation.push(userMsg);
                    conversation.push({ role: 'assistant', content: fullText, thinking: thinkingText || undefined });
                    callback(null, fullText, thinkingText);
                } else if (xhr.status === 200) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        const msg = data.choices?.[0]?.message;
                        const reply = msg?.content;
                        if (reply) {
                            conversation.push(userMsg);
                            conversation.push({ role: 'assistant', content: reply, thinking: msg?.reasoning_content });
                            callback(null, reply, msg?.reasoning_content);
                        } else { callback(new Error('API 返回为空')); }
                    } catch (e) { callback(new Error('解析失败: ' + e.message)); }
                } else {
                    let err = `HTTP ${xhr.status}`;
                    try { err = JSON.parse(xhr.responseText).error?.message || err; } catch (_) { }
                    callback(new Error(err + '\n\n请求地址: ' + s.apiUrl));
                }
            };

            xhr.onerror = function () {
                callback(new Error('网络请求失败\n请求地址: ' + s.apiUrl));
            };
            xhr.timeout = 120000;
            xhr.ontimeout = function () {
                callback(new Error('请求超时 (120s)'));
            };
            xhr.send(JSON.stringify(body));
        });
    }

    // ========== 发送消息 ==========
    let pendingImageData = null;

    async function sendMessage(promptText) {
        const s = await getSettings();
        if (!s.apiUrl || !s.apiKey || !s.model) {
            appendErrorMessage('请先在右侧"设置"面板中填写 API 地址、API Key 和模型名称');
            return;
        }
        const activePrompt = s.prompts[s.promptActive - 1] || '';
        const text = (promptText || inputEl.value.trim() || activePrompt || '请描述这张图片');
        if (!text && !pendingImageData) return;

        const userContent = [];
        if (pendingImageData) {
            userContent.push({ type: 'image_url', image_url: { url: pendingImageData } });
        }
        userContent.push({ type: 'text', text });

        appendUserMessage(pendingImageData, text);
        pendingImageData = null;
        inputEl.value = '';
        inputEl.style.height = 'auto';
        inputEl.focus();
        sendBtn.disabled = true;

        const streamBubble = createStreamingBubble();
        callAPI(userContent,
            (chunkText, thinking) => { streamBubble.update(chunkText, thinking); },
            (err, reply, thinking) => {
                sendBtn.disabled = false;
                if (err) streamBubble.error(err.message || String(err));
                else if (reply) streamBubble.update(reply, thinking);
            }
        );
    }

    sendBtn.addEventListener('click', () => sendMessage());
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    inputEl.addEventListener('input', () => {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
        if (inputEl.value.trim()) sendBtn.disabled = false;
    });

    // ========== 设置表单 ==========
    settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = document.getElementById('os-api-url').value.trim();
        const key = document.getElementById('os-api-key').value.trim();
        const model = document.getElementById('os-model').value.trim();
        const maxTokens = document.getElementById('os-max-tokens').value.trim();
        const { prompts, active } = collectPrompts();
        await saveSettings(url, key, model, prompts, active, maxTokens);
        saveMsgEl.textContent = '✅ 设置已保存';
        setTimeout(() => { saveMsgEl.textContent = ''; }, 2000);
    });

    sidebar.querySelector('.os-clear-key')?.addEventListener('click', async () => {
        document.getElementById('os-api-key').value = '';
        await storage.set({ apiKey: '' });
        saveMsgEl.textContent = '🗑 API Key 已清除';
        setTimeout(() => { saveMsgEl.textContent = ''; }, 2000);
    });

    // ========== 选区截图 ==========
    let selStartX = 0, selStartY = 0, selCurX = 0, selCurY = 0, isSelecting = false;

    function updateOverlay() {
        const x1 = Math.min(selStartX, selCurX), y1 = Math.min(selStartY, selCurY);
        const x2 = Math.max(selStartX, selCurX), y2 = Math.max(selStartY, selCurY);
        oTop.style.cssText = `top:0;left:0;width:100%;height:${y1}px;`;
        oBottom.style.cssText = `top:${y2}px;left:0;width:100%;height:${window.innerHeight - y2}px;`;
        oLeft.style.cssText = `top:${y1}px;left:0;width:${x1}px;height:${y2 - y1}px;`;
        oRight.style.cssText = `top:${y1}px;left:${x2}px;width:${window.innerWidth - x2}px;height:${y2 - y1}px;`;
        selBorder.style.cssText = `left:${x1}px;top:${y1}px;width:${x2 - x1}px;height:${y2 - y1}px;display:block;`;
    }

    function startScreenshot() {
        document.body.style.userSelect = '';
        overlay.classList.remove('os-active');
        isSelecting = false;

        const wasVisible = !sidebar.classList.contains('os-hidden');
        if (wasVisible) sidebar.style.visibility = 'hidden';
        toggleBtn.style.display = 'none';

        overlay.classList.add('os-active');
        document.body.style.userSelect = 'none';
        selStartX = selStartY = selCurX = selCurY = 0;
        selBorder.style.display = 'none';
        oTop.style.cssText = 'top:0;left:0;width:100%;height:100%;';
        oBottom.style.cssText = oLeft.style.cssText = oRight.style.cssText = 'display:none;';

        function onMouseDown(e) {
            e.preventDefault();
            isSelecting = true;
            selStartX = selCurX = e.clientX;
            selStartY = selCurY = e.clientY;
            updateOverlay();
        }
        function onMouseMove(e) {
            if (!isSelecting) return;
            e.preventDefault();
            selCurX = Math.max(0, Math.min(e.clientX, window.innerWidth));
            selCurY = Math.max(0, Math.min(e.clientY, window.innerHeight));
            updateOverlay();
        }
        function onMouseUp(e) {
            if (!isSelecting) { cleanup(); return; }
            isSelecting = false;
            const x1 = Math.min(selStartX, selCurX), y1 = Math.min(selStartY, selCurY);
            const x2 = Math.max(selStartX, selCurX), y2 = Math.max(selStartY, selCurY);
            const w = x2 - x1, h = y2 - y1;
            cleanup();
            if (wasVisible) sidebar.style.visibility = '';
            toggleBtn.style.display = '';
            if (w < 10 || h < 10) {
                overlay.classList.remove('os-active');
                document.body.style.userSelect = '';
                return;
            }
            captureAndProceed(x1, y1, w, h);
        }
        function onKeyDown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                cleanup();
                if (wasVisible) sidebar.style.visibility = '';
                toggleBtn.style.display = '';
                overlay.classList.remove('os-active');
                document.body.style.userSelect = '';
            }
        }
        function cleanup() {
            isSelecting = false;
            overlay.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.removeEventListener('keydown', onKeyDown);
        }
        overlay.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('keydown', onKeyDown);
    }

    async function captureAndProceed(vpX, vpY, vpW, vpH) {
        overlay.classList.remove('os-active');
        document.body.style.userSelect = '';

        removeEmptyState();
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'os-loading';
        loadingDiv.id = 'os-capture-loading';
        loadingDiv.innerHTML = '<span>&#128247; 截图处理中...</span>';
        messagesEl.appendChild(loadingDiv);

        try {
            const result = await captureScreen();
            if (!result) {
                appendErrorMessage('截图失败：请确保已授予扩展权限，或刷新页面后重试');
                return;
            }
            const { canvas: fullCanvas, offsetX, offsetY, scaleX, scaleY } = result;
            const sx = (vpX + offsetX) * scaleX;
            const sy = (vpY + offsetY) * scaleY;
            const sw = vpW * scaleX;
            const sh = vpH * scaleY;

            let finalCanvas = document.createElement('canvas');
            const resize = Math.min(1, MAX_IMAGE_DIM / sw, MAX_IMAGE_DIM / sh);
            finalCanvas.width = Math.round(sw * resize);
            finalCanvas.height = Math.round(sh * resize);
            const ctx = finalCanvas.getContext('2d');
            ctx.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, finalCanvas.width, finalCanvas.height);
            const base64 = finalCanvas.toDataURL('image/jpeg', 0.85);

            const capLoading = document.getElementById('os-capture-loading');
            if (capLoading) capLoading.remove();

            showSidebar();
            sidebar.querySelector('[data-tab="chat"]').classList.add('os-active');
            sidebar.querySelector('[data-tab="settings"]').classList.remove('os-active');
            sidebar.querySelector('[data-panel="chat"]').classList.add('os-active');
            sidebar.querySelector('[data-panel="settings"]').classList.remove('os-active');
            conversation = [];
            pendingImageData = base64;
            const s = await getSettings();
            const activePrompt = s.prompts[s.promptActive - 1] || '请描述这张图片';
            sendMessage(activePrompt);
        } catch (err) {
            const capLoading = document.getElementById('os-capture-loading');
            if (capLoading) capLoading.remove();
            appendErrorMessage('截图失败: ' + (err.message || String(err)));
        }
    }

    // ========== 快捷键 ==========
    // 快捷键：Alt+X 侧边栏，Alt+C 清空对话
    document.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 'x' || e.key === 'X')) {
            e.preventDefault(); e.stopPropagation(); toggleSidebar(); return;
        }
        if (e.altKey && (e.key === 'c' || e.key === 'C')) {
            e.preventDefault(); e.stopPropagation(); resetConversation(); return;
        }
    });

    // Alt+Z 截图 → 由 background 通过 manifest commands 触发，
    // 这样 activeTab 权限才能激活
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'start_screenshot') startScreenshot();
    });

    // ========== 初始化 ==========
    async function init() {
        const s = await getSettings();
        setTheme(s.theme !== 'dark');
        hideSidebar();
        console.log('[OPEN SEARCHAN] 截图助手已就绪 (扩展版)');
        console.log('  Alt+Z  开始选区截图 (扩展命令触发)');
        console.log('  Alt+X  切换侧边栏');
        console.log('  Alt+C  清空对话');
    }

    init();
})();
