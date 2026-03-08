const $ = (sel) => document.querySelector(sel);

const enableToggle = $("#enableToggle");
const toggleLabel = $("#toggleLabel");
const statusDot = $("#statusDot");
const statusText = $("#statusText");
const messagesSent = $("#messagesSent");
const loopNumber = $("#loopNumber");
const nextRole = $("#nextRole");
const delaySlider = $("#delaySlider");
const delayValue = $("#delayValue");
const challengeToggle = $("#challengeToggle");
const sendNowBtn = $("#sendNowBtn");
const resetBtn = $("#resetBtn");
const agentRoster = $("#agentRoster");
const roundNumber = $("#roundNumber");

let rosterOrder = []; // current roster IDs in order
let activeTabId = null; // track which tab the popup is talking to

// ── Agent Roster Rendering ──

function renderRoster(activeIds) {
  if (typeof LOVABLE_AGENTS === "undefined") {
    agentRoster.innerHTML = '<div class="roster-info">Agent data not available.</div>';
    return;
  }

  const allAgents = LOVABLE_AGENTS.roster;
  const defaultIds = LOVABLE_AGENTS.defaultRosterOrder;
  const orderedIds = activeIds || defaultIds;

  // Build ordered list: active agents first in order, then inactive ones
  const orderedAgents = [];
  for (const id of orderedIds) {
    const agent = allAgents.find((a) => a.id === id);
    if (agent) orderedAgents.push({ ...agent, active: true });
  }
  for (const agent of allAgents) {
    if (!orderedIds.includes(agent.id)) {
      orderedAgents.push({ ...agent, active: false });
    }
  }

  rosterOrder = orderedAgents.filter((a) => a.active).map((a) => a.id);

  agentRoster.innerHTML = orderedAgents
    .map(
      (agent) => `
    <div class="agent-card ${agent.active ? "active" : ""}" data-id="${agent.id}">
      <input type="checkbox" class="agent-check" data-id="${agent.id}" ${agent.active ? "checked" : ""}>
      <span class="agent-dot" style="background:${agent.color}"></span>
      <span class="agent-name">${agent.name}</span>
      <span class="agent-short">${agent.shortName}</span>
      <span class="agent-reorder">
        <button class="reorder-btn" data-dir="up" data-id="${agent.id}" title="Move up">&uarr;</button>
        <button class="reorder-btn" data-dir="down" data-id="${agent.id}" title="Move down">&darr;</button>
      </span>
    </div>`
    )
    .join("");

  // Checkbox handlers
  agentRoster.querySelectorAll(".agent-check").forEach((cb) => {
    cb.addEventListener("change", () => {
      updateRosterFromUI();
    });
  });

  // Reorder handlers
  agentRoster.querySelectorAll(".reorder-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const id = btn.dataset.id;
      const dir = btn.dataset.dir;
      reorderAgent(id, dir);
    });
  });
}

function updateRosterFromUI() {
  const cards = agentRoster.querySelectorAll(".agent-card");
  const newIds = [];
  cards.forEach((card) => {
    const cb = card.querySelector(".agent-check");
    if (cb && cb.checked) {
      newIds.push(card.dataset.id);
    }
  });

  if (newIds.length === 0) return; // prevent empty roster

  rosterOrder = newIds;
  sendToContentScript({ type: "UPDATE_ROSTER", rosterIds: newIds });
  chrome.storage.local.set({ activeRosterIds: JSON.stringify(newIds) });
}

function reorderAgent(id, dir) {
  const idx = rosterOrder.indexOf(id);
  if (idx === -1) return;

  if (dir === "up" && idx > 0) {
    [rosterOrder[idx - 1], rosterOrder[idx]] = [rosterOrder[idx], rosterOrder[idx - 1]];
  } else if (dir === "down" && idx < rosterOrder.length - 1) {
    [rosterOrder[idx], rosterOrder[idx + 1]] = [rosterOrder[idx + 1], rosterOrder[idx]];
  } else {
    return;
  }

  renderRoster(rosterOrder);
  sendToContentScript({ type: "UPDATE_ROSTER", rosterIds: rosterOrder });
  chrome.storage.local.set({ activeRosterIds: JSON.stringify(rosterOrder) });
}

// ── Load settings from storage ──

