// 处理截图请求：content script 无法直接调用 captureVisibleTab，
// 通过消息转发给 background 执行
// 处理 Alt+Z 命令 → 激活 activeTab → 通知 content script
chrome.commands.onCommand.addListener((cmd, tab) => {
    if (cmd === 'screenshot') {
        chrome.tabs.sendMessage(tab.id, { type: 'start_screenshot' }).catch(() => {});
    }
});

// 处理截图请求：用 captureVisibleTab 静默截屏
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
