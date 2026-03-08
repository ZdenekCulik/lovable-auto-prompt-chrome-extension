// Background service worker — manages badge per-tab and relays messages

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "STATUS_UPDATE" && sender.tab?.id) {
    const tabId = sender.tab.id;
    const count = msg.messagesSent || 0;

    if (msg.status === "paused") {
      // OFF — no badge
      chrome.action.setBadgeText({ text: "", tabId });
    } else {
      // ON — always show green badge with count (or "ON" if 0)
      const text = count > 0 ? String(count) : "ON";
      const color =
        msg.status === "sending" ? "#FF9800" : "#4CAF50"; // orange while sending, green otherwise
      chrome.action.setBadgeText({ text, tabId });
      chrome.action.setBadgeBackgroundColor({ color, tabId });
    }
  }
});