chrome.storage.local.get(
  ["challengeEnabled", "delay", "activeRosterIds"],
  (data) => {
    challengeToggle.checked =
      typeof data.challengeEnabled === "boolean"
        ? data.challengeEnabled
        : true;

    delaySlider.value = data.delay || 5;
    delayValue.textContent = `${delaySlider.value}s`;

    // Parse and render roster
    let activeIds = null;
    if (typeof data.activeRosterIds === "string") {
      try { activeIds = JSON.parse(data.activeRosterIds); } catch (e) { /* ignore */ }
    }
    renderRoster(activeIds);

    // Get per-project state from the active tab's content script
    refreshStatus();
  }
);

// ── Toggle ──

enableToggle.addEventListener("change", () => {
  const enabled = enableToggle.checked;
  toggleLabel.textContent = enabled ? "ON" : "OFF";
  sendToContentScript({ type: "TOGGLE", enabled });
  updateStatusUI(enabled ? "waiting" : "paused");
});

// ── Delay slider ──

delaySlider.addEventListener("input", () => {
  delayValue.textContent = `${delaySlider.value}s`;
});
delaySlider.addEventListener("change", () => {
  sendToContentScript({
    type: "UPDATE_SETTINGS",
    delay: parseInt(delaySlider.value),
  });
});

// ── Challenge toggle ──

challengeToggle.addEventListener("change", () => {
  sendToContentScript({
    type: "UPDATE_SETTINGS",
    challengeEnabled: challengeToggle.checked,
  });
});

// ── Send now ──

sendNowBtn.addEventListener("click", () => {
  sendToContentScript({ type: "SEND_NOW" });
});

// ── Reset ──

resetBtn.addEventListener("click", () => {
  sendToContentScript({ type: "RESET_COUNT" });
  messagesSent.textContent = "0";
  loopNumber.textContent = "1";
  roundNumber.textContent = "1";
  const info = getFirstAgentDisplay();
  nextRole.textContent = info.shortName;
  nextRole.style.color = info.color;
});

function getFirstAgentDisplay() {
  if (typeof LOVABLE_AGENTS !== "undefined" && rosterOrder.length > 0) {
    const agent = LOVABLE_AGENTS.roster.find((a) => a.id === rosterOrder[0]);
    if (agent) return { shortName: agent.shortName, color: agent.color };
  }
  return { shortName: "UI", color: "#6c5ce7" };
}

// ── Status updates from content script ──

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "STATUS_UPDATE") {
    // Only accept updates from the tab this popup is talking to
    if (activeTabId && sender.tab?.id !== activeTabId) return;
    updateStatusUI(msg.status);
    messagesSent.textContent = msg.messagesSent || 0;

    if (msg.agentShortName) {
      nextRole.textContent = msg.agentShortName;
      nextRole.style.color = msg.agentColor || "#6c5ce7";
    }

    if (msg.roundNumber) {
      roundNumber.textContent = msg.roundNumber;
    }

    loopNumber.textContent = (msg.messagesSent || 0) + 1;
  }
});

function updateStatusUI(status) {
  statusDot.className = `status-dot ${status}`;
  const labels = {
    idle: "Idle",
    waiting: "Waiting for AI...",
    sending: "Sending...",
    paused: "Paused",
  };
  statusText.textContent = labels[status] || status;
}

function refreshStatus() {
  sendToContentScript({ type: "GET_STATUS" }, (response) => {
    if (!response) {
      updateStatusUI("paused");
      enableToggle.checked = false;
      toggleLabel.textContent = "OFF";
      return;
    }

    messagesSent.textContent = response.messagesSent || 0;
    updateStatusUI(response.status || "paused");
    enableToggle.checked = response.enabled || false;
    toggleLabel.textContent = response.enabled ? "ON" : "OFF";

    if (response.agentShortName) {
      nextRole.textContent = response.agentShortName;
      nextRole.style.color = response.agentColor || "#6c5ce7";
    }

    if (response.roundNumber) {
      roundNumber.textContent = response.roundNumber;
    }

    loopNumber.textContent = (response.messagesSent || 0) + 1;
  });
}

function sendToContentScript(message, callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      activeTabId = tabs[0].id;
      chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
        if (callback) callback(response);
      });
    }
  });
}
