// Lovable Auto-Prompter Content Script — Builder/Critic Loop
(function () {
  "use strict";

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

  const CHALLENGE_PROMPT = `\n\nADDITIONAL CHALLENGE: Challenge the current product concept. If a fundamentally better product structure exists, propose it and explain why. Think beyond incremental improvements.`;

  const DEFAULT_DELAY = 5;
  const MIN_AI_WORK_TIME = 10000;
  const CHALLENGE_EVERY_N_LOOPS = 5; // inject challenge every 5 full loops (classic) or 3 rounds (multi-agent)
  const CHALLENGE_EVERY_N_ROUNDS = 3; // for multi-agent mode

  const SEND_ARROW_PREFIX = "M11 19V7";

  let state = {
    enabled: false,
    builderPrompt: DEFAULT_BUILDER_PROMPT,
    criticPrompt: DEFAULT_CRITIC_PROMPT,
    challengeEnabled: true,
    delay: DEFAULT_DELAY,
    messageIndex: 0,
    messagesSent: 0,
    status: "idle",
    // Multi-agent mode
    multiAgentEnabled: false,
    activeRoster: [],         // resolved agent objects
    activeRosterIds: null,    // null = use default order
  };

  // Resolve roster from LOVABLE_AGENTS global using ID list
  function resolveRoster(ids) {
    const rosterIds = ids || (typeof LOVABLE_AGENTS !== "undefined" ? LOVABLE_AGENTS.defaultRosterOrder : []);
    const roster = [];
    if (typeof LOVABLE_AGENTS === "undefined") return roster;
    for (const id of rosterIds) {
      const agent = LOVABLE_AGENTS.roster.find((a) => a.id === id);
      if (agent) roster.push(agent);
    }
    return roster;
  }

  // Get current agent info for multi-agent mode
  function getAgentInfo() {
    if (!state.multiAgentEnabled || state.activeRoster.length === 0) return null;
    const roster = state.activeRoster;
    const rosterSize = roster.length;
    const messagesPerRound = rosterSize * 2;
    const positionInRound = state.messageIndex % messagesPerRound;
    const agentSlotIndex = Math.floor(positionInRound / 2);
    const isAgentTurn = positionInRound % 2 === 0;
    const roundNumber = Math.floor(state.messageIndex / messagesPerRound) + 1;
    const loopNumber = Math.floor(state.messageIndex / 2) + 1;
    const agent = roster[agentSlotIndex];
    return { agent, agentSlotIndex, isAgentTurn, roundNumber, loopNumber, rosterSize };
  }

  // Extract project ID from URL for per-project state
  function getProjectId() {
    const match = window.location.pathname.match(/\/projects\/([a-f0-9-]+)/);
    return match ? match[1] : "default";
  }

  const PROJECT_ID = getProjectId();
  const KEY_PREFIX = `project_${PROJECT_ID}_`;

  let observer = null;
  let pollInterval = null;
  let pendingTimeout = null;
  let lastSendTime = 0;
  let buttonWasStop = false;
  let lastStopSeenTime = 0;
  let sendingStartTime = 0;
  const STUCK_FALLBACK_TIME = 15000;
  const SENDING_STUCK_TIME = 10000;

  // ── Lovable-specific selectors ──

  function findChatInput() {
    return (
      document.querySelector('#chat-input .ProseMirror') ||
      document.querySelector('#chat-input [contenteditable="true"]') ||
      document.querySelector("textarea#chatinput") ||
      document.querySelector("#chat-input textarea") ||
      document.querySelector('[placeholder="Ask Lovable..."]')
    );
  }

  function getActionButton() {
    const form = document.querySelector("#chat-input");
    if (!form) return null;
    const buttons = form.querySelectorAll("button");
    if (buttons.length === 0) return null;
    return buttons[buttons.length - 1];
  }

  function getButtonState() {
    const btn = getActionButton();
    if (!btn) return "unknown";

    // Check SVG path for send arrow
    const path = btn.querySelector("svg path")?.getAttribute("d") || "";
    if (path.startsWith(SEND_ARROW_PREFIX)) return "send";

    // Detect stop button: look for square/rect SVG elements or non-send-arrow paths
    // Lovable uses various SVG shapes for stop — check for <rect>, <square>, or any
    // non-empty path that isn't the send arrow (means AI is working)
    const svg = btn.querySelector("svg");
    if (svg) {
      const hasRect = svg.querySelector("rect");
      const hasSquare = svg.querySelector("path[d]");
      if (hasRect) return "stop";
      // If there's a path but it's NOT the send arrow, treat as stop
      if (hasSquare && path && !path.startsWith(SEND_ARROW_PREFIX)) return "stop";
    }

    // Disabled button with no recognizable icon = likely send state (waiting for input)
    if (btn.disabled) return "send";
    return "unknown";
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isAIWorking() {
    if (getButtonState() === "stop") return true;
    const indicators = document.querySelectorAll(
      ".animate-spin, [class*='spinner' i]"
    );
    for (const el of indicators) {
      if (isVisible(el)) {
        const rect = el.getBoundingClientRect();
        if (rect.y > 100) return true;
      }
    }
    return false;
  }

  // ── Set chat input value (supports TipTap/ProseMirror + textarea) ──

  function setChatInputValue(element, text) {
    element.focus();

    if (element.contentEditable === "true") {
      // TipTap/ProseMirror: use execCommand which TipTap properly intercepts
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("delete", false);
      document.execCommand("insertText", false, text);
      log(`ProseMirror value set via execCommand (${text.length} chars)`);
      return true;
    }

    if (element.tagName === "TEXTAREA") {
      // Textarea fallback with native setter
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      ).set;
      nativeSetter.call(element, text);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      log(`Textarea value set (${text.length} chars)`);
      return true;
    }

    log(`Unknown input type: ${element.tagName}`);
    return false;
  }

  // ── Builder/Critic message selection ──

  function getNextMessage() {
    // === MULTI-AGENT MODE ===
    if (state.multiAgentEnabled && state.activeRoster.length > 0) {
      const info = getAgentInfo();
      if (!info) return state.builderPrompt; // fallback
      const { agent, agentSlotIndex, isAgentTurn, roundNumber, loopNumber } = info;
      let message;

      if (isAgentTurn) {
        message = agent.prompt;
        // Challenge injection: every N full rounds on the first agent's turn
        if (
          state.challengeEnabled &&
          roundNumber > 1 &&
          roundNumber % CHALLENGE_EVERY_N_ROUNDS === 0 &&
          agentSlotIndex === 0
        ) {
          message += CHALLENGE_PROMPT;
          log(`Round #${roundNumber}: Injecting challenge prompt!`);
        }
        log(`Round #${roundNumber}, Loop #${loopNumber}: ${agent.name} turn`);
      } else {
        // Critic turn — context-aware
        message = LOVABLE_AGENTS.criticTemplate
          .replace("{AGENT_NAME}", agent.name)
          .replace("{CRITIC_CONTEXT}", agent.criticContext);
        log(`Round #${roundNumber}, Loop #${loopNumber}: CRITIC (reviewing ${agent.name})`);
      }

      return message;
    }

    // === CLASSIC MODE ===
    const isBuilder = state.messageIndex % 2 === 0;
    const loopNumber = Math.floor(state.messageIndex / 2) + 1;
    let message;

    if (isBuilder) {
      message = state.builderPrompt;
      // Inject challenge every N loops on builder turn
      if (
        state.challengeEnabled &&
        loopNumber > 1 &&
        loopNumber % CHALLENGE_EVERY_N_LOOPS === 0
      ) {
        message += CHALLENGE_PROMPT;
        log(`Loop #${loopNumber}: Injecting challenge prompt!`);
      }
      log(`Loop #${loopNumber}: BUILDER turn`);
    } else {
      message = state.criticPrompt;
      log(`Loop #${loopNumber}: CRITIC turn`);
    }

    return message;
  }

  // ── Core logic ──

  function sendNextMessage() {
    if (!state.enabled) return;

    if (isAIWorking() || getButtonState() === "stop") {
      log("AI is still working (stop icon). Back to waiting...");
      buttonWasStop = true;
      updateStatus("waiting");
      return;
    }

    const chatInput = findChatInput();
    if (!chatInput) {
      log("Could not find chat input. Will retry in 3s...");
      updateStatus("waiting");
      pendingTimeout = setTimeout(() => {
        pendingTimeout = null;
        sendNextMessage();
      }, 3000);
      return;
    }

    const message = getNextMessage();
    log(`Sending message #${state.messagesSent + 1}`);
    sendingStartTime = Date.now();
    updateStatus("sending");

    const success = setChatInputValue(chatInput, message);
    if (!success) {
      log("Failed to set input value. Will retry in 3s...");
      updateStatus("waiting");
      pendingTimeout = setTimeout(() => {
        pendingTimeout = null;
        sendNextMessage();
      }, 3000);
      return;
    }

    log("Text set successfully. Waiting 800ms before clicking send...");

    pendingTimeout = setTimeout(() => {
      pendingTimeout = null;

      try {
        const currentBtnState = getButtonState();
        const btn = getActionButton();

        if (currentBtnState === "stop") {
          log("Button turned into STOP — aborting send");
          buttonWasStop = true;
          updateStatus("waiting");
          return;
        }

        // Re-verify input has content; retry if cleared
        const input = findChatInput();
        const inputText = input?.value || input?.textContent || "";
        if (input && !inputText.trim()) {
          log("Input was emptied — retrying value set...");
          setChatInputValue(input, message);
        }

        if (btn && !btn.disabled && currentBtnState === "send") {
          btn.click();
          log("Submitted via send button");
        } else if (btn && !btn.disabled) {
          btn.click();
          log("Submitted via button click (state: " + currentBtnState + ")");
        } else {
          // Button disabled — try re-setting value and clicking after short wait
          log("Send button disabled — retrying value set + click...");
          if (input) setChatInputValue(input, message);
          setTimeout(() => {
            const retryBtn = getActionButton();
            if (retryBtn && !retryBtn.disabled) {
              retryBtn.click();
              log("Retry click succeeded");
            } else {
              const form = document.querySelector("#chat-input");
              if (form) {
                form.dispatchEvent(
                  new Event("submit", { bubbles: true, cancelable: true })
                );
                log("Submitted via form submit fallback");
              }
            }
          }, 500);
        }

        state.messageIndex++;
        state.messagesSent++;
        lastSendTime = Date.now();
        buttonWasStop = false;
        sendingStartTime = 0;
        saveState();

        chrome.runtime.sendMessage(buildStatusMessage("waiting")).catch(() => {});

        updateStatus("waiting");
      } catch (err) {
        log(`Error in send callback: ${err.message}`);
        sendingStartTime = 0;
        updateStatus("waiting");
      }
    }, 800);
  }

  // ── Auto-dismiss dialogs ──

  function dismissDialogs() {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const text = btn.textContent?.trim();

      if (text === "Allow") {
        const parent = btn.closest("div")?.parentElement;
        const parentText = parent?.innerText || "";
        if (
          btn.closest('[role="dialog"]') ||
          parentText.includes("Enable Cloud") ||
          parentText.includes("can't be undone")
        ) {
          log('Auto-clicking "Allow" on Enable Cloud dialog');
          btn.click();
          return true;
        }
      }

      if (text === "Approve") {
        log('Auto-clicking "Approve" on Plan dialog');
        btn.click();
        return true;
      }
    }
    return false;
  }

  function checkForCompletion() {
    if (!state.enabled) return;
    if (pendingTimeout) return;
    if (!isContextValid()) {
      log("Extension context invalidated — stopping.");
      stopObserving();
      return;
    }

    // Safety: recover from stuck "sending" state
    if (
      state.status === "sending" &&
      sendingStartTime > 0 &&
      Date.now() - sendingStartTime > SENDING_STUCK_TIME
    ) {
      log(
        `Stuck in "sending" for ${Math.round((Date.now() - sendingStartTime) / 1000)}s — forcing recovery`
      );
      sendingStartTime = 0;
      updateStatus("waiting");
      // Re-attempt sending after delay
      pendingTimeout = setTimeout(() => {
        pendingTimeout = null;
        sendNextMessage();
      }, state.delay * 1000);
      return;
    }

    dismissDialogs();

    const btnState = getButtonState();
    const timeSinceLastSend = Date.now() - lastSendTime;

    if (btnState === "stop") {
      buttonWasStop = true;
      lastStopSeenTime = Date.now();
      return;
    }

    if (buttonWasStop && timeSinceLastSend > MIN_AI_WORK_TIME) {
      log(
        `AI finished! (stop icon gone after ${Math.round(timeSinceLastSend / 1000)}s). Sending next in ${state.delay}s...`
      );
      buttonWasStop = false;
      pendingTimeout = setTimeout(() => {
        pendingTimeout = null;
        sendNextMessage();
      }, state.delay * 1000);
      return;
    }

    if (timeSinceLastSend > STUCK_FALLBACK_TIME && btnState === "send") {
      log(
        `Fallback: idle for ${Math.round(timeSinceLastSend / 1000)}s (buttonWasStop=${buttonWasStop}). Sending next in ${state.delay}s...`
      );
      buttonWasStop = false;
      pendingTimeout = setTimeout(() => {
        pendingTimeout = null;
        sendNextMessage();
      }, state.delay * 1000);
    }
  }

  // ── DOM Observer ──

  function startObserving() {
    if (observer) observer.disconnect();
    if (pollInterval) clearInterval(pollInterval);

    buttonWasStop = false;
    lastSendTime = Date.now();
    updateStatus("waiting");

    if (getButtonState() === "stop") {
      buttonWasStop = true;
      log("AI is currently working. Will wait for completion.");
    }

    observer = new MutationObserver(() => {
      if (state.enabled) checkForCompletion();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "disabled", "d"],
    });

    pollInterval = setInterval(() => {
      if (state.enabled) checkForCompletion();
    }, 3000);

    const hasInput = !!findChatInput();
    const btnState = getButtonState();
    let nextRole;
    if (state.multiAgentEnabled && state.activeRoster.length > 0) {
      const info = getAgentInfo();
      nextRole = info ? (info.isAgentTurn ? info.agent.name : `Critic (${info.agent.name})`) : "Unknown";
    } else {
      nextRole = state.messageIndex % 2 === 0 ? "Builder" : "Critic";
    }
    log(
      `Observer started. Input: ${hasInput ? "YES" : "NO"}, Button: ${btnState}, Next: ${nextRole}`
    );

    // Auto-send first message if AI is idle (no task running)
    if (btnState === "send" && !isAIWorking()) {
      log(`AI is idle — auto-sending first message in ${state.delay}s...`);
      pendingTimeout = setTimeout(() => {
        pendingTimeout = null;
        sendNextMessage();
      }, state.delay * 1000);
    }
  }

  function stopObserving() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      pendingTimeout = null;
    }
    buttonWasStop = false;
    updateStatus("paused");
    log("Observer stopped.");
  }

  // ── State management ──

  function isContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function saveState() {
    if (!isContextValid()) {
      log("Extension context invalidated — stopping.");
      stopObserving();
      return;
    }
    const data = {};
    // Per-project runtime state
    data[KEY_PREFIX + "enabled"] = state.enabled;
    data[KEY_PREFIX + "messageIndex"] = state.messageIndex;
    data[KEY_PREFIX + "messagesSent"] = state.messagesSent;
    // Global settings (shared across projects)
    data["builderPrompt"] = state.builderPrompt;
    data["criticPrompt"] = state.criticPrompt;
    data["challengeEnabled"] = state.challengeEnabled;
    data["delay"] = state.delay;
    data["multiAgentEnabled"] = state.multiAgentEnabled;
    if (state.activeRosterIds) data["activeRosterIds"] = JSON.stringify(state.activeRosterIds);
    chrome.storage.local.set(data);
  }

  function loadState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        [
          // Global settings
          "builderPrompt",
          "criticPrompt",
          "challengeEnabled",
          "delay",
          "multiAgentEnabled",
          "activeRosterIds",
          // Per-project state
          KEY_PREFIX + "enabled",
          KEY_PREFIX + "messageIndex",
          KEY_PREFIX + "messagesSent",
        ],
        (data) => {
          if (typeof data.builderPrompt === "string")
            state.builderPrompt = data.builderPrompt;
          if (typeof data.criticPrompt === "string")
            state.criticPrompt = data.criticPrompt;
          if (typeof data.challengeEnabled === "boolean")
            state.challengeEnabled = data.challengeEnabled;
          if (typeof data.delay === "number") state.delay = data.delay;
          // Multi-agent
          if (typeof data.multiAgentEnabled === "boolean")
            state.multiAgentEnabled = data.multiAgentEnabled;
          if (typeof data.activeRosterIds === "string") {
            try { state.activeRosterIds = JSON.parse(data.activeRosterIds); } catch (e) { /* ignore */ }
          }
          state.activeRoster = resolveRoster(state.activeRosterIds);
          // Per-project
          const enabled = data[KEY_PREFIX + "enabled"];
          const msgIdx = data[KEY_PREFIX + "messageIndex"];
          const msgSent = data[KEY_PREFIX + "messagesSent"];
          if (typeof enabled === "boolean") state.enabled = enabled;
          if (typeof msgIdx === "number") state.messageIndex = msgIdx;
          if (typeof msgSent === "number") state.messagesSent = msgSent;
          resolve();
        }
      );
    });
  }

  function buildStatusMessage(status) {
    const msg = {
      type: "STATUS_UPDATE",
      status,
      messagesSent: state.messagesSent,
      agentMode: state.multiAgentEnabled ? "multi-agent" : "classic",
      loopNumber: Math.floor(state.messageIndex / 2) + 1,
    };

    if (state.multiAgentEnabled && state.activeRoster.length > 0) {
      const info = getAgentInfo();
      if (info) {
        msg.agentName = info.agent.name;
        msg.agentShortName = info.agent.shortName;
        msg.agentColor = info.agent.color;
        msg.isAgentTurn = info.isAgentTurn;
        msg.roundNumber = info.roundNumber;
      }
    } else {
      msg.role = state.messageIndex % 2 === 0 ? "builder" : "critic";
    }

    return msg;
  }

  function updateStatus(status) {
    state.status = status;
    if (!isContextValid()) {
      log("Extension context invalidated — stopping.");
      stopObserving();
      return;
    }
    chrome.runtime.sendMessage(buildStatusMessage(status)).catch(() => {});
  }

  function log(msg) {
    console.log(`[Lovable Auto-Prompter] ${msg}`);
  }

  // ── Message listener from popup ──

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "TOGGLE") {
      state.enabled = msg.enabled;
      saveState();
      if (state.enabled) {
        startObserving();
      } else {
        stopObserving();
      }
      sendResponse({ ok: true, status: state.status });
    }

    if (msg.type === "UPDATE_SETTINGS") {
      if (typeof msg.builderPrompt === "string")
        state.builderPrompt = msg.builderPrompt;
      if (typeof msg.criticPrompt === "string")
        state.criticPrompt = msg.criticPrompt;
      if (typeof msg.challengeEnabled === "boolean")
        state.challengeEnabled = msg.challengeEnabled;
      if (typeof msg.delay === "number") state.delay = msg.delay;
      saveState();
      sendResponse({ ok: true });
    }

    if (msg.type === "GET_STATUS") {
      const statusMsg = buildStatusMessage(state.status);
      statusMsg.enabled = state.enabled;
      statusMsg.messageIndex = state.messageIndex;
      statusMsg.hasTextarea = !!findChatInput();
      statusMsg.hasSendButton = !!getActionButton();
      statusMsg.multiAgentEnabled = state.multiAgentEnabled;
      statusMsg.activeRosterIds = state.activeRosterIds;
      sendResponse(statusMsg);
    }

    if (msg.type === "SEND_NOW") {
      sendNextMessage();
      sendResponse({ ok: true });
    }

    if (msg.type === "RESET_COUNT") {
      state.messagesSent = 0;
      state.messageIndex = 0;
      saveState();
      sendResponse({ ok: true });
    }

    if (msg.type === "UPDATE_MODE") {
      state.multiAgentEnabled = !!msg.multiAgentEnabled;
      if (!state.activeRoster.length) {
        state.activeRoster = resolveRoster(state.activeRosterIds);
      }
      saveState();
      log(`Mode switched to: ${state.multiAgentEnabled ? "Multi-Agent" : "Classic"}`);
      sendResponse({ ok: true });
    }

    if (msg.type === "UPDATE_ROSTER") {
      if (Array.isArray(msg.rosterIds) && msg.rosterIds.length > 0) {
        state.activeRosterIds = msg.rosterIds;
        state.activeRoster = resolveRoster(msg.rosterIds);
        saveState();
        log(`Roster updated: ${state.activeRoster.map((a) => a.shortName).join(" → ")}`);
      }
      sendResponse({ ok: true });
    }

    return true;
  });

  // ── Init ──

  async function init() {
    log(`Content script loaded. Project: ${PROJECT_ID}`);
    await loadState();

    if (state.enabled) {
      setTimeout(startObserving, 2000);
    } else {
      updateStatus("paused");
    }
  }

  init();
})();
