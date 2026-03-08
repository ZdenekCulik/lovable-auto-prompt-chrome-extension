# Lovable Auto-Prompter

A Chrome extension that automatically sends follow-up prompts to [Lovable](https://lovable.dev) when the AI finishes a task. It runs a **Builder/Critic loop** to iteratively improve your project without manual intervention.

## How It Works

The extension alternates between two AI roles:

- **Builder** — Analyzes the project and implements improvements (UI, UX, performance, architecture, features)
- **Critic** — Reviews the current state, identifies weaknesses, and guides the next iteration

Each role sends its prompt automatically after the AI completes its previous task, creating a continuous improvement cycle.

Every 5 loops, an optional **challenge prompt** is injected that pushes the AI to question the fundamental product structure and propose bolder changes.

## Features

- **Builder/Critic alternation** — two complementary roles for balanced iteration
- **Configurable delay** — 2-30 seconds wait time after AI finishes before sending the next prompt
- **Customizable prompts** — edit both Builder and Critic prompts to fit your project
- **Per-project state** — counters and enabled state are tracked separately for each Lovable project
- **Challenge injection** — periodic prompt that encourages fundamental rethinking (every 5 loops)
- **Auto-dismiss dialogs** — automatically clicks through "Allow" and "Approve" dialogs
- **Live status** — badge shows message count; popup displays current role, loop number, and status
- **Send Now** — manually trigger the next message without waiting
- **Reset** — restart counters from zero

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the extension folder
5. Navigate to your project on [lovable.dev](https://lovable.dev)
6. Click the extension icon and toggle it **ON**

## Usage

1. Open a Lovable project in Chrome
2. Click the extension icon in the toolbar
3. Toggle the switch to **ON**
4. The extension will detect when the AI finishes and automatically send the next prompt
5. Use the **Builder** and **Critic** tabs to customize the prompts
6. Adjust the delay slider to control wait time between messages
7. Click **Save Prompts** after editing

## File Structure

```
lovable-auto-prompter/
├── manifest.json    # Chrome extension manifest (v3)
├── background.js    # Service worker — manages badge per tab
├── content.js       # Content script — Builder/Critic loop logic
├── popup.html       # Extension popup UI
├── popup.css        # Popup styles
├── popup.js         # Popup logic and settings management
└── icons/           # Extension icons (16, 48, 128px)
```

## License

MIT
