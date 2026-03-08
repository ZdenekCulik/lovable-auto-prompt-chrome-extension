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

// Tab switching
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    builderArea.style.display = target === "builder" ? "" : "none";
    criticArea.style.display = target === "critic" ? "" : "none";
  });
});

// Load global settings (prompts, delay, challenge) from storage
// Per-project state (enabled, counters) comes from the content script
chrome.storage.local.get(
  ["builderPrompt", "criticPrompt", "challengeEnabled", "delay"],
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

    // Get per-project state from the active tab's content script
    refreshStatus();
  }
);

// Toggle
enableToggle.addEventListener("change", () => {
  const enabled = enableToggle.checked;
  toggleLabel.textContent = enabled ? "ON" : "OFF";
  sendToContentScript({ type: "TOGGLE", enabled });
  updateStatusUI(enabled ? "waiting" : "paused");
});

// Delay slider
delaySlider.addEventListener("input", () => {
  delayValue.textContent = `${delaySlider.value}s`;
});
delaySlider.addEventListener("change", () => {
  sendToContentScript({
    type: "UPDATE_SETTINGS",
    delay: parseInt(delaySlider.value),
  });
});

// Challenge toggle
challengeToggle.addEventListener("change", () => {
  sendToContentScript({
    type: "UPDATE_SETTINGS",
    challengeEnabled: challengeToggle.checked,
  });
});

// Save prompts
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

// Send now
sendNowBtn.addEventListener("click", () => {
  sendToContentScript({ type: "SEND_NOW" });
});

// Reset
resetBtn.addEventListener("click", () => {
  sendToContentScript({ type: "RESET_COUNT" });
  messagesSent.textContent = "0";
  loopNumber.textContent = "1";
  nextRole.textContent = "B";
  nextRole.style.color = "#30d030";
});

// Status updates from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "STATUS_UPDATE") {
    updateStatusUI(msg.status);
    messagesSent.textContent = msg.messagesSent || 0;
    if (msg.role) {
      nextRole.textContent = msg.role === "builder" ? "B" : "C";
      nextRole.style.color = msg.role === "builder" ? "#30d030" : "#ff6b6b";
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

    if (response.role) {
      nextRole.textContent = response.role === "builder" ? "B" : "C";
      nextRole.style.color =
        response.role === "builder" ? "#30d030" : "#ff6b6b";
    }
    if (response.loopNumber) {
      loopNumber.textContent = response.loopNumber;
    }
  });
}

function sendToContentScript(message, callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
        if (callback) callback(response);
      });
    }
  });
}
