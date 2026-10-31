<!--
What this changes and why. No issue is needed first. If it fixes an open
issue, link each with its own keyword: "Fixes #123. Fixes #124." (a comma
list links only the first).
The conventions and the checks are in .github/CONTRIBUTING.md. Written with
a coding agent? Point it at that file and AGENTS.md before it starts.
-->

### Checks

- [ ] `npm run lint`, `npm test` and `npm run build` pass, and the change has a test that fails without it.
- [ ] Anything a player sees has screenshots below: the website and the app, day and night themes, phone width.
- [ ] No hostnames, IP addresses, logs, keys, `.env` files or players' names in the code, the tests or this description.

### Settings, options and controls

- [ ] This adds no new setting, toggle, option or other control.
- [ ] This adds one. Below: why it is needed (what goes wrong without it, why a good default or a control that already exists cannot cover it, who uses it), a screenshot of it where it lives with its default, and how it was checked for keyboard, screen reader and phone use. See "Settings, options and toggles" in AGENTS.md for what a new control has to meet.
