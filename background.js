// Alt+Z 命令 → 通知 content script 启动截图
chrome.commands.onCommand.addListener((cmd, tab) => {
    if (cmd === 'screenshot') {
        chrome.tabs.sendMessage(tab.id, { type: 'start_screenshot' }).catch(() => {});
    }
});

// 截图请求：调用 captureVisibleTab 静默截屏
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'capture') return;
    if (!sender.tab?.windowId) {
        sendResponse({ error: chrome.i18n.getMessage('errorNoTabInfo') });
        return;
    }
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
        } else {
            sendResponse({ dataUrl });
        }
    });
    return true;
});

// API 流式代理：content script 通过 Port 连接，SW 代发 fetch 绕过 CORS
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'api-stream') return;

    let abortController = null;

    port.onMessage.addListener(async (msg) => {
        if (msg.type !== 'api-request') return;

        abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 120000);

        try {
            const response = await fetch(msg.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': msg.apiKey,
                },
                body: JSON.stringify(msg.body),
                signal: abortController.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                let err = `HTTP ${response.status}`;
                try {
                    const data = await response.json();
                    err = data.error?.message || err;
                } catch (_) {}
                port.postMessage({ type: 'error', error: err + '\n\n' + msg.apiUrl });
                return;
            }

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
                    const delta = extractDelta(line);
                    if (delta?.reasoning_content) thinkingText += delta.reasoning_content;
                    if (delta?.content) fullText += delta.content;
                }
                port.postMessage({ type: 'chunk', fullText, thinkingText });
            }

            // 处理尾部残留行
            buffer += decoder.decode();
            if (buffer.startsWith('data: ') && buffer !== 'data: [DONE]') {
                const delta = extractDelta(buffer);
                if (delta?.reasoning_content) thinkingText += delta.reasoning_content;
                if (delta?.content) fullText += delta.content;
            }

            if (fullText) {
                port.postMessage({ type: 'done', fullText, thinkingText: thinkingText || undefined });
            } else {
                // 非流式兼容：尝试解析完整 JSON
                try {
                    const all = rawChunks.length > 0
                        ? decoder.decode(concatChunks(rawChunks))
                        : '';
                    const data = JSON.parse(all);
                    const replyMsg = data.choices?.[0]?.message;
                    const reply = replyMsg?.content;
                    if (reply) {
                        port.postMessage({ type: 'done', fullText: reply, thinkingText: replyMsg?.reasoning_content });
                    } else {
                        port.postMessage({ type: 'error', error: chrome.i18n.getMessage('errorApiEmpty') });
                    }
                } catch (_) {
                    port.postMessage({ type: 'error', error: chrome.i18n.getMessage('errorApiEmpty') });
                }
            }
        } catch (e) {
            clearTimeout(timeoutId);
            if (e.name === 'AbortError') return; // 被取消，静默
            port.postMessage({
                type: 'error',
                error: chrome.i18n.getMessage('errorNetworkFailed', msg.apiUrl),
            });
        }
    });

    port.onDisconnect.addListener(() => {
        if (abortController) abortController.abort();
    });
});

function extractDelta(line) {
    try { return JSON.parse(line.slice(6)).choices?.[0]?.delta; } catch (_) { return null; }
}

function concatChunks(chunks) {
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { result.set(c, offset); offset += c.length; }
    return result;
}
