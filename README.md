# Ship-OS: Space Opera Suite

A SillyTavern extension that turns a chat into a grounded space opera sim: a ship console, a procedurally generated star sector, trackers for ship, crew, cargo and missions, and a sci-fi restyle of the SillyTavern interface.

Works in desktop browsers, on Android, and in Tauri-based ports. It only uses the public `SillyTavern.getContext()` API, with no server plugin.

## Install

In SillyTavern open **Extensions → Install extension** and paste:

```
https://github.com/Sronefa/silly-extension-sci-fi
```

## Status

The framework and the character system are in. Tactical combat, ship and mech combat, the economy and the fail-state rules are being designed and are added as modules on top.

What works today:

- **Character creator**: 8 origins, 15 careers at three experience tiers, six attributes, sixteen skills, point-buy, traits, flaws and cyberware. The career decides whether you start with a ship, a mech or fighter, or nothing.
- **Character sheet**: skills gain XP through use and through paid training at stations. Skill checks roll 2d10 + skill + attribute against a difficulty, with penalties for hunger, exhaustion, stress and wounds.
- **Party**: AI characters in the chat can be given their own sheet with one tap.
- **Death**: checkpoints or permadeath, chosen at creation. Reaching zero health means downed, not dead.
- **Console (HUD)** with tabs: Status, Sheet, Ship, Nav, Gear, Dossier, Log. Full-screen sheet with bottom tabs on phones.
- **Widgets**: on wide screens every panel can be popped out of the console and dragged anywhere. Positions are remembered.
- **Campaign per chat**: state is stored in the chat's metadata, so each chat is its own save. Export and import as JSON.
- **Sector map**: about 28 star systems generated from a seed, with factions, security levels, economies, stations, jump lanes, route plotting, jumps that cost fuel and time, and an orbital view of each system. Pan, pinch and wheel zoom.
- **AI link**: the current state is injected into the prompt, and the AI can change it with a hidden block such as `<sf>credits -200; time +3h</sf>`. The block is removed from the message and shown as small chips. Swiping or deleting that message rolls the change back.
- **Interface restyle**: five colour schemes, angular panels, scanlines, starfield, and an alert status that recolours the whole interface.
- **Slash commands**: `/sf <commands>`, `/sf-open [tab]`, `/sf-status`. Macros: `{{sf_date}}`, `{{sf_location}}`, `{{sf_credits}}`, `{{sf_ship}}`.

## State commands

Used by the AI inside `<sf>…</sf>`, by `/sf`, and by the console on the Log tab. Separate with new lines or semicolons.

| Command | Example |
| --- | --- |
| `credits`, `debt`, `hull`, `shields`, `fuel`, `supplies`, `parts`, `health`, `stress` | `hull -15`, `health "Ito" -20` |
| `xp`, `skill`, `attr`, `check` | `xp firearms 15`, `check pilot 15` |
| `cyber add/remove`, `die`, `checkpoint` | `cyber add "Optic Suite"` |
| `time` | `time +3h`, `time +45m`, `time +2d` |
| `nourishment`, `hydration`, `rest`, `hygiene`, `morale` | `rest +40` |
| `system <name>` | `system engines -25` |
| `location`, `dock`, `undock`, `jump` | `jump "Casen Gate"` |
| `cargo add/remove`, `item add/remove` | `cargo add "Medical Supplies" 4` |
| `injury add/heal` | `injury add "Fractured rib" moderate` |
| `rep`, `contact` | `rep "Sol Accord" +5` |
| `mission add/done/fail/drop` | `mission add "Deliver medicine" reward 4000` |
| `crew add/remove` | `crew add "Ito" "Engineer"` |
| `tracker` | `tracker "Bounty" +10` |
| `alert`, `log` | `alert red` |

## For developers

```
index.js            entry point
src/core/           host wrapper, per-chat state, AI link, slash commands
src/systems/        simulation: command table, sector generator
src/data/           static catalog (factions, hulls, weapons, commodities, character options)
src/ui/             console shell, widgets, map, settings
style.css           palette tokens, console components, host restyle
```

A feature module registers what it needs: `registerWidget` and `registerTab` (UI), `registerCommand` (state commands), `registerPromptSection` (what the AI is told), `onJump` (travel events).
