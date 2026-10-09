# Sources for the gameplay and ways-to-play trailer

The gameplay segments and closing title footage are retained from v4. [SOURCES-v2.md](SOURCES-v2.md) documents their real recordings, isolated demo staging, fonts, and the Kenney sound effects. Combat remains confined to the opening section.

The 15.5-second methods insert is original motion graphics rendered by `methods-motion.py`, using code-drawn server, monitor/phone, terminal, processor, and rotating icosahedron geometry. It illustrates connection choices rather than showing recorded configuration sessions. No product screenshots or vendor logos are used in this insert. Sound cues use the same retained CC0 packs as the gameplay edit. There is no music.

Feature wording was checked against the local project sources:

- Self-hosting and local model/API backend support: the repository's `README.md`, `docs/configuration.md`, and `docs/text-backends.md`.
- Client platforms (Windows, macOS, Linux, Android), bundled local worlds, and server connections: the sibling `open-dungeon-master-client/README.md`.
- Connecting your own Claude Code, Codex, or another MCP client to a table: `docs/agent-harness.md` (“Your own agent”) and `src/app/settings/ConnectedAgentsSection.tsx`.

The agent cards refer to users connecting their own agents through MCP. The trailer does not claim that a particular narrator adapter has passed a live test on this machine.
