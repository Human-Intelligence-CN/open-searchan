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

    port.onMessage.addListener(async (msg) => {
        if (msg.type !== 'api-request') return;

        // 强制 HTTPS：拒绝非加密请求，防止 API Key 明文泄露
        try {
            const u = new URL(msg.apiUrl);
            if (u.protocol !== 'https:') {
                port.postMessage({ type: 'error', error: chrome.i18n.getMessage('errorHttpsRequired') });
                return;
            }
        } catch (_) {
            port.postMessage({ type: 'error', error: chrome.i18n.getMessage('errorInvalidUrl') });
            return;
        }

        // 每个请求使用独立的 AbortController，防止并发覆盖
        const abortController = new AbortController();
        let timeoutId = setTimeout(() => abortController.abort(), 180000);

        // disconnect 时仅取消当前请求
        const onDisconnect = () => {
            clearTimeout(timeoutId);
            abortController.abort();
        };
        port.onDisconnect.addListener(onDisconnect);

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

            // fetch 完成后切换为流式读取超时（5 分钟），防止服务器挂起
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => abortController.abort(), 300000);

            if (!response.ok) {
                let err = `HTTP ${response.status}`;
                try {
                    const data = await response.json();
                    err = data.error?.message || err;
                } catch (_) {}
                // 不在错误消息中暴露完整 API URL
                clearTimeout(timeoutId);
                port.postMessage({ type: 'error', error: err });
                port.onDisconnect.removeListener(onDisconnect);
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '', thinkingText = '', buffer = '';
            let fullSent = 0, thinkingSent = 0;
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
                // 仅发送增量，避免每次 chunk 都发送累积全文
                if (fullText.length > fullSent || thinkingText.length > thinkingSent) {
                    port.postMessage({
                        type: 'chunk',
                        deltaText: fullText.slice(fullSent),
                        deltaThinking: thinkingText.slice(thinkingSent),
                    });
                    fullSent = fullText.length;
                    thinkingSent = thinkingText.length;
                }
            }

            // 处理尾部残留行（stream: false 刷新解码器内部缓存）
            buffer += decoder.decode();
            if (buffer.startsWith('data: ') && buffer !== 'data: [DONE]') {
                const delta = extractDelta(buffer);
                if (delta?.reasoning_content) thinkingText += delta.reasoning_content;
                if (delta?.content) fullText += delta.content;
            }

            if (fullText || thinkingText) {
                port.postMessage({ type: 'done', fullText, thinkingText: thinkingText || undefined });
            } else {
                // 非流式兼容：使用独立 TextDecoder 避免流式解码器状态污染
                try {
                    const all = rawChunks.length > 0
                        ? new TextDecoder().decode(concatChunks(rawChunks))
                        : '';
                    const data = JSON.parse(all);
                    const replyMsg = data.choices?.[0]?.message;
                    const reply = replyMsg?.content;
                    if (reply) {
                        port.postMessage({ type: 'done', fullText: reply, thinkingText: replyMsg?.reasoning_content });
                    } else {
                        port.postMessage({ type: 'error', error: chrome.i18n.getMessage('errorApiEmpty') });
                    }
                } catch (e) {
                    // 区分 concatChunks 超限错误和 JSON 解析错误
                    const msg = e instanceof Error && e.message
                        ? e.message
                        : chrome.i18n.getMessage('errorApiEmpty');
                    port.postMessage({ type: 'error', error: msg });
                }
            }
        } catch (e) {
            clearTimeout(timeoutId);
            if (e.name === 'AbortError') return; // 被取消，静默
            port.postMessage({
                type: 'error',
                error: chrome.i18n.getMessage('errorNetworkFailed'),
            });
        } finally {
            clearTimeout(timeoutId);
            port.onDisconnect.removeListener(onDisconnect);
        }
    });
});

function extractDelta(line) {
    try { return JSON.parse(line.slice(6)).choices?.[0]?.delta; } catch (_) { return null; }
}

function concatChunks(chunks) {
    const total = chunks.reduce((a, c) => a + c.length, 0);
    // 安全上限：防止超大响应导致内存溢出
    if (total > 10 * 1024 * 1024) {
        throw new Error('Response exceeds 10MB size limit');
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { result.set(c, offset); offset += c.length; }
    return result;
}
