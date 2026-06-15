'use strict';
(function () {
    const SIDEBAR_WIDTH = 400;
    const MAX_IMAGE_DIM = 1920;

    // i18n 快捷函数
    const i18n = (k, ...s) => chrome.i18n.getMessage(k, s.length ? s : undefined);

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

    // 监听 storage 变更以清除缓存（多页面同步）
    chrome.storage.onChanged.addListener((changes) => {
        for (const key of Object.keys(changes)) {
            if (key.startsWith('os_')) { storage._cache = null; break; }
        }
    });

    // ========== DOM 构建 ==========
    const sidebar = document.createElement('div');
    sidebar.id = 'os-sidebar';
    sidebar.className = 'os-hidden os-light';
    sidebar.innerHTML = `
    <div class="os-header">
      <span class="os-header-title">${i18n('sidebarTitle')}</span>
      <button class="os-theme-btn" title="${i18n('themeToggleTitle')}">${i18n('themeDarkIcon')}</button>
    </div>
    <div class="os-tabs">
      <div class="os-tab os-active" data-tab="chat">${i18n('tabChat')}</div>
      <div class="os-tab" data-tab="settings">${i18n('tabSettings')}</div>
    </div>
    <div class="os-panel os-active" data-panel="chat">
      <div class="os-chat-messages">
        <div class="os-empty">${i18n('emptyState')}</div>
      </div>
      <div class="os-chat-input-area">
        <textarea class="os-chat-input" placeholder="${i18n('inputPlaceholder')}" rows="1"></textarea>
        <button class="os-chat-send-btn">${i18n('sendButton')}</button>
      </div>
    </div>
    <div class="os-panel" data-panel="settings">
      <form class="os-settings-form">
        <div class="os-form-group"><label>${i18n('settingsApiUrlLabel')}</label><input type="url" id="os-api-url" placeholder="https://api.xiaomimimo.com/v1/chat/completions" autocomplete="off"><div class="os-hint">${i18n('settingsApiUrlHint')}</div></div>
        <div class="os-form-group"><label>${i18n('settingsApiKeyLabel')} <button type="button" class="os-clear-key" title="${i18n('settingsClearKeyTitle')}">&#128465;</button></label><input type="text" id="os-api-key" placeholder="sk-..." autocomplete="off"><div class="os-hint">${i18n('settingsApiKeyHint')}</div></div>
        <div class="os-form-group"><label>${i18n('settingsModelLabel')}</label><input type="text" id="os-model" placeholder="mimo-v2.5" autocomplete="off"><div class="os-hint">${i18n('settingsModelHint')}</div></div>
        <div class="os-form-group"><label>${i18n('settingsPromptLabel')}</label><div class="os-prompt-list" id="os-prompt-list"></div><div class="os-hint">${i18n('settingsPromptHint')}</div></div>
        <div class="os-form-group"><label>${i18n('settingsMaxTokensLabel')}</label><input type="number" id="os-max-tokens" placeholder="1024" min="64" max="16384" autocomplete="off"><div class="os-hint">${i18n('settingsMaxTokensHint')}</div></div>
        <button type="submit" class="os-save-btn">${i18n('settingsSaveButton')}</button>
        <div class="os-save-msg"></div>
        <div class="os-disclaimer">${i18n('disclaimerText')}</div>
      </form>
    </div>
  `;

    const toggleBtn = document.createElement('div');
    toggleBtn.id = 'os-toggle-btn';
    toggleBtn.textContent = '◀';
    toggleBtn.title = i18n('toggleButtonTitle');

    const overlay = document.createElement('div');
    overlay.id = 'os-overlay';
    overlay.innerHTML = `
    <div class="os-overlay-piece" id="os-otop"></div>
    <div class="os-overlay-piece" id="os-obottom"></div>
    <div class="os-overlay-piece" id="os-oleft"></div>
    <div class="os-overlay-piece" id="os-oright"></div>
    <div id="os-selection-border"></div>
    <div id="os-overlay-hint">${i18n('overlayHint')}</div>
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
        <input type="text" class="os-prompt-input" id="os-prompt-${i + 1}" placeholder="${i18n('promptPlaceholder', String(i + 1))}" value="${escapeHtml(prompts[i])}" autocomplete="off">
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
            div.innerHTML = i18n('emptyState');
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
        themeBtn.textContent = light ? i18n('themeLightIcon') : i18n('themeDarkIcon');
        storage.set({ theme: light ? 'light' : 'dark' });
    }
    themeBtn.addEventListener('click', () => setTheme(!sidebar.classList.contains('os-light')));

    // ========== 聊天消息渲染 ==========
    function removeEmptyState() {
        const el = messagesEl.querySelector('.os-empty');
        if (el) el.remove();
    }

    const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    function escapeHtml(str) {
        return str.replace(/[&<>"']/g, m => ESCAPE_MAP[m]);
    }

    // XSS 防护：移除危险标签、事件属性、javascript: 协议和 SVG 攻击向量
    function sanitizeHTML(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        // 移除危险标签（含 SVG 攻击向量）
        div.querySelectorAll('script,iframe,object,embed,applet,meta,link,style,base,'
            + 'animate,set,animateMotion,animateTransform,'
            + 'filter,pattern,use[href]').forEach(el => el.remove());
        // 移除事件属性、javascript: 协议
        const DANGEROUS_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction', 'data'];
        const walk = (node) => {
            if (node.nodeType === 1) {
                for (const attr of [...node.attributes]) {
                    const name = attr.name.toLowerCase();
                    const val = attr.value;
                    if (name.startsWith('on')
                        || /^javascript:/i.test(val)
                        || (DANGEROUS_ATTRS.includes(name) && /^javascript:/i.test(val))) {
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
        let h = `<div class="os-msg-label">${i18n('youLabel')}</div><div class="os-msg-bubble">`;
        if (imageSrc) h += `<img src="${imageSrc}" alt="${i18n('youLabel')}">`;
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
            + `<div class="os-thinking-toggle" style="display:none;cursor:pointer;font-size:11px;color:var(--os-muted);padding:2px 8px;user-select:none;">${i18n('thinkingCollapsed')}</div>`
            + '<div class="os-thinking-content" style="display:none;font-size:12px;color:var(--os-text-dim);background:var(--os-header);padding:8px 12px;border-radius:8px;margin-bottom:6px;white-space:pre-wrap;border-left:2px solid var(--os-border);"></div>'
            + '<div class="os-msg-bubble"></div>';
        const bubble = div.querySelector('.os-msg-bubble');
        const toggle = div.querySelector('.os-thinking-toggle');
        const thinkingEl = div.querySelector('.os-thinking-content');
        toggle.addEventListener('click', () => {
            const shown = thinkingEl.style.display !== 'none';
            thinkingEl.style.display = shown ? 'none' : 'block';
            toggle.textContent = shown ? i18n('thinkingCollapsed') : i18n('thinkingExpanded');
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
        div.innerHTML = `<div class="os-msg-label">${i18n('errorLabel')}</div><div class="os-msg-bubble" style="color:var(--os-red);">${escapeHtml(errorText)}</div>`;
        messagesEl.appendChild(div);
        scrollToBottom();
    }

    // ========== 截图 (chrome.tabs.captureVisibleTab) ==========
    async function captureScreen() {
        if (!chrome.runtime?.id) {
            console.error('[OS] Extension context invalidated');
            throw new Error(i18n('errorContextInvalidated'));
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
                        reject(new Error(i18n('errorApiEmpty')));
                    }
                });
            } catch (e) {
                reject(new Error(i18n('errorContextInvalidated')));
            }
        });
    }

    // ========== API 调用 (fetch + ReadableStream，支持取消) ==========
    let activeAbortController = null;

    function abortActiveRequest() {
        if (activeAbortController) {
            activeAbortController.abort();
            activeAbortController = null;
        }
    }

    function callAPI(userContent, onChunk, callback) {
        // 取消前一个请求
        abortActiveRequest();
        const abortController = new AbortController();
        activeAbortController = abortController;

        // 超时处理（120s）
        const timeoutId = setTimeout(() => abortController.abort(), 120000);

        getSettings().then(async (s) => {
            if (!s.apiUrl || !s.apiKey || !s.model) {
                clearTimeout(timeoutId);
                activeAbortController = null;
                callback(new Error(i18n('errorNoSettings')));
                return;
            }
            const userMsg = { role: 'user', content: userContent };
            const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const systemMsg = {
                role: 'system',
                content: i18n('systemPrompt').replace('$DATE$', dateStr),
            };
            const messages = [systemMsg, ...conversation, userMsg];
            const body = {
                model: s.model,
                messages,
                max_completion_tokens: s.maxTokens,
                stream: true,
                thinking: { type: 'enabled' },
            };

            try {
                const response = await fetch(s.apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'api-key': s.apiKey,
                    },
                    body: JSON.stringify(body),
                    signal: abortController.signal,
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    let err = `HTTP ${response.status}`;
                    try {
                        const data = await response.json();
                        err = data.error?.message || err;
                    } catch (_) {}
                    activeAbortController = null;
                    callback(new Error(err + '\n\n' + s.apiUrl));
                    return;
                }

                // 流式读取 SSE
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let fullText = '', thinkingText = '', buffer = '';
                const rawChunks = [];

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    rawChunks.push(value);
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
                        try {
                            const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta;
                            if (delta?.reasoning_content) { thinkingText += delta.reasoning_content; onChunk(fullText, thinkingText); }
                            if (delta?.content) { fullText += delta.content; onChunk(fullText, thinkingText); }
                        } catch (_) {}
                    }
                }

                // 处理尾部残留行
                buffer += decoder.decode(); // flush decoder
                if (buffer.startsWith('data: ') && buffer !== 'data: [DONE]') {
                    try {
                        const delta = JSON.parse(buffer.slice(6)).choices?.[0]?.delta;
                        if (delta?.reasoning_content) thinkingText += delta.reasoning_content;
                        if (delta?.content) fullText += delta.content;
                        onChunk(fullText, thinkingText);
                    } catch (_) {}
                }

                activeAbortController = null;
                if (fullText) {
                    conversation.push(userMsg);
                    conversation.push({ role: 'assistant', content: fullText, thinking: thinkingText || undefined });
                    callback(null, fullText, thinkingText);
                } else {
                    // 非流式兼容：尝试解析完整 JSON
                    try {
                        const all = rawChunks.length
                            ? new TextDecoder().decode(new Uint8Array(rawChunks.reduce((a, c) => { const t = new Uint8Array(a.length + c.length); t.set(a); t.set(c, a.length); return t; }, new Uint8Array(0))))
                            : '';
                        const data = JSON.parse(all);
                        const msg = data.choices?.[0]?.message;
                        const reply = msg?.content;
                        if (reply) {
                            conversation.push(userMsg);
                            conversation.push({ role: 'assistant', content: reply, thinking: msg?.reasoning_content });
                            callback(null, reply, msg?.reasoning_content);
                        } else {
                            callback(new Error(i18n('errorApiEmpty')));
                        }
                    } catch (_) {
                        callback(new Error(i18n('errorApiEmpty')));
                    }
                }
            } catch (e) {
                clearTimeout(timeoutId);
                if (e.name === 'AbortError') {
                    // 被取消或超时，静默处理
                    return;
                }
                activeAbortController = null;
                callback(new Error(i18n('errorNetworkFailed', s.apiUrl)));
            }
        });
    }

    // ========== 辅助函数 ==========
    async function getActivePromptText() {
        const s = await getSettings();
        return s.prompts[s.promptActive - 1] || '';
    }

    // ========== 发送消息 ==========
    let pendingImageData = null;

    async function sendMessage(promptText) {
        const s = await getSettings();
        if (!s.apiUrl || !s.apiKey || !s.model) {
            appendErrorMessage(i18n('errorNoSettingsSidebar'));
            return;
        }
        const activePrompt = await getActivePromptText();
        const text = (promptText || inputEl.value.trim() || activePrompt || i18n('defaultPromptText'));
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
        saveMsgEl.textContent = i18n('settingsSaved');
        setTimeout(() => { saveMsgEl.textContent = ''; }, 2000);
    });

    sidebar.querySelector('.os-clear-key')?.addEventListener('click', async () => {
        document.getElementById('os-api-key').value = '';
        await storage.set({ apiKey: '' });
        saveMsgEl.textContent = i18n('apiKeyCleared');
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
        loadingDiv.innerHTML = `<span>${i18n('captureLoading')}</span>`;
        messagesEl.appendChild(loadingDiv);

        try {
            const result = await captureScreen();
            if (!result) {
                appendErrorMessage(i18n('errorCaptureNoPermission'));
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
            const activePrompt = (await getActivePromptText()) || i18n('defaultPromptText');
            sendMessage(activePrompt);
        } catch (err) {
            const capLoading = document.getElementById('os-capture-loading');
            if (capLoading) capLoading.remove();
            appendErrorMessage(i18n('errorCaptureFailed', err.message || String(err)));
        }
    }

    // ========== 快捷键 ==========
    document.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 'x' || e.key === 'X')) {
            e.preventDefault(); e.stopPropagation(); toggleSidebar(); return;
        }
        if (e.altKey && (e.key === 'c' || e.key === 'C')) {
            e.preventDefault(); e.stopPropagation(); resetConversation(); return;
        }
    });

    // Alt+Z 截图 → 由 background 通过 manifest commands 触发
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'start_screenshot') startScreenshot();
    });

    // ========== 初始化 ==========
    async function init() {
        const s = await getSettings();
        setTheme(s.theme !== 'dark');
        hideSidebar();
        console.log(i18n('consoleReady'));
        console.log(i18n('consoleHelpZ'));
        console.log(i18n('consoleHelpX'));
        console.log(i18n('consoleHelpC'));
    }

    init();
})();
