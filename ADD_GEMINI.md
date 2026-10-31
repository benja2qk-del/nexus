# Use Gemini with NEXUS

Google stopped serving Gemini CLI for free, Google AI Pro and Google AI Ultra accounts on June 18, 2026. Its replacement is **Antigravity CLI** (`agy`), and that is what NEXUS supports. Gemini CLI itself still works for API-key and Gemini Code Assist users, but NEXUS does not run it yet.

## Set it up

To let an agent do it, say:

> Read ADD_GEMINI.md in this repository and set up Antigravity CLI for NEXUS. I will sign in myself.

1. Install Antigravity CLI on Windows. Read the script first if you like:

   ```powershell
   irm https://antigravity.google/cli/install.ps1 | iex
   ```

2. Open a new terminal, run `agy` and sign in with your Google account.
3. Restart NEXUS. It also looks in `%LOCALAPPDATA%\agy\bin`, so it finds `agy` even when PATH has not refreshed.
4. Choose **New**, then **Antigravity**, then a folder.

## What works today

| Feature | Status |
| --- | --- |
| Detected by NEXUS, with its own green label | Works |
| Start a new session from New | Works, in the terminal |
| Pick a model | Default model only |
| Read the conversation in Chat | Not built |
| See and resume past sessions | Not built |
| Summaries and Call | Not built |

## Add the rest

This is a good first fork. The missing parts depend on Antigravity's real session files, so create one session first and look at them.

- **Files to read:** `~/.gemini/antigravity-cli/`. Third-party notes say conversations are `.db` files in `conversations/`. Confirm that on your version.
- **Flags:** `agy --help` lists them. `--conversation <id>` resumes a session, `--dangerously-skip-permissions` skips prompts, and `--model` picks a model. `agy models` lists models after sign-in.
- **Model:** `copilot.js` is the example to follow. It finds sessions and turns their records into Chat events.
- **Places to connect it:**
  - `server.js`: session list, Chat events and `term-resume`.
  - `handoff.js`: the `SKIP_PROMPTS` flag and the resume check, which looks for `--resume` and needs `--conversation` here.
  - `models.js`: the real model list.
  - `public/conversation.js`: how to tell its input box and prompts from the terminal screen.
  - `agents.js`: `summaryProvider`, for summaries.

Run `npm test` before you share your changes.
