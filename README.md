# NEXUS

A local Windows session deck for **GitHub Copilot CLI**, Claude Code, and Codex (shown as Astra). Read conversations, catch up, inspect recorded usage, and continue work in an embedded terminal. A PC with only Copilot installed is supported.

## Install

Tell your coding agent:

> Read INSTALL.md in this repository and install NEXUS on my PC: <link to this repository>

To do it by hand, follow the steps below.

## Fork it

NEXUS is meant to be forked. Take it, change it and build something better, then share what you made. `npm test` runs the checks.

## Getting started on a new PC

Requirements: **Windows 10/11, Node.js 24 LTS (with npm), Git**, a current Chrome or Edge browser, and the voice downloads in step 3 for Talk and Call (about 300 MB for speech recognition, plus about 12 GB for the neural voices). NEXUS uses Windows terminals, shortcuts and local speech services; macOS/Linux are not currently supported. Check `node --version` in a fresh PowerShell window.

1. Install and sign in to **at least one** agent. Use your organization's approved account:

   | Agent | Install and first sign-in |
   | --- | --- |
   | Claude Code | Follow the [official Windows setup](https://code.claude.com/docs/en/quickstart), run `claude` in a project folder, then follow its login prompts. Use `/login` to sign in again. |
   | Codex (Astra in NEXUS) | Follow the [Codex CLI installation guide](https://learn.chatgpt.com/docs/codex/cli), run `codex`, and choose **Sign in with ChatGPT** or your approved provider. |
   | Antigravity CLI | Follow [Google's install page](https://antigravity.google/cli), then run `agy` and sign in. Sessions start from New and run in the terminal; Chat reading is not built yet. See [ADD_GEMINI.md](ADD_GEMINI.md). |
   | GitHub Copilot CLI | Run `npm install -g @github/copilot`, then `copilot` and `/login`. Follow the browser prompts. [Official setup](https://docs.github.com/en/copilot/get-started/cli-quickstart). |

2. Clone and start NEXUS:

   ```powershell
   git clone <your-repository-url> nexus
   cd nexus
   npm install
   Copy-Item config.example.json config.json
   npm start
   ```

   Open `http://127.0.0.1:4777` in your browser. `node server.js --open` opens it automatically. Keep the server running. Configuration is local and ignored by Git; change `port` there if necessary.

3. Download the voices. Speech recognition lets you talk to sessions; the neural voice pack gives replies natural English and Spanish voices:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .	oolsinstall-whisper.ps1
   powershell -ExecutionPolicy Bypass -File .	ools	tssetup.ps1
   ```

   The first needs about **300 MB**; the second downloads about **12 GB** (reserve **30 GB**) and runs best on an NVIDIA GPU. Without them, text sessions still work and replies use the browser's voices. Details in [Speech and voices](#speech-and-voices).

4. Choose **New**, select a project folder and your installed agent. Run one session in the CLI first if the deck is empty. NEXUS detects `claude`, `codex` and `copilot` on PATH and reads their local histories. Refresh after installing an agent; restart NEXUS if PATH changed.

**One agent is enough.** Sessions, themes, Home, Wall, native terminals and local catch-up work with any one installed agent. Only installed agents appear in New. AI Summarize uses an available agent only when requested, and session labels use the lightest one (see [Session labels](#session-labels)); local catch-up needs no model call. CLI account usage and permissions apply normally.

**Company PC:** check IT policy before installing agents, voice models or Tailscale. Your organization must permit Copilot CLI. Copilot-only works; Claude and Codex are optional.

### Desktop shortcut and startup

```powershell
powershell -ExecutionPolicy Bypass -File .\install-shortcut.ps1
```

Double-click **NEXUS** or `NEXUS.vbs` for a launch without a console. Add `-Startup` to the installer command to start at Windows login. Closing the browser leaves sessions running; exiting the server closes its agent terminals. When the NEXUS folder is updated while NEXUS runs (a `git pull` or a new download into the same folder), NEXUS restarts itself on the new version once the files stop changing and no session or call runs inside it, and open windows reload (one where you are writing a message offers a reload instead). A version that cannot start leaves the running one in place.

### Themes and instructions

A theme groups the sessions of one project. A session in a git repository joins that repository's theme. Any other session (for example in a synced SharePoint or OneDrive folder) belongs to the folder it was started in, with everything built inside it, such as the analyses an agent folder produced; NEXUS climbs above it only to the project it sits in, a folder set up as a workspace (with `.github`, `.vscode`, `.claude`, `.obsidian`, `AGENTS.md`, `CLAUDE.md` or a package manifest). A session that worked equally in two related projects stays with the one it was started in. The lightest installed model (the one that writes [session labels](#session-labels)) then reads a short rundown of each such session (where it was started and worked, title, asks, files touched) and moves it only when it is clearly about another project, or was started in a general place that holds many projects; it uses an existing theme or names a new one. Such places are never themes themselves: your user folder, Desktop, Documents and OneDrive, a folder named for projects (`Projects`, `02. Projects`, `Side Projects`), a folder holding nothing but folders when two or more of them are workspaces (a `10. Agents` category), and on a work PC the company folder beside `OneDrive - <Company>` with its synced SharePoint and Teams libraries and a channel's `General` folder. Each project in a projects folder is a theme, numbered (`21. Region Review`) or not. A theme an older NEXUS made for one of them is retired, and the sessions in it are read again. One request covers up to 40 sessions, and each session is read once (again later only if it said too little). Your own moves always win, and a theme NEXUS made that no session belongs to any more is hidden. Set `"themeSorting": false` in `config.json` to keep folder-only themes. The sidebar lists your themes once: each row shows what the theme is about and a small session counter; pick one to see its sessions in the column beside it. That line is the purpose you set, otherwise the project's own description (from `package.json`, `pyproject.toml`, or the opening of its README, `CLAUDE.md` or `AGENTS.md`), otherwise its latest session titles. Each session card carries a short label for its latest exchange, such as "Playtester kit update" (see [Session labels](#session-labels)); until it is written, the card shows your last ask and the agent's answer. **Commands** and **Recent** sit right under the views. **Home** on a PC greets you with your latest five themes circling the core (sessions that need you or are working circle closer), then what needs you, then recent work newest first.

On a PC, **Wall** shows each theme with something in play side by side, one column each. Sessions in play (need you, working, open, or used in the last 12 hours) stay visible, and older ones fold under **Show older**. Themes with nothing in play fold into one **Quiet themes** column. Click a column's name to see what that theme is about in the sidebar. Drag a session onto another column or a quiet theme to move it, or onto **New theme** to name a new one; Undo is offered after every move. Right-click a session (long-press on a phone) for **Move to theme…**. When a filter such as Working hides sessions, the list says so and offers **Show all**. On a phone, **Wall** (in the bottom bar) stacks the themes with something in play, those that need you first, with the same tiles; quiet themes fold into one list, and a theme name opens its sessions. **New** sits in the phone Home header. On the phone Sessions tab, a filter such as Working shows the matching sessions grouped by theme; **All** brings the theme list back.

**Recent work** (next to Commands in the sidebar, on Home, the R key, or Commands) has a **What was I doing?** button: one cheap model request, only when pressed, that retells your latest sessions per theme. Below it, the page tells what you did lately on this PC in short sentences grouped by theme, such as "You installed Nexus and created shortcut" or "Now mapping the export", with the latest result, files touched and folder. Empty sessions are left out. When WSL sessions are present, each row is labelled Windows or WSL (from `\\wsl$`/`\\wsl.localhost` or Linux paths; Git Bash `/c/...` counts as Windows). **Catch up** opens that session with its catch-up panel; **Show 10 more** goes further back.

**Settings > Theme** offers six colors (Ice, Azure, Aurora, Ember, Orchid, Graphite) and three backgrounds (Ink, OLED, Dim); the choice is kept per device.

Open a theme to edit its purpose and optional NEXUS note. **Theme brief** gathers its folders and existing `CLAUDE.md`, `.claude/CLAUDE.md`, `AGENTS.md` and `.github/copilot-instructions.md` files. Expand a file to preview it and see which agents use it. Saving requires confirmation and keeps the previous contents in a neighboring `.bak`. Use **Create one** for a folder without instructions.

**New session in this theme** defaults to its main folder. Codex starts there to read `AGENTS.md`; Claude and Copilot add other theme folders with `--add-dir`. Claude also loads their `CLAUDE.md` files and appends the theme purpose/note. Copilot preloads additional `AGENTS.md` and scoped instructions through its instruction-directory setting; repository-wide rules follow native discovery. The launch screen and session header explain the method. Native discovery rules still apply; a NEXUS note does not rewrite repository instructions.

### Agents handing work to each other

**Settings > Agents > Resume without permission prompts** is on by default: Claude resumes with `--dangerously-skip-permissions` and Copilot with `--yolo`, so they act without asking first. New sessions and Codex are unchanged. It applies the next time a session resumes.

**Settings > Agents > Agents can hand work to each other** is off by default. When it is on, every session NEXUS starts or resumes gets a short guide (about 400 tokens) to giving tasks to your other installed agents: the exact command for each one (`codex exec`, `claude -p`, `copilot -p`) and the rules that keep it safe (one git worktree per helper, the brief in a file, stdin closed, read the report and the diff before merging, at most two helpers at once). Agents only delegate when you ask. Claude gets the guide in its system prompt, Codex as `developer_instructions` (never replacing one you set in `config.toml`), and Copilot through an instruction folder NEXUS owns. Sessions started outside NEXUS do not get it. Switch it from Settings, from **Commands**, or by typing **/handoff** (`/handoff on`, `/handoff off`, or `/handoff` to flip it) in any session; NEXUS handles that command itself and sends nothing to the session.

### Messages while an agent works

A message sent while the agent is busy waits in a small queue under the conversation and goes out by itself when the agent is ready. **Send now** types it into the session at once, the same way you can type while Claude, Codex or Copilot is working; **×** removes it. While a message waits, a line above it says what for: the agent is working, a question needs your answer, or NEXUS cannot see the session's message box yet (then **Raw terminal** shows what the session is showing).

### Files in a message

Drag a file or folder from Explorer onto the message box to insert its path on this PC; nothing is uploaded. NEXUS matches the name, size and modified time in the session folder, Downloads, Desktop, Documents, OneDrive and the Windows Search index. Use the clip button to upload a copy instead (50 MB per file; it works from the phone too). Remove a pending or failed file with its **×**.

### File paths in answers

A file path in an agent's answer is a link. On the PC, a click opens the file in its usual app (documents, pages, images, media); anything that could run, such as scripts or programs, is shown in its folder instead. Right-click for **Open folder**, **Copy path** and, for an HTML file inside the session folder, **Preview here**: the page runs in a sandboxed panel under the conversation, which keeps playing while the session works. The **Preview** button next to such a link does the same. On a phone, a link previews HTML or copies the path. Every session NEXUS starts or resumes is told this in a few lines (about 160 tokens), along with the fact that tables and other Markdown render in the chat, so an agent asked for a page writes an HTML file instead of saying it cannot show one. A Copilot autopilot run that ends with its task-complete summary shows that summary as Copilot's reply.

## Copilot conversations

NEXUS reads `~/.copilot/session-state/<id>/workspace.yaml` and `events.jsonl`. `COPILOT_HOME` and the override `NEXUS_COPILOT_DIR` are supported. Binary assets and internal system prompts are excluded. Conversations update through incremental, bounded tail reads.

- **New session** and **Resume** use the NEXUS terminal. Trust and permission questions require your explicit answer; interrupted delivery keeps the unsent draft. Talk uses the same guarded send path.
- **Fork session** uses `/fork` on a ready Copilot terminal already open in NEXUS. Resume first if needed. NEXUS waits for the new session ID before switching cards.
- Model choices use `--model` on start/resume. Copilot changes apply on the **next resume**. Use `/model` in Raw terminal for a native session switch. The model list comes from the agents: Copilot's own list (`copilot help config`, read at start and every six hours) and Codex's `models_cache.json`. Models in `config.json` are added to it. Your organization may still turn some models off.
- Renaming a Copilot card stores a NEXUS title locally; its workspace name remains intact. Claude/Codex rename actions use their native transcript/index records.
- Quota errors appear on the card and in the conversation, without automatic retries.
- **Live load** at the top of Spend shows CPU and memory for this PC and for each running session, counting the agent and everything it started (builds, tests, servers). A working session that barely uses the PC is **waiting for the model**; one using a full core or more is **working on this PC**. It samples every 2 seconds only while Spend is open.
- Spend reports recorded tokens, premium requests, and AI credits when present. These are session counters, **not account quota or dollar billing**. Tokens may appear only at shutdown; forks can share earlier usage. Missing usage is unknown, not zero.

**Catch me up** reads the latest turn locally. **Summarize** runs only when pressed: Claude Haiku when installed, otherwise Copilot with `copilotSummaryModel` (default `gpt-6-luna`). Tools are disabled/denied. Copilot 1.0.93 has no verified no-persistence flag, so it saves the summary session. With only Codex installed, Summarize uses an ephemeral Codex run. With no agent installed, only the local recap remains available. Your account may incur usage. Apart from session labels, no summary or premium model request runs automatically.

### Session labels

After a turn finishes, NEXUS asks the lightest model you have installed for a few words about it: **Claude Haiku**, otherwise **Codex Luna** (the newest Luna your account lists), otherwise **Haiku through Copilot**. It sends one small request per finished turn (your last message and the agent's reply, clipped), one at a time, only for sessions used in the last week. Tools are off, Claude and Codex keep nothing, and Copilot's saved label sessions are hidden from the list. A failed agent (for example at its usage limit) is skipped for 30 minutes. When a newer CLI no longer knows an option NEXUS turns something off with (Copilot CLI 1.0.104 removed `--no-remote`), NEXUS leaves it out and runs the request again. Labels are stored in `%LOCALAPPDATA%NexusDecklabels.json`. Each request uses your plan; on Copilot it counts toward premium requests. Set `"sessionLabels": false` in `config.json` to turn labels off.

The default Copilot summarizer comes from the observed CLI catalog and [GitHub's model pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing). Verify your work account's policies and pricing. See [verification notes](docs/COPILOT_VERIFICATION.md) for tested capabilities and limitations.

## Phone access, step by step

1. Check IT policy, then install Tailscale on the PC and phone. Sign both in with the same permitted Tailscale identity and connect them to the tailnet.
2. Start NEXUS on the PC. In PowerShell, configure the HTTPS proxy (substitute your configured port):

   ```powershell
   tailscale serve --bg http://127.0.0.1:4777
   tailscale serve status
   ```

   Follow Tailscale's prompts to enable HTTPS if needed. Use [Serve](https://tailscale.com/docs/reference/tailscale-cli/serve), which is private to your tailnet.
3. In `config.json`, set `remoteHost` to the Serve hostname **without** `https://` or a trailing slash; set `remoteUser` to the Tailscale login identity allowed to pair. Restart NEXUS after editing.
4. On the PC, open **Settings > Pair a phone** to display the HTTPS link, QR and one-time code.
5. Open the link on the phone with Tailscale connected. On iPhone, use Safari **Share > Add to Home Screen**. On Android, use the browser's **Install app / Add to Home screen**.
6. Open **NEXUS from its Home Screen icon**, then enter the code **inside that app**. Generate a fresh code on the PC if it expired. Browser and Home Screen cookies can be separate, so pairing in Safari alone may not pair the installed app.
7. Keep the PC awake and NEXUS running. Paired devices can be revoked in Settings.

## Speech and voices

These are the two downloads from step 3 of Getting started. Text sessions work without them. For **speech recognition** in Talk/Call, install the local multilingual CPU fallback:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\install-whisper.ps1
```

It downloads whisper.cpp and a roughly **148 MB** model under `%LOCALAPPDATA%\NexusDeck\whisper` (allow about **300 MB** for binaries, archive and model). In **Settings > Voice**, run the voice check, allow microphone access, and select the correct input device. Phone microphones require the HTTPS address. Recognition runs on the PC.

For playback, browser/Windows voices require no model pack. The neural voice pack supports English and Spanish:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\tts\setup.ps1
```

This is a large, explicit install: roughly **12 GB of pinned downloads**, plus environments and extracted weights; reserve **30 GB** as a planning allowance, not a measured minimum. A compatible NVIDIA GPU accelerates neural voices. Piper can fall back to CPU; browser/Windows speech remains available if neural voices cannot start. GPU-heavy voices may be impractical on a CPU-only PC. Choose and audition voices in Settings; see [voice setup and licenses](docs/NEXUS_VOICES.md). No paid speech API is required.

A **Call** is turn by turn: you speak, the agent works, then you hear its reply. **Call options** can switch a call to Live, and NEXUS remembers that choice.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Port already in use / `EADDRINUSE` | Open the existing NEXUS instance, or choose an unused `port` in `config.json` and restart. Update Serve's target if the port changes. Do not terminate an unknown process. |
| Agent not detected | Check `claude --version`, `codex --version` or `copilot --version` in a fresh PowerShell window. Install/sign in to that CLI, then restart NEXUS to refresh PATH. |
| Empty session list | Create a conversation in the CLI under the same Windows account. Missing directories for uninstalled agents are normal. |
| Phone shows **401** | That browser/app is not paired, or its pairing was revoked. Connect Tailscale, create a new code on the PC, and pair inside the Home Screen app. |
| Phone cannot connect / **403** | Confirm the PC is awake, Serve points to NEXUS, and `remoteHost`/`remoteUser` match your allowed Tailscale identity. |
| Microphone or speech fails | Use HTTPS on the phone, allow the microphone, install recognition, then run Settings' voice check. Try a browser/PC playback voice. Text input remains available. |

## Local data and development

Preferences, checkpoints and Copilot card names live in `%LOCALAPPDATA%\NexusDeck\state.json`; paired-device secrets live in `devices.json` there. Discovery is read-only. Explicit Send, Resume, Fork and Rename actions change agent state as described above.

```powershell
npm test
node tools/copilot-tour.cjs
node tools/copilot-tour.cjs --real
```

Tests use stubs, synthetic conversations and no model calls. Copilot tours use headless Chrome on ports 4785/4786 at desktop and phone sizes. Fixture screenshots are in `docs/shots/copilot/`; the real-data tour refuses writes and keeps captures in ignored `.local/`. Legacy screenshots and transcript exports were removed. Read [PUBLISHING_CHECK.md](docs/PUBLISHING_CHECK.md) **before uploading existing Git history**.
