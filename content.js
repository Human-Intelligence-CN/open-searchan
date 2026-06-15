'use strict';
(function () {
    const DEBUG = false;
    const MAX_IMAGE_DIM = 1920;
    const PROMPT_COUNT = 5;
    const MAX_CONVERSATION = 40; // 最多保留 20 轮对话 (40 条消息)
    const MAX_RETRIES = 2;

    // i18n 快捷函数
    const i18n = (k, ...s) => chrome.i18n.getMessage(k, s.length ? s : undefined);

    // ========== Storage 封装 ==========
    const storage = {
        _cache: null,
        async get() {
            if (this._cache) return this._cache;
            const keys = ['os_api_url', 'os_api_key', 'os_model', 'os_max_tokens', 'os_theme', 'os_prompt_active'];
            for (let i = 1; i <= PROMPT_COUNT; i++) keys.push(`os_prompt_${i}`);
            const result = await chrome.storage.local.get(keys);
            this._cache = {
                apiUrl: result.os_api_url || '',
                apiKey: result.os_api_key || '',
                model: result.os_model || '',
                prompts: Array.from({ length: PROMPT_COUNT }, (_, i) => result[`os_prompt_${i + 1}`] || ''),
                promptActive: parseInt(result.os_prompt_active, 10) || 1,
                maxTokens: Math.max(64, parseInt(result.os_max_tokens, 10) || 1024),
                theme: result.os_theme || 'light',
            };
            return this._cache;
        },
        async set(obj) {
            const map = {};
            if (obj.apiUrl !== undefined) map.os_api_url = obj.apiUrl;
            if (obj.apiKey !== undefined) map.os_api_key = obj.apiKey;
            if (obj.model !== undefined) map.os_model = obj.model;
            if (obj.maxTokens !== undefined) {
                map.os_max_tokens = String(Math.max(64, parseInt(obj.maxTokens, 10) || 1024));
            }
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
    sidebar.className = 'os-hidden';
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

    document.body.classList.add('os-light'); // 初始亮色主题，init 时按存储调整
    document.body.appendChild(sidebar);
    document.body.appendChild(toggleBtn);
    document.body.appendChild(overlay);

    const $ = (sel) => sidebar.querySelector(sel);
    const messagesEl = $('.os-chat-messages');
    const inputEl = $('.os-chat-input');
    const sendBtn = $('.os-chat-send-btn');
    const settingsForm = $('.os-settings-form');
    const saveMsgEl = $('.os-save-msg');
    let saveMsgTimer = null;
    function setSaveMsg(text, duration) {
        if (saveMsgTimer) clearTimeout(saveMsgTimer);
        saveMsgEl.textContent = text;
        saveMsgTimer = setTimeout(() => { saveMsgEl.textContent = ''; saveMsgTimer = null; }, duration);
    }

    const oTop = document.getElementById('os-otop');
    const oBottom = document.getElementById('os-obottom');
    const oLeft = document.getElementById('os-oleft');
    const oRight = document.getElementById('os-oright');
    const selBorder = document.getElementById('os-selection-border');

    // ========== 设置读写 ==========
    async function getSettings() { return storage.get(); }
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
        for (let i = 0; i < PROMPT_COUNT; i++) {
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
        for (let i = 0; i < PROMPT_COUNT; i++) {
            const input = document.getElementById(`os-prompt-${i + 1}`);
            prompts.push(input ? input.value.trim() : '');
        }
        const radio = sidebar.querySelector('input[name="os-prompt-active"]:checked');
        if (radio) active = parseInt(radio.value, 10);
        return { prompts, active };
    }

    // ========== 对话状态 ==========
    let conversation = [];

    function resetConversation() {
        abortActiveRequest();
        apiRequestId++;      // 使过期重试静默退出
        requestCounter++;    // 使过期回调跳过共享状态修改
        requestPending = false;
        sendBtn.disabled = false;
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
    let settingsLoading = false;
    async function showSidebar() {
        sidebar.classList.remove('os-hidden');
        if (!settingsLoading) {
            settingsLoading = true;
            await loadSettingsToForm().finally(() => { settingsLoading = false; });
        }
    }
    function hideSidebar() { sidebar.classList.add('os-hidden'); }
    function toggleSidebar() {
        sidebar.classList.contains('os-hidden') ? showSidebar() : hideSidebar();
    }

    // ========== Tab 切换 ==========
    function switchTab(name) {
        sidebar.querySelectorAll('.os-tab').forEach(t => t.classList.remove('os-active'));
        sidebar.querySelectorAll('.os-panel').forEach(p => p.classList.remove('os-active'));
        const tab = sidebar.querySelector(`[data-tab="${name}"]`);
        const panel = sidebar.querySelector(`[data-panel="${name}"]`);
        if (tab) tab.classList.add('os-active');
        if (panel) panel.classList.add('os-active');
        if (name === 'settings' && !settingsLoading) {
            settingsLoading = true;
            loadSettingsToForm().finally(() => { settingsLoading = false; });
        }
    }

    sidebar.querySelector('.os-tabs')?.addEventListener('click', (e) => {
        const tab = e.target.closest('.os-tab');
        if (!tab) return;
        switchTab(tab.dataset.tab);
    });

    toggleBtn.addEventListener('click', toggleSidebar);

    // 主题切换（独立状态变量，避免依赖 CSS class）
    const themeBtn = sidebar.querySelector('.os-theme-btn');
    let themeIsLight = true;
    function setTheme(light) {
        themeIsLight = light;
        document.body.classList.toggle('os-light', light);
        if (themeBtn) themeBtn.textContent = light ? i18n('themeLightIcon') : i18n('themeDarkIcon');
        storage.set({ theme: light ? 'light' : 'dark' }).catch(() => {});
    }
    themeBtn?.addEventListener('click', () => setTheme(!themeIsLight));

    // ========== 聊天消息渲染 ==========
    function removeEmptyState() {
        const el = messagesEl.querySelector('.os-empty');
        if (el) el.remove();
    }

    const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    function escapeHtml(str) {
        return str.replace(/[&<>"']/g, m => ESCAPE_MAP[m]);
    }

    // XSS 防护：DOMParser 不会加载外部资源（innerHTML 会触发 img 等请求）
    function sanitizeHTML(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        // 移除危险标签（含 SVG 攻击向量）
        doc.querySelectorAll('script,iframe,object,embed,applet,meta,link,style,base,'
            + 'animate,set,animateMotion,animateTransform,'
            + 'filter,pattern,use[href],foreignObject,handler').forEach(el => el.remove());
        // 移除事件属性、javascript: 协议
        const DANGEROUS = /^javascript:/i;
        const walk = (node) => {
            if (node.nodeType === 1) {
                for (const attr of [...node.attributes]) {
                    const name = attr.name.toLowerCase();
                    const val = attr.value;
                    if (name.startsWith('on') || DANGEROUS.test(val)) {
                        node.removeAttribute(attr.name);
                    }
                }
            }
            for (const child of [...node.childNodes]) walk(child);
        };
        walk(doc.body);
        return doc.body.innerHTML;
    }

    function renderMarkdown(text) {
        // 用占位符保护数学公式，防止 marked 解析时破坏 LaTeX 语法
        const mathBlocks = [], mathInlines = [];
        const PB = ''; // Unicode 私用区，不会出现在正常文本中
        let html = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => {
            mathBlocks.push(m.trim());
            return `${PB}MB${mathBlocks.length - 1}${PB}`;
        });
        html = html.replace(/(?<!\$)\$(?!\$)([^\$]+?)\$(?!\$)/g, (_, m) => {
            mathInlines.push(m.trim());
            return `${PB}MI${mathInlines.length - 1}${PB}`;
        });
        html = (typeof marked !== 'undefined') ? marked.parse(html) : escapeHtml(text).replace(/\n/g, '<br>');
        // 还原数学公式占位符
        html = html.replace(new RegExp(PB + 'MB(\\d+)' + PB, 'g'), (_, i) =>
            `<div class="math-block">${escapeHtml(mathBlocks[+i])}</div>`);
        html = html.replace(new RegExp(PB + 'MI(\\d+)' + PB, 'g'), (_, i) =>
            `<span class="math-inline">${escapeHtml(mathInlines[+i])}</span>`);
        if (typeof katex !== 'undefined') {
            const div = document.createElement('div');
            div.innerHTML = sanitizeHTML(html);
            div.querySelectorAll('.math-block').forEach(el => {
                try { el.outerHTML = katex.renderToString(el.textContent, { displayMode: true, throwOnError: false }); } catch (_) { }
            });
            div.querySelectorAll('.math-inline').forEach(el => {
                try { el.outerHTML = katex.renderToString(el.textContent, { displayMode: false, throwOnError: false }); } catch (_) { }
            });
            return div.innerHTML; // KaTeX 输出已安全，无需二次 sanitize
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
        if (imageSrc && /^data:image\//.test(imageSrc)) h += `<img src="${imageSrc}" alt="${i18n('youLabel')}">`;
        h += `<span class="os-prompt-text">${escapeHtml(promptText)}</span></div>`;
        div.innerHTML = h;
        const img = div.querySelector('img');
        if (img) img.addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = img.src;
            a.download = 'screenshot.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
        messagesEl.appendChild(div);
        scrollToBottom();
    }

    function createStreamingBubble() {
        removeEmptyState();
        const div = document.createElement('div');
        div.className = 'os-msg os-msg-ai';
        div.innerHTML = '<div class="os-msg-label">AI</div>'
            + `<div class="os-thinking-toggle">${i18n('thinkingCollapsed')}</div>`
            + '<div class="os-thinking-content"></div>'
            + `<div class="os-msg-bubble"><span class="os-loading-dots">${i18n('loadingDots')}</span></div>`;
        const bubble = div.querySelector('.os-msg-bubble');
        const toggle = div.querySelector('.os-thinking-toggle');
        const thinkingEl = div.querySelector('.os-thinking-content');
        toggle.addEventListener('click', () => {
            const shown = thinkingEl.style.display === 'block';
            thinkingEl.style.display = shown ? 'none' : 'block';
            toggle.textContent = shown ? i18n('thinkingCollapsed') : i18n('thinkingExpanded');
        });
        messagesEl.appendChild(div);
        let lastThinking = '';
        return {
            update(text, thinking) {
                // bubble.innerHTML 赋值会隐含清除 loading dots，无需显式 remove
                if (thinking && thinking !== lastThinking) {
                    lastThinking = thinking;
                    thinkingEl.textContent = thinking;
                    toggle.style.display = 'block';
                }
                bubble.innerHTML = renderMarkdown(text);
                scrollToBottom();
            },
            error(text) {
                bubble.innerHTML = `<span style="color:var(--os-red);">${escapeHtml(text)}</span>`;
            },
        };
    }

    function appendErrorMessage(errorText) {
        removeEmptyState();
        const div = document.createElement('div');
        div.className = 'os-msg os-msg-ai';
        div.innerHTML = `<div class="os-msg-label">${i18n('errorLabel')}</div><div class="os-msg-bubble" style="color:var(--os-red);">${escapeHtml(errorText)}</div>`;
        messagesEl.appendChild(div);
        scrollToBottom();
    }

    // ========== 截图 (chrome.tabs.captureVisibleTab) ==========
    async function captureScreen() {
        if (!chrome.runtime?.id) {
            if (DEBUG) console.error('[OS] Extension context invalidated');
            throw new Error(i18n('errorContextInvalidated'));
        }
        return new Promise((resolve, reject) => {
            // 整体超时：sendMessage + captureVisibleTab + Image 加载
            const totalTimeout = setTimeout(() => {
                reject(new Error(i18n('errorCaptureFailed', 'Capture timeout')));
            }, 20000);
            try {
                chrome.runtime.sendMessage({ type: 'capture' }, (resp) => {
                    if (chrome.runtime.lastError) {
                        clearTimeout(totalTimeout);
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (resp && resp.dataUrl) {
                        const img = new Image();
                        const loadTimeout = setTimeout(() => {
                            clearTimeout(totalTimeout);
                            reject(new Error(i18n('errorCaptureFailed', 'Image load timeout')));
                        }, 15000);
                        img.onload = () => {
                            clearTimeout(totalTimeout);
                            clearTimeout(loadTimeout);
                            const canvas = document.createElement('canvas');
                            canvas.width = img.width;
                            canvas.height = img.height;
                            canvas.getContext('2d').drawImage(img, 0, 0);
                            resolve({
                                canvas,
                                scaleX: img.width / window.innerWidth,
                                scaleY: img.height / window.innerHeight,
                            });
                        };
                        img.onerror = () => {
                            clearTimeout(totalTimeout);
                            clearTimeout(loadTimeout);
                            reject(new Error(i18n('errorCaptureFailed', 'Image decode failed')));
                        };
                        img.src = resp.dataUrl;
                    } else if (resp && resp.error) {
                        clearTimeout(totalTimeout);
                        reject(new Error(resp.error));
                    } else {
                        clearTimeout(totalTimeout);
                        reject(new Error(i18n('errorApiEmpty')));
                    }
                });
            } catch (e) {
                clearTimeout(totalTimeout);
                reject(new Error(i18n('errorContextInvalidated')));
            }
        });
    }

    // ========== API 调用 (Port 连接 → Service Worker 代发，绕过 CORS) ==========
    let activeApiPort = null;
    let apiRequestId = 0;
    let requestCounter = 0; // 用于回调去重，防止过期回调修改共享状态

    function abortActiveRequest() {
        if (activeApiPort) {
            activeApiPort.disconnect();
            activeApiPort = null;
        }
    }

    function callAPI(userContent, onChunk, callback, s) {
        abortActiveRequest();
        const currentId = ++apiRequestId;

        let resolved = false;
        let requestPort = null; // 在 doRequest 中赋值，用于竞态保护
        const resolve = (type, data) => {
            if (resolved) return;
            resolved = true;
            if (activeApiPort === requestPort) activeApiPort = null;
            if (type === 'done') {
                conversation.push(data.userMsg);
                conversation.push({ role: 'assistant', content: data.fullText, thinking: data.thinkingText || undefined });
                // 限制对话长度，保持 system prompt + 最近 N 轮
                if (conversation.length > MAX_CONVERSATION) {
                    conversation = conversation.slice(conversation.length - MAX_CONVERSATION);
                }
                callback(null, data.fullText, data.thinkingText);
            } else {
                callback(new Error(data.error));
            }
        };

        const doRequest = async (settings, retryCount) => {
            // 过期请求：静默丢弃（上层已通过 resetConversation 或新请求清理状态）
            if (currentId !== apiRequestId) return;
            if (!settings.apiUrl || !settings.apiKey || !settings.model) {
                callback(new Error(i18n('errorNoSettings')));
                return;
            }
            const userMsg = { role: 'user', content: userContent };
            const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const systemMsg = {
                role: 'system',
                content: i18n('systemPrompt').replace('__DATE__', dateStr),
            };
            const body = {
                model: settings.model,
                messages: [systemMsg, ...conversation, userMsg],
                max_completion_tokens: settings.maxTokens,
                stream: true,
                thinking: { type: 'enabled' },
            };

            let port;
            try {
                port = chrome.runtime.connect({ name: 'api-stream' });
            } catch (_) {
                callback(new Error(i18n('errorNetworkFailed')));
                return;
            }
            activeApiPort = port;
            requestPort = port;

            let accText = '', accThinking = '', swResponded = false;

            port.onMessage.addListener((msg) => {
                swResponded = true;
                if (msg.type === 'chunk') {
                    if (resolved) return; // done/error 已发送，忽略延迟到达的 chunk
                    if (msg.deltaText) accText += msg.deltaText;
                    if (msg.deltaThinking) accThinking += msg.deltaThinking;
                    onChunk(accText, accThinking);
                } else if (msg.type === 'done') {
                    resolve('done', { fullText: msg.fullText, thinkingText: msg.thinkingText, userMsg });
                } else if (msg.type === 'error') {
                    resolve('error', { error: msg.error });
                }
            });

            port.onDisconnect.addListener(() => {
                if (resolved) return;
                // 短暂延迟：让可能已在队列中的 onMessage 回调先触发
                // 避免 onDisconnect/onMessage 竞态导致无意义重试
                setTimeout(() => {
                    if (resolved) return;
                    if (!swResponded && retryCount < MAX_RETRIES) {
                        if (activeApiPort === port) activeApiPort = null;
                        setTimeout(() => doRequest(settings, retryCount + 1), 300);
                        return;
                    }
                    resolve('error', { error: i18n('errorRequestCancelled') });
                }, 50);
            });

            port.postMessage({
                type: 'api-request',
                apiUrl: settings.apiUrl,
                apiKey: settings.apiKey,
                body,
            });
        };

        if (s) {
            doRequest(s, 0);
        } else {
            getSettings().then(s => doRequest(s, 0));
        }
    }

    // ========== 辅助函数 ==========
    async function getActivePromptText(s) {
        const settings = s || await getSettings();
        return settings.prompts[settings.promptActive - 1] || '';
    }

    // ========== 发送消息 ==========
    let pendingImageData = null;
    let requestPending = false;

    async function sendMessage(promptText) {
        if (requestPending) return;
        requestPending = true;
        sendBtn.disabled = true;
        requestCounter++;
        const myReqId = requestCounter;

        const s = await getSettings();
        if (!s.apiUrl || !s.apiKey || !s.model) {
            appendErrorMessage(i18n('errorNoSettingsSidebar'));
            requestPending = false;
            sendBtn.disabled = false;
            return;
        }
        const activePrompt = await getActivePromptText(s);
        const text = (promptText || inputEl.value.trim() || activePrompt || i18n('defaultPromptText'));
        if (!text && !pendingImageData) {
            requestPending = false;
            sendBtn.disabled = false;
            return;
        }

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

        const streamBubble = createStreamingBubble();
        callAPI(userContent,
            (chunkText, thinking) => { streamBubble.update(chunkText, thinking); },
            (err, reply, thinking) => {
                if (myReqId !== requestCounter) return; // 过期回调，跳过共享状态修改
                sendBtn.disabled = false;
                requestPending = false;
                if (err) streamBubble.error(err.message || String(err));
                else if (reply) streamBubble.update(reply, thinking);
            },
            s
        );
    }

    sendBtn.addEventListener('click', () => { if (!requestPending) sendMessage(); });
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !requestPending) { e.preventDefault(); sendMessage(); }
    });
    inputEl.addEventListener('input', () => {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
        sendBtn.disabled = !inputEl.value.trim();
    });

    // ========== 设置表单 ==========
    settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = document.getElementById('os-api-url').value.trim();
        // 客户端 HTTPS 预检
        if (url) {
            try {
                if (new URL(url).protocol !== 'https:') {
                    setSaveMsg(i18n('errorHttpsRequired'), 3000);
                    return;
                }
            } catch (_) {
                setSaveMsg(i18n('errorInvalidUrl'), 3000);
                return;
            }
        }
        const key = document.getElementById('os-api-key').value.trim();
        const model = document.getElementById('os-model').value.trim();
        const maxTokens = document.getElementById('os-max-tokens').value.trim();
        const { prompts, active } = collectPrompts();
        await storage.set({ apiUrl: url, apiKey: key, model, prompts, promptActive: active, maxTokens });
        setSaveMsg(i18n('settingsSaved'), 2000);
    });

    sidebar.querySelector('.os-clear-key')?.addEventListener('click', async () => {
        document.getElementById('os-api-key').value = '';
        await storage.set({ apiKey: '' });
        setSaveMsg(i18n('apiKeyCleared'), 2000);
    });

    // ========== 选区截图 ==========
    let selStartX = 0, selStartY = 0, selCurX = 0, selCurY = 0, isSelecting = false;
    let screenshotActive = false;
    let captureProcessing = false;
    let savedUserSelect = '';

    function updateOverlay() {
        const x1 = Math.min(selStartX, selCurX), y1 = Math.min(selStartY, selCurY);
        const x2 = Math.max(selStartX, selCurX), y2 = Math.max(selStartY, selCurY);
        oTop.style.cssText = `top:0;left:0;width:100%;height:${y1}px;`;
        oBottom.style.cssText = `top:${y2}px;left:0;width:100%;height:${Math.max(0, window.innerHeight - y2)}px;`;
        const h = Math.max(0, y2 - y1);
        oLeft.style.cssText = `top:${y1}px;left:0;width:${Math.max(0, x1)}px;height:${h}px;`;
        oRight.style.cssText = `top:${y1}px;left:${x2}px;width:${Math.max(0, window.innerWidth - x2)}px;height:${h}px;`;
        selBorder.style.cssText = `left:${x1}px;top:${y1}px;width:${x2 - x1}px;height:${y2 - y1}px;display:block;`;
    }

    function startScreenshot() {
        // 防止重复调用导致事件监听器泄漏；截图处理中也不允许新截图
        if (screenshotActive || captureProcessing) return;
        screenshotActive = true;

        // 保存原始 userSelect 状态以便恢复
        savedUserSelect = document.body.style.userSelect;
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
        function cancelScreenshot() {
            cleanup();
            if (wasVisible) sidebar.style.visibility = '';
            toggleBtn.style.display = '';
            overlay.classList.remove('os-active');
            document.body.style.userSelect = savedUserSelect;
            screenshotActive = false;
        }
        function onMouseUp(e) {
            if (!isSelecting) return;
            isSelecting = false;
            const x1 = Math.min(selStartX, selCurX), y1 = Math.min(selStartY, selCurY);
            const x2 = Math.max(selStartX, selCurX), y2 = Math.max(selStartY, selCurY);
            const w = x2 - x1, h = y2 - y1;
            if (w < 10 || h < 10) {
                cancelScreenshot();
                return;
            }
            cleanup();
            if (wasVisible) sidebar.style.visibility = '';
            toggleBtn.style.display = '';
            captureAndProceed(x1, y1, w, h, window.innerWidth, window.innerHeight);
        }
        function onKeyDown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                cancelScreenshot();
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

    async function captureAndProceed(vpX, vpY, vpW, vpH, selVpW, selVpH) {
        screenshotActive = false;
        captureProcessing = true;
        overlay.classList.remove('os-active');
        document.body.style.userSelect = savedUserSelect;

        // 检查选区后窗口尺寸是否变化（防止 TOCTOU 截图偏移）
        if (Math.abs(window.innerWidth - selVpW) > 50 || Math.abs(window.innerHeight - selVpH) > 50) {
            appendErrorMessage(i18n('errorCaptureFailed', 'Viewport resized during capture'));
            captureProcessing = false;
            return;
        }

        removeEmptyState();
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'os-loading';
        loadingDiv.id = 'os-capture-loading';
        loadingDiv.innerHTML = `<span>${i18n('captureLoading')}</span>`;
        messagesEl.appendChild(loadingDiv);

        try {
            const { canvas: fullCanvas, scaleX, scaleY } = await captureScreen();
            const sx = vpX * scaleX;
            const sy = vpY * scaleY;
            const sw = vpW * scaleX;
            const sh = vpH * scaleY;

            let finalCanvas = document.createElement('canvas');
            const resize = Math.min(1, MAX_IMAGE_DIM / sw, MAX_IMAGE_DIM / sh);
            finalCanvas.width = Math.round(sw * resize);
            finalCanvas.height = Math.round(sh * resize);
            const ctx = finalCanvas.getContext('2d');
            ctx.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, finalCanvas.width, finalCanvas.height);
            const base64 = finalCanvas.toDataURL('image/jpeg', 0.85);

            showSidebar();
            switchTab('chat');
            conversation = [];
            pendingImageData = base64;
            const activePrompt = (await getActivePromptText()) || i18n('defaultPromptText');
            // await 等待消息发送完成，确保 loading 指示器正确清除
            await sendMessage(activePrompt);
        } catch (err) {
            appendErrorMessage(i18n('errorCaptureFailed', err.message || String(err)));
        } finally {
            captureProcessing = false;
            const capLoading = document.getElementById('os-capture-loading');
            if (capLoading) capLoading.remove();
        }
    }

    // ========== 快捷键 ==========
    document.addEventListener('keydown', (e) => {
        // 输入框中不拦截快捷键，避免影响正常输入
        const tag = e.target.tagName.toUpperCase(); // SVG 元素 tagName 可能为小写
        const editable = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
        if (e.altKey && (e.key === 'x' || e.key === 'X')) {
            if (!editable) { e.preventDefault(); e.stopPropagation(); toggleSidebar(); }
            return;
        }
        if (e.altKey && (e.key === 'c' || e.key === 'C')) {
            if (!editable) { e.preventDefault(); e.stopPropagation(); resetConversation(); }
            return;
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
        if (DEBUG) {
            console.log(i18n('consoleReady'));
            console.log(i18n('consoleHelpZ'));
            console.log(i18n('consoleHelpX'));
            console.log(i18n('consoleHelpC'));
        }
    }

    init();
})();
