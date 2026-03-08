const DEFAULT_BUILDER_PROMPT = `You are the Builder AI responsible for evolving this project.
Your goal is to improve the product through iterative experimentation.
Aim for a premium SaaS quality level similar to products like Linear, Vercel, or Stripe.

You may improve: UI design, UX flows, interaction design, performance, architecture, useful features.

GUIDELINES
- You are encouraged to explore new ideas.
- Improvements may be incremental or bold.
- Avoid unnecessary full rewrites.
- Keep the application functional.
- Focus on changes that meaningfully improve the product.

PROCESS
1. ANALYZE the current project state and identify promising opportunities.
2. SELECT A DIRECTION — redesign a component, simplify a user flow, improve responsiveness, improve performance, introduce a helpful feature, or simplify architecture.
3. IMPLEMENT the improvement in the code.
4. STABILIZE — ensure the application still runs correctly and fix issues introduced.
5. REPORT — briefly explain what was changed, why it improves the product, and potential next directions.

LIMITS
- Do not modify more than ~30% of the codebase in one iteration.
- Avoid introducing large new dependencies.
- Preserve core functionality.`;

const DEFAULT_CRITIC_PROMPT = `You are the Critic AI reviewing the current state of this project.
Your role is to evaluate the quality of the product and guide further improvements.

Analyze the project from these perspectives: UI design quality, UX clarity, performance, architecture, code maintainability, accessibility, responsiveness.

TASKS
1. Identify the 5 most important problems or weaknesses in the current implementation.
2. Suggest concrete improvements that would meaningfully improve the product.
3. Identify regressions, unnecessary complexity, design inconsistencies, and performance issues.
4. Propose the 3 most impactful directions the Builder AI should explore next.

Be honest and critical. The goal is to improve the project quality.
You decide what will be the best approach — implement the most impactful fix or improvement you identified.`;

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
const builderArea = $("#builderArea");
const criticArea = $("#criticArea");
const challengeToggle = $("#challengeToggle");
const saveBtn = $("#saveBtn");
const sendNowBtn = $("#sendNowBtn");
const resetBtn = $("#resetBtn");
const classicPanel = $("#classicPanel");
const multiAgentPanel = $("#multiAgentPanel");
const agentRoster = $("#agentRoster");
const roundStat = $("#roundStat");
const roundNumber = $("#roundNumber");

let currentMode = "classic"; // "classic" or "multi-agent"
let rosterOrder = []; // current roster IDs in order
let activeTabId = null; // track which tab the popup is talking to

// ── Tab switching (classic mode Builder/Critic) ──

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    builderArea.style.display = target === "builder" ? "" : "none";
    criticArea.style.display = target === "critic" ? "" : "none";
  });
});

// ── Mode switching ──

document.querySelectorAll(".mode-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".mode-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const mode = tab.dataset.mode;
    setMode(mode);
  });
});

function setMode(mode) {
  currentMode = mode;
  const isMultiAgent = mode === "multi-agent";

  classicPanel.style.display = isMultiAgent ? "none" : "";
  multiAgentPanel.style.display = isMultiAgent ? "" : "none";
  roundStat.style.display = isMultiAgent ? "" : "none";
  saveBtn.style.display = isMultiAgent ? "none" : "";

  // Update challenge label text
  const challengeLabel = document.querySelector(".challenge-label");
  if (challengeLabel) {
    challengeLabel.textContent = isMultiAgent
      ? "Inject challenge every 3 rounds"
      : "Inject challenge every 5 loops";
  }

  // Notify content script
  sendToContentScript({ type: "UPDATE_MODE", multiAgentEnabled: isMultiAgent });

  // Persist mode
  chrome.storage.local.set({ multiAgentEnabled: isMultiAgent });
}

// ── Agent Roster Rendering ──

