<p align="center"><img src="logo.png" alt="ZephyCube" width="160"></p>

# ZephyCubeLogs v1.7.0

Activity logger with an in-game viewer, a chest scanner and a TPS monitor. Originally created by iHarvs (@iharvs). Logs are stored in the world, one set per day.

> [!NOTE]
> This add-on is built for, and tuned specifically for, [WhitemaneSMP](https://whitemane.fun/). Every feature is a separate module: run `/zc:logmodules` to open a menu where you can turn off anything you do not need (or use `/zc:logmodules <module> off`).

## Install

Download `ZephyCubeLogs-v1.7.0-BP.mcaddon` (behavior pack; this add-on has no resource pack) or `ZephyCubeLogs-v1.7.0.mcpack` from the Releases page and open it. Or install by hand: copy the `ZephyCubeLogs` folder into your world's `behavior_packs` folder and add its `uuid` and `version` (from `manifest.json`) to the world's `world_behavior_packs.json`. Needs `@minecraft/server` 2.2.0 and `@minecraft/server-ui` 2.0.0.

## Features (modules)
`/zc:logmodules` opens a menu with a switch per module (from the console it lists them); `/zc:logmodules <module> on|off` also works. Saved in the world. Turning a module off stops new lines of that kind; saved lines stay readable.

| Module | What it logs / does |
| --- | --- |
| `player` | join, leave, spawn, respawn, death inventory, dimension change, gamemode change, emotes, effects, lag lines |
| `blocks` | block break, place, interact, explosions |
| `entities` | entity interact, hurt, death (player kills), projectile hits, taming, mob farm notes |
| `items` | item use, craft, drop, pickup, inventory changes, container take/put, cursor grab/release |
| `redstone` | levers, buttons, pistons, pressure plates, tripwires, target blocks |
| `dupes` | possible-dupe and illegal-stack hints (per-second scan of what players carry) |
| `staff_audit` | staff actions sent by AdminTools (`scriptevent zc:audit player\|action\|target\|detail`) |
| `movement` | throttled movement samples (off in the config by default) |
| `chat` | chat messages |
| `console` | copy of each line to the server console / ContentLog file (needs `content-log-file-enabled=true`), rate limited per player and event type |
| `scanner` | chest scanner: right-click a container to see who opened it, what was taken or put in, and who broke or placed it |
| `player_tag` | on join, saves the player's name and id as the player's dynamic property `player`, so the BedrockToolChest world editor can identify player entities. Merged from "BedrockToolChest - Player Name Tagger" by Rob 'myGen' |

Other built-in behaviour: farm animals killed in bulk are detected as a mob farm and logging stops there; common mob kills and common blocks are kept out of the console file; a LAG line is logged when TPS drops under 15; every player's inventory is snapshotted so a death can list what they carried.

## Commands
| Command | Who | Use |
| --- | --- | --- |
| `/zc:logs` | operators, or players with the `zc_logs` tag | Open the viewer (pick a day, filter Player/Blocks/Entity/Items/Redstone/Dupe/Staff, search) |
| `/zc:tps` | operators | Show server TPS |
| `/zc:logmodules [module] [on\|off]` | operators | Open the modules menu, or turn one module on or off |
| `/zc:perms [player]` | operators | Permissions menu for all ZephyCube add-ons: pick a player, then switch each permission tag on or off (from the console it lists who has what) |

## Items
| Item | Use |
| --- | --- |
| Any item renamed `logs` in an anvil | Use it to open the viewer |
| `zc:chest_scanner` (no recipe: `/give @s zc:chest_scanner`) or any item renamed `scanner` | Right-click a chest, barrel, shulker, hopper, furnace and similar to see its history |

## Tags
| Tag | Effect |
| --- | --- |
| `zc_logs` | Non-operators with this tag can open the viewer and the scanner |

## Permissions menu (`/zc:perms`)
Every permission tag that a ZephyCube add-on reads, in one place. Turning one on adds the tag; turning it off removes the tag and also clears its bit in the AdminTools bitmask tag `zc:p.<hex>` where it has one.

| Permission | Tag | AdminTools bit | Add-on |
| --- | --- | --- | --- |
| Open the logs viewer and chest scanner | `zc_logs` | none | Logs |
| Cross the world border | `zc:border_bypass` | 8 | Border |
| Low-TPS and mob cap alerts | `zc:lag_alert` | 10 | AntiLag |
| Never combat tagged | `zc:combat_bypass` | none | Combat |
| Can hit and be hit on PvE days | `zc:pvpday_bypass` | none | Combat |

## Storage
World properties `zclogs:index`, `zclogs:<day>:<n>` (log pages), `zclog:modules`.

## Notes

- Times use UTC+8 by default; change `timezoneOffsetHours` at the top of `scripts/main.js`.
- To also get readable lines in the ContentLog file, set `content-log-file-enabled=true` in `server.properties`.
- Logs are kept for 7 days (`keepDays`).

## License

MIT, see `LICENSE` (original author: iHarvs, @iharvs).
