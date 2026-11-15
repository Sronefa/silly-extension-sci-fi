# Ship-OS: Space Opera Suite

A SillyTavern extension that turns a chat into a grounded space opera sim: a ship console, a procedurally generated star sector, trackers for ship, crew, cargo and missions, and a sci-fi restyle of the SillyTavern interface.

Works in desktop browsers, on Android, and in Tauri-based ports. It only uses the public `SillyTavern.getContext()` API, with no server plugin.

## Install

In SillyTavern open **Extensions → Install extension** and paste:

```
https://github.com/Sronefa/silly-extension-sci-fi
```

## Status

The framework, the character system, the time system and on-foot tactical combat are in. The economy and the fail-state rules are being designed and are added as modules on top.

What works today:

- **Character creator**: 8 origins, 15 careers at three experience tiers, six attributes, sixteen skills, point-buy, traits, flaws and cyberware. The career decides whether you start with a ship, a mech or fighter, or nothing.
- **Character sheet**: skills gain XP through use and through paid training at stations. Skill checks roll 2d10 + skill + attribute against a difficulty, with penalties for hunger, exhaustion, stress and wounds.
- **Party**: AI characters in the chat can be given their own sheet with one tap.
- **Time**: nothing is skipped. A jump puts you in transit for its real duration and you live it: each AI reply moves the clock a few minutes, and eating, drinking, washing, unwinding and sleeping are actions that take time. The ship moves along its lane on the map and arrives on its own.
- **Body and wounds**: seven body parts with their own hit points. Bleeding, arterial bleeds, fractures, burns and concussions, each treated with the right item (Dermal Patch, Hemoclamp, Bone-weld Splint, Burn Gel, Medkit, Nanite Injector, Field Surgery Kit and more). A destroyed head is death, a destroyed thorax leaves you down and dying.
- **Armor**: classes 0 to 6 against weapon penetration, with durability. Civilian clothes stop nothing, a marine hardsuit stops most small arms until it wears out, and power armor has its own frame hit points.
- **On-foot combat**: turn-based on a zone map with line of sight, cover, range bands and high ground. Each turn is a move, an action and a bonus action. You play only your own character; party members and enemies act on their own, with morale, retreats and surrenders. The AI starts a fight with `<sf>combat "Cargo bay" pirate 3</sf>` and narrates it once, from the after-action report, when it ends.
- **Ship combat**: a 2D tactical plot resolved in simultaneous 30-second pulses. Hulls run from single-seat fighters and mechs to a 1.6 km capital ship, all built from the same mounts and compartments. Big ships answer the helm slowly (a capital takes four minutes), fighters at once. Sensors and track quality, running dark, jammers, decoys, missiles and point defence, shields, armor by facing, compartment damage, fires, repair teams, heat, reactor overload, emergency jumps that can strand you, escape pods, surrender, salvage and boarding (which hands over to on-foot combat). Start one with `<sf>shipcombat "Tarsis picket" raider 2 allies lancer 1</sf>`.
- **Stations**: what you control in a battle depends on your post. A captain or pilot has everything, a strike force commander also signals other ships, an officer works one console, and crew or passengers get no tactical picture at all. Set with `post gunnery "ISV Castellan" frigate`. The Ship tab is hidden when you have no vessel and no clearance.
- **Death**: checkpoints or permadeath, chosen at creation.
- **Console (HUD)** with tabs: Status, Sheet, Ship, Nav, Gear, Dossier, Log. Full-screen sheet with bottom tabs on phones.
- **Widgets**: on wide screens every panel can be popped out of the console and dragged anywhere. Positions are remembered.
- **Campaign per chat**: state is stored in the chat's metadata, so each chat is its own save. Export and import as JSON.
- **Sector map**: about 28 star systems generated from a seed, with factions, security levels, economies, stations, jump lanes, route plotting, jumps that cost fuel and time, and an orbital view of each system. Pan, pinch and wheel zoom.
- **AI link**: the current state is injected into the prompt, and the AI can change it with a hidden block such as `<sf>credits -200; time +3h</sf>`. The block is removed from the message and shown as small chips. Swiping or deleting that message rolls the change back.
- **Second model**: background jobs can run on a separate, faster model saved as a SillyTavern Connection Profile, or on the chat's own model.
- **Tracker pass** (optional): after each AI reply a model reads it and records what changed (money, items, wounds, time, meals, travel, contacts), so the story model does not have to write tags. Can be used together with tags or instead of them.
- **Lorebook agent** (optional): every few replies an archivist model creates, updates, merges and switches entries in a lorebook bound to the chat, so people, places and plot threads survive summarisation. It only touches its own entries. See them in the Dossier tab under Archive.
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
| `combat`, `wound`, `eat`, `drink`, `sleep`, `wash`, `relax` | `combat "Cargo bay" pirate 3`, `wound larm 20 bleed`, `sleep 6h` |
| `shipcombat`, `post` | `shipcombat "Belt" raider 2 ambush`, `post captain "ISV Castellan" frigate`, `post none` |
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
