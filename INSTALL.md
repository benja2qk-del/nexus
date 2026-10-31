# Install NEXUS

This file is written for a coding agent. To install NEXUS, tell your agent:

> Read INSTALL.md in this repository and install NEXUS on my PC: <link to this repository>

## Agent instructions

Follow these steps in order, and report the result of each one. Stop and ask the person if a step fails.

1. **Check the PC.** NEXUS runs on Windows 10 or 11. Confirm that `node --version` shows 24 or newer, and that `git` works. If either is missing, tell the person what to install. Do not install them without asking.
2. **Check the agents.** Run `claude --version`, `codex --version`, `copilot --version` and `agy --version`. At least one must work and be signed in. If none does, stop and send the person to "Getting started on a new PC" in `README.md`.
3. **Get the code.** Ask where to put it if they have no preference, and use a folder in their user profile. Then run:

   ```powershell
   git clone <link to this repository> nexus
   cd nexus
   npm install
   Copy-Item config.example.json config.json
   ```

4. **Add the desktop shortcut.** Ask first, then run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install-shortcut.ps1
   ```

5. **Start NEXUS.** Run `node server.js --open`, confirm that `http://127.0.0.1:4777` answers, and leave the server running. If port 4777 is taken, change `port` in `config.json`.
6. **Finish.** Tell the person NEXUS is ready and that the shortcut, if they chose it, starts it next time.

## Rules

- Do not download the voice packs unless the person asks. They are optional, and the larger pack needs about 30 GB free. The commands are in `README.md`.
- Do not set up phone access unless the person asks. If they do, follow "Phone access, step by step" in `README.md` exactly. NEXUS trusts requests from the PC, so never expose its port to a network in any other way.
- Do not enter passwords, tokens or API keys for the person. They sign in to their agents themselves.
- On a company PC, tell the person to check IT policy before installing anything.