function renderRoster(activeIds) {
  if (typeof LOVABLE_AGENTS === "undefined") {
    agentRoster.innerHTML = '<div class="roster-info">Agent data not available.</div>';
    return;
  }

  // Use activeIds to determine order and which are checked
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
      (agent, idx) => `
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
  ["builderPrompt", "criticPrompt", "challengeEnabled", "delay", "multiAgentEnabled", "activeRosterIds"],
  (data) => {
    builderArea.value =
      typeof data.builderPrompt === "string"
        ? data.builderPrompt
        : DEFAULT_BUILDER_PROMPT;
    criticArea.value =
      typeof data.criticPrompt === "string"
        ? data.criticPrompt
        : DEFAULT_CRITIC_PROMPT;

    challengeToggle.checked =
      typeof data.challengeEnabled === "boolean"
        ? data.challengeEnabled
        : true;

    delaySlider.value = data.delay || 5;
    delayValue.textContent = `${delaySlider.value}s`;

    // Multi-agent mode
    const isMultiAgent = data.multiAgentEnabled === true;
    currentMode = isMultiAgent ? "multi-agent" : "classic";

    // Set active mode tab
    document.querySelectorAll(".mode-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.mode === currentMode);
    });

    classicPanel.style.display = isMultiAgent ? "none" : "";
    multiAgentPanel.style.display = isMultiAgent ? "" : "none";
    roundStat.style.display = isMultiAgent ? "" : "none";
    saveBtn.style.display = isMultiAgent ? "none" : "";

    // Update challenge label
    const challengeLabel = document.querySelector(".challenge-label");
    if (challengeLabel) {
      challengeLabel.textContent = isMultiAgent
        ? "Inject challenge every 3 rounds"
        : "Inject challenge every 5 loops";
    }

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

// ── Save prompts (classic mode) ──

saveBtn.addEventListener("click", () => {
  const builder = builderArea.value.trim() || DEFAULT_BUILDER_PROMPT;
  const critic = criticArea.value.trim() || DEFAULT_CRITIC_PROMPT;

  builderArea.value = builder;
  criticArea.value = critic;

  sendToContentScript({
    type: "UPDATE_SETTINGS",
    builderPrompt: builder,
    criticPrompt: critic,
    challengeEnabled: challengeToggle.checked,
  });
  saveBtn.textContent = "Saved!";
  setTimeout(() => (saveBtn.textContent = "Save Prompts"), 1500);
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
  if (currentMode === "multi-agent") {
    const info = getFirstAgentDisplay();
    nextRole.textContent = info.shortName;
    nextRole.style.color = info.color;
  } else {
    nextRole.textContent = "B";
    nextRole.style.color = "#30d030";
  }
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

    if (msg.agentMode === "multi-agent") {
      // Multi-agent mode display
      if (msg.isAgentTurn && msg.agentShortName) {
        nextRole.textContent = msg.agentShortName;
        nextRole.style.color = msg.agentColor || "#6c5ce7";
      } else {
        nextRole.textContent = "C";
        nextRole.style.color = "#ff6b6b";
      }
      if (msg.roundNumber) {
        roundNumber.textContent = msg.roundNumber;
      }
    } else {
      // Classic mode display
      if (msg.role) {
        nextRole.textContent = msg.role === "builder" ? "B" : "C";
        nextRole.style.color = msg.role === "builder" ? "#30d030" : "#ff6b6b";
      }
    }

    if (msg.loopNumber) {
      loopNumber.textContent = msg.loopNumber;
    }
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
      // Not on a Lovable page
      updateStatusUI("paused");
      enableToggle.checked = false;
      toggleLabel.textContent = "OFF";
      return;
    }

    messagesSent.textContent = response.messagesSent || 0;
    updateStatusUI(response.status || "paused");
    enableToggle.checked = response.enabled || false;
    toggleLabel.textContent = response.enabled ? "ON" : "OFF";

    if (response.agentMode === "multi-agent") {
      if (response.isAgentTurn && response.agentShortName) {
        nextRole.textContent = response.agentShortName;
        nextRole.style.color = response.agentColor || "#6c5ce7";
      } else {
        nextRole.textContent = "C";
        nextRole.style.color = "#ff6b6b";
      }
      if (response.roundNumber) {
        roundNumber.textContent = response.roundNumber;
      }
    } else {
      if (response.role) {
        nextRole.textContent = response.role === "builder" ? "B" : "C";
        nextRole.style.color =
          response.role === "builder" ? "#30d030" : "#ff6b6b";
      }
    }

    if (response.loopNumber) {
      loopNumber.textContent = response.loopNumber;
    }
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
