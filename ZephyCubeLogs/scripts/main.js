import "./style.js";
import * as mc from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { defineModules } from "./modules.js";
import { registerPerms } from "./perms.js";

const { world, system } = mc;

// Modules (/zc:logmodules opens a menu; /zc:logmodules <module> off also works). Event categories first, then extras.
const modOn = defineModules("zclog", "zc:logmodules", "Logs", [
  { key: "player", label: "player events: join/leave, spawn, deaths, dimension, gamemode, emotes, effects, lag lines" },
  { key: "blocks", label: "block break, place, interact and explosions" },
  { key: "entities", label: "entity interact, hurt, death, projectiles, taming, mob farm notes" },
  { key: "items", label: "item use, craft, drop, pickup, inventory changes, container take/put" },
  { key: "redstone", label: "levers, buttons, pistons, pressure plates, tripwires, target blocks" },
  { key: "dupes", label: "possible dupe and illegal stack detection (and its per-second scan)" },
  { key: "staff_audit", label: "staff actions fed in by AdminTools (zc:audit)" },
  { key: "movement", label: "throttled movement samples" },
  { key: "chat", label: "chat messages" },
  { key: "console", label: "copy of every log line to the server console / ContentLog file" },
  { key: "scanner", label: "chest scanner item (right-click a container to see its history)" },
  { key: "player_tag", label: "store each player's name and id on the player (BedrockToolChest world editor)" },
]);

/*
 * ZephyCubeLogs
 * Author: @iharvs
 *
 * NO Beta APIs are used.
 * Logs are saved inside the world (one set per day) and read in the game:
 *   - type  /zc:logs
 *   - or use an item renamed to "logs" in an anvil
 * Chest scanner: use the Chest Scanner item (no recipe: /give @s zc:chest_scanner) or ANY item renamed to "scanner" in an anvil, and
 *   right-click a chest, barrel, shulker box, hopper, furnace ... to see who
 *   opened it, what was taken / put in, and who broke or placed it.
 * Log file (v1.2.0): every event is also written, in plain readable text, to the
 *   server's ContentLog file (see consoleOutput below).
 * Only operators (or players with the tag "zc_logs") can open the viewer / scanner.
 */

const CONFIG = {
  // Where each event goes besides the in-game database:
  //   "none" = nowhere else (no lag from the server log)
  //   "log"  = also show in the live server console (info level)
  //   "warn" = also show in the console AND write to the ContentLog file (readable text)
  // A script cannot create files itself; the ContentLog file is how Bedrock saves
  // script output. Turn it on in server.properties:  content-log-file-enabled=true
  tpsWarnBelow: 15,              // log a LAG line when TPS drops below this (at most once per 30 s)
  consoleOutput: "warn",
  // Noisy events that are NOT sent to the file/console (they are still in the in-game viewer)
  // The ContentLog stays readable: per player and event type at most consoleBurst lines per consoleWindowSec,
  // then one summary line ("N more ... not written"). The in-game viewer always keeps every event.
  consoleBurst: { default: 6, chat: 20, block_break: 8, block_place: 8, entity_hurt: 3, entity_death: 4, piston: 2, projectile_hit: 3, entity_interact: 4 },
  consoleWindowSec: 10,
  showDimension: false,          // true = add "in overworld" to every location
  // Kills of these mobs by players are not logged at all (no line in the viewer or the console)
  ignoreMobKills: [
    "zombie", "zombie_villager", "zombie_villager_v2", "husk", "drowned", "skeleton", "stray", "bogged", "creeper",
    "spider", "cave_spider", "enderman", "witch", "slime", "magma_cube", "phantom", "silverfish", "zombified_piglin",
    "squid", "glow_squid", "cod", "salmon", "tropical_fish", "pufferfish", "bat"
  ],
  // Farm animals (cow, pig, sheep, chicken ...) are logged normally. If they die in bulk the spot is detected
  // as a mob farm and logging stops there (see farmKills).
  // Common blocks that are NOT written to the ContentLog file/console when broken or placed (still in the in-game viewer).
  // Containers, ores, redstone, TNT, spawners etc. are not listed, so they are still logged.
  consoleIgnoreBlocks: [
    "dirt", "grass_block", "short_grass", "tall_grass", "fern", "large_fern", "grass_path", "dirt_path", "farmland", "coarse_dirt", "rooted_dirt", "mud", "podzol", "mycelium",
    "stone", "cobblestone", "deepslate", "cobbled_deepslate", "tuff", "granite", "diorite", "andesite", "netherrack", "basalt", "blackstone", "end_stone", "cobblestone_wall",
    "sand", "red_sand", "gravel", "sandstone", "clay", "snow", "snow_layer", "ice", "packed_ice", "water", "flowing_water",
    "oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log", "pale_oak_log",
    "oak_leaves", "birch_leaves", "spruce_leaves", "jungle_leaves", "acacia_leaves", "dark_oak_leaves", "mangrove_leaves", "cherry_leaves", "azalea_leaves", "pale_oak_leaves",
    "oak_planks", "spruce_planks", "birch_planks", "short_dry_grass", "tall_dry_grass", "bush", "firefly_bush", "leaf_litter", "vine", "sugar_cane", "bamboo", "kelp", "seagrass", "tall_seagrass",
    "dandelion", "poppy", "cornflower", "azure_bluet", "oxeye_daisy", "wheat", "carrots", "potatoes", "beetroot", "pumpkin", "melon_block", "sweet_berry_bush", "cactus",
    "torch", "wall_torch", "soul_torch", "scaffolding", "air"
  ],
  consoleSkip: ["inventory_change", "cursor_grab", "cursor_release", "item_use", "block_interact",
    "effect_add", "item_drop", "item_pickup", "movement", "container_open", "entity_container_open"],
  scannerItemName: "scanner",    // item renamed to this opens the chest scanner
  scannerMaxResults: 60,         // newest entries shown per scan
  keepDays: 7,                   // older days are deleted automatically
  pageChars: 2500,               // text per page in the viewer
  maxPagesPerDay: 200,           // oldest pages of a day are dropped beyond this
  saveIntervalTicks: 100,        // save to the database every 5 seconds
  viewerTag: "zc_logs",    // non-operators with this tag can also read logs
  viewerItemName: "logs",        // use an item with this name to open the viewer
  timezoneOffsetHours: 8,        // times in the log use this offset from UTC (8 = Philippines)
  movementIntervalTicks: 20,     // 1 second
  movementMinDistance: 10,       // blocks
  maxQueue: 2000,
  logMovement: false,
  logBlockBreak: true,
  logBlockPlace: true,
  logInteract: true,
  logEntityInteract: true,
  logInventory: true,
  logItemUse: true,
  logCombat: true,               // only fights that involve a player
  logDeath: true,                // player deaths and mobs killed by a player
  logJoinLeave: true,
  logDimension: false,
  logContainer: true,            // opening chests etc, and what was taken out or put in
  logCursor: true,               // picking up / putting down an item with the cursor (dragging)
  logSpawn: true,           // first spawn and respawn after death
  logGameMode: true,
  logCraft: true,
  logItemDropPickup: true,  // players only
  logEffects: true,         // players only
  logRedstone: true,        // levers, buttons, pistons, pressure plates, tripwires
  redstoneQuietSeconds: 10, // the same piston/plate is logged at most once in this time
  logExplosion: true,
  logProjectile: true,      // arrows, tridents, snowballs hitting something alive
  logTame: true,
  logEmote: false,
  // Mob farms: when farmKills mobs of one type die within farmRadius blocks inside farmWindowSec seconds, that area is
  // marked as a mob farm. Mob deaths, mob damage and pistons inside it are not logged until farmExpireMin minutes after
  // the last death there. Deaths and damage involving a PLAYER as the victim are always logged.
  farmKills: 15,
  farmWindowSec: 60,
  farmRadius: 24,
  farmExpireMin: 15,
  logChat: true,            // chat messages (needs the chatSend event; skipped with a log line if the server does not offer it)
  logPossibleDupe: true,    // flag items that appear from nowhere
  dupeCheckTicks: 20,       // how often each player is checked (20 = every second)
  dupeMinAmount: 16,        // ordinary items are flagged only if this many appear at once
  dupeAlertOperators: true,  // also send a chat message to online operators
  dupeConfirmChecks: 1,      // a gain must still be unexplained this many checks later before it is flagged
  dupeKitGraceSec: 30,       // after CrossBlades (duel/FFA/kit) activity, skip the dupe check this long (kits and inventory restores add items)
  dupeBulkGainTypes: 5,      // this many new item types at once = a kit or inventory restore, not a dupe
  dupeBreakAllowance: 6,     // items one broken block may explain for 5 seconds (fortune, ores, crops)
  dupePlacedMemoryMin: 30,   // minutes: mining back a block you placed is never a dupe
  logDeathInventory: true,   // list everything a player carried at the moment they died
  // Valuable items: flagged even if just 1 appears from nowhere
  dupeWatchItems: [
    "minecraft:diamond", "minecraft:diamond_block", "minecraft:emerald", "minecraft:emerald_block",
    "minecraft:netherite_ingot", "minecraft:netherite_block", "minecraft:netherite_scrap", "minecraft:ancient_debris",
    "minecraft:gold_block", "minecraft:iron_block", "minecraft:totem_of_undying", "minecraft:elytra",
    "minecraft:enchanted_golden_apple", "minecraft:nether_star", "minecraft:beacon", "minecraft:dragon_egg",
    "minecraft:shulker_shell", "minecraft:undyed_shulker_box", "minecraft:trident", "minecraft:mace",
    "minecraft:heavy_core", "minecraft:end_crystal", "minecraft:tnt"
  ],
};

const lastPos = new Map();
const lastPlaceTick = new Map();
const justPlaced = p => system.currentTick - (lastPlaceTick.get(p?.id) ?? -100) <= 2;

function pos(p) {
  const l = p.location;
  return {
    x: Math.floor(l.x),
    y: Math.floor(l.y),
    z: Math.floor(l.z),
    dimension: p.dimension?.id ?? "unknown"
  };
}

function playerName(p) {
  return p?.name ?? "Unknown";
}

const CONFIG_IGNORE = new Set(CONFIG.consoleIgnoreBlocks);
function safeType(obj) {
  try { return obj?.typeId ?? obj?.type?.id ?? "unknown"; } catch { return "unknown"; }
}

/* ---------- plain-text formatting ---------- */

const short = id => String(id ?? "unknown").replace(/^minecraft:/, "");

// Colors (Minecraft color codes). Change them here if you want other colors.
const COLOR = {
  time: "§7",      // gray
  player: "§b",    // aqua
  xyz: "§e",       // yellow
  block: "§a",     // green
  entity: "§c",    // red
  item: "§d",      // pink
  dimension: "§9", // blue
  text: "§f",      // white
};
const T = COLOR.text;
const cPlayer = n => `${COLOR.player}${n}${T}`;
const cBlock = id => `${COLOR.block}${short(id)}${T}`;
const cEntity = id => `${COLOR.entity}${short(id)}${T}`;
const cItem = id => `${COLOR.item}${short(id)}${T}`;
// A value like "minecraft:zombie" is a mob; anything else is a player name.
const cWho = v => (String(v ?? "").includes(":") ? cEntity(v) : cPlayer(v));
const xyz = l =>
  l && typeof l.x === "number"
    ? `${COLOR.xyz}(X: ${Math.floor(l.x)}, Y: ${Math.floor(l.y)}, Z: ${Math.floor(l.z)})${T}`
    : `${COLOR.xyz}(X: ?, Y: ?, Z: ?)${T}`;
const at = (l, dim) => `at ${xyz(l)}${dim && (CONFIG.showDimension || dim !== "minecraft:overworld") ? ` in ${COLOR.dimension}${short(dim)}${T}` : ""}`;
const itemList = items =>
  (items ?? []).map(i => `${i.amount ?? 1}x ${cItem(i.item)}`).join(", ") || "nothing";

const FORMAT = {
  server_logger_started: () => `=== ZephyCubeLogs started ===`,
  player_join: r => `${cPlayer(r.player)} joined the server`,
  player_leave: r => `${cPlayer(r.player)} left the server`,
  player_spawn: r => `${cPlayer(r.player)} spawned ${at(r.location, r.dimension)}`,
  player_respawn: r => `${cPlayer(r.player)} respawned ${at(r.location, r.dimension)}`,
  block_break: r =>
    `${cPlayer(r.player)} broke ${cBlock(r.block)} (${r.tool === "unknown" ? "empty hand" : "holding " + cItem(r.tool)}) ${at(r.location, r.dimension)}`,
  block_place: r => `${cPlayer(r.player)} placed ${cBlock(r.block)} ${at(r.location, r.dimension)}`,
  block_interact: r => `${cPlayer(r.player)} used ${cBlock(r.block)} ${at(r.location, r.dimension)}`,
  entity_interact: r =>
    `${cPlayer(r.player)} interacted with ${cEntity(r.entity)}${r.targetName ? ` "${r.targetName}"` : ""} ${at(r.location, r.dimension)}`,
  inventory_change: r =>
    `${cPlayer(r.player)} inventory slot ${r.slot}: ${r.oldItem === "unknown" ? "empty" : cItem(r.oldItem)} -> ${r.newItem === "unknown" ? "empty" : cItem(r.newItem)}`,
  item_use: r => `${cPlayer(r.player)} used item ${cItem(r.item)} ${at(r.location, r.dimension)}`,
  entity_hurt: r =>
    `${cWho(r.victim)} took ${Number(r.damage ?? 0).toFixed(1)} damage from ${r.attacker ? cWho(r.attacker) : short(r.cause)} ${at(r.location, r.dimension)}`,
  entity_death: r =>
    r.killer
      ? `${cWho(r.killer)} killed ${cWho(r.entity)} ${at(r.location, r.dimension)}`
      : `${cWho(r.entity)} died (${short(r.cause)}) ${at(r.location, r.dimension)}`,
  dimension_change: r =>
    `${cPlayer(r.player)} went from ${COLOR.dimension}${short(r.from)}${T} to ${COLOR.dimension}${short(r.to)}${T}`,
  container_open: r => `${cPlayer(r.player)} opened ${cBlock(r.block)} ${at(r.location, r.dimension)}`,
  entity_container_open: r => `${cPlayer(r.player)} opened ${cEntity(r.entity)} ${at(r.location, r.dimension)}`,
  movement: r =>
    `${cPlayer(r.player)} moved ${r.distance} blocks from ${xyz(r.from)} to ${xyz(r.to)} ${CONFIG.showDimension ? ` in ${COLOR.dimension}${short(r.to?.dimension)}${T}` : ""}`,
  gamemode_change: r => `${cPlayer(r.player)} changed game mode from ${r.from} to ${r.to}`,
  craft: r => `${cPlayer(r.player)} crafted ${r.amount ?? 1}x ${cItem(r.item)}`,
  item_drop: r => `${cPlayer(r.player)} dropped ${itemList(r.items)} ${at(r.location, r.dimension)}`,
  item_pickup: r => `${cPlayer(r.player)} picked up ${itemList(r.items)} ${at(r.location, r.dimension)}`,
  effect_add: r =>
    `${cPlayer(r.player)} got effect ${short(r.effect)} level ${(r.amplifier ?? 0) + 1} for ${Math.round((r.durationTicks ?? 0) / 20)}s`,
  lever: r => `${cPlayer(r.player)} turned a lever ${r.powered ? "ON" : "OFF"} ${at(r.location, r.dimension)}`,
  button_push: r => `${cWho(r.by)} pushed ${cBlock(r.block)} ${at(r.location, r.dimension)}`,
  explosion: r =>
    `Explosion caused by ${cWho(r.cause)} destroyed ${r.blocksDestroyed} blocks ${at(r.location, r.dimension)}`,
  projectile_hit: r =>
    `${cWho(r.shooter)} hit ${cWho(r.victim)} with ${cEntity(r.projectile)} ${at(r.location, r.dimension)}`,
  entity_tamed: r => `${cWho(r.player)} tamed ${cEntity(r.entity)} ${at(r.location, r.dimension)}`,
  container_take: r =>
    `${cPlayer(r.player)} took ${itemList(r.items)} from ${r.isBlock ? cBlock(r.container) : cEntity(r.container)} ${at(r.location, r.dimension)}`,
  container_put: r =>
    `${cPlayer(r.player)} put ${itemList(r.items)} into ${r.isBlock ? cBlock(r.container) : cEntity(r.container)} ${at(r.location, r.dimension)}`,
  cursor_grab: r => `${cPlayer(r.player)} grabbed ${r.amount ?? 1}x ${cItem(r.item)} with the cursor`,
  cursor_release: r => `${cPlayer(r.player)} placed ${r.amount ?? 1}x ${cItem(r.item)} from the cursor into a slot`,
  piston: r => `${cBlock(r.block)} ${r.extending ? "extended" : "retracted"} ${at(r.location, r.dimension)}`,
  pressure_plate: r => `${cPlayer(r.player)} stepped on ${cBlock(r.block)} ${at(r.location, r.dimension)}`,
  tripwire: r => `${cPlayer(r.player)} tripped a ${cBlock("tripwire")} ${at(r.location, r.dimension)}`,
  target_hit: r => `${cPlayer(r.player)} hit a ${cBlock("target")} block ${at(r.location, r.dimension)}`,
  staff_audit: r => `§l§6STAFF§r§f ${cPlayer(r.player)} ${r.action}${r.target ? ` -> ${r.target}` : ""}${r.detail ? `: ${r.detail}` : ""}`,
  possible_dupe: r =>
    `§l§cPOSSIBLE DUPE§r§f ${cPlayer(r.player)} gained ${itemList(r.items)} from nowhere ${at(r.location, r.dimension)}${r.source ? ` | likely source: ${r.source}` : ""}`,
  illegal_stack: r =>
    `§l§cIMPOSSIBLE STACK§r§f ${cPlayer(r.player)} is holding ${COLOR.item}${short(r.stack)}${T} ${at(r.location, r.dimension)}`,
  death_inventory: r =>
    `§l§6INVENTORY AT DEATH§r§f ${cPlayer(r.player)} (${r.total ?? 0} items) ${at(r.location, r.dimension)}: ` +
    ((r.items ?? []).length ? r.items.map(i => `${COLOR.item}${i}${T}`).join(", ") : "nothing"),
  emote: r => `${cPlayer(r.player)} did an emote`,
  chat: r => `${cPlayer(r.player)}: §f${r.message}`,
  mob_farm: r => `§l§6MOB FARM§r§f ${r.kills} ${short(r.mob)} deaths in ${r.seconds}s ${at(r.location, r.dimension)} - mob deaths, mob damage and pistons within ${r.radius} blocks are no longer logged`,
  mob_farm_end: r => `§l§6MOB FARM ENDED§r§f no deaths for ${r.minutes} min ${at(r.location, r.dimension)} - logging resumes there`,
  server_lag: r => `§l§cLAG§r§f ${r.tps} TPS with ${r.players} players online`,
};

// Which filter button each event belongs to: P player, B blocks, E entity, I items, R redstone
const CATEGORY = {
  server_logger_started: "P", player_join: "P", player_leave: "P", player_spawn: "P", player_respawn: "P",
  death_inventory: "P", dimension_change: "P", gamemode_change: "P", emote: "P", effect_add: "P", movement: "P",
  block_break: "B", block_place: "B", block_interact: "B", explosion: "B",
  entity_interact: "E", entity_hurt: "E", entity_death: "E", projectile_hit: "E", entity_tamed: "E",
  item_use: "I", craft: "I", item_drop: "I", item_pickup: "I", inventory_change: "I",
  container_open: "I", entity_container_open: "I", container_take: "I", container_put: "I",
  cursor_grab: "I", cursor_release: "I",
  staff_audit: "S", possible_dupe: "D", illegal_stack: "D", server_lag: "P", chat: "P", mob_farm: "E", mob_farm_end: "E",
  lever: "R", button_push: "R", piston: "R", pressure_plate: "R", tripwire: "R", target_hit: "R",
};

const CAT_NAME = { P: "PLAYER", B: "BLOCK", E: "ENTITY", I: "ITEM", R: "REDSTONE", D: "DUPE", S: "STAFF" };

const pad = n => String(n).padStart(2, "0");
function timeStamp() {
  const d = new Date(Date.now() + CONFIG.timezoneOffsetHours * 3600000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

const conWin = new Map(); // key -> { start, count, dropped, last, catName }
function conAllow(type, data, line, catName) {
  if (type === "staff_audit") return true; // never rate-limited
  const burst = CONFIG.consoleBurst[type] ?? CONFIG.consoleBurst.default;
  // PvP and every player death are never rate-limited; kills are keyed per killer (they used to share one bucket
  // per cause, so mob kills used up the burst and PvP kills were dropped).
  if (type === "entity_death" && (!data.mobVictim || false)) return true;
  const who = type === "piston" || type === "pressure_plate" || type === "tripwire" ? "" : (data.player ?? data.attacker ?? data.killer ?? data.cause ?? "");
  const key = `${type}|${who}`;
  const now = Date.now();
  let w = conWin.get(key);
  if (!w || now - w.start > CONFIG.consoleWindowSec * 1000) {
    if (w && w.dropped > 0) conSummary(key, w);
    w = { start: now, count: 0, dropped: 0, last: "", catName };
    conWin.set(key, w);
  }
  w.count++;
  if (w.count <= burst) return true;
  w.dropped++; w.last = line;
  return false;
}
function conSummary(key, w) {
  const [type, who] = key.split("|");
  const line = `[ZephyCubeLogs] ${timeStamp()} [${w.catName}] +${w.dropped} more ${type}${who ? " by " + who : ""} in ${CONFIG.consoleWindowSec}s not written here (in-game viewer has all). Last: ${w.last.replace(/^\[ZephyCubeLogs\] \S+ \S+ \[\w+\] /, "")}`;
  if (CONFIG.consoleOutput === "warn") console.warn(line); else console.log(line);
}
system.runInterval(() => {
  const now = Date.now();
  for (const [key, w] of conWin) {
    if (now - w.start > CONFIG.consoleWindowSec * 1000) {
      if (w.dropped > 0) conSummary(key, w);
      conWin.delete(key);
    }
  }
}, 100);

/* ---------- mob farm detection ---------- */

const farms = []; // { dim, x, z, last, mob }
const recentDeaths = new Map(); // `${dim}|${mob}` -> [{ t, x, z }]
const FARM_QUIET = new Set(["entity_hurt", "entity_death", "projectile_hit", "piston"]);

function farmAt(dim, loc) {
  if (!loc) return false;
  const r2 = CONFIG.farmRadius * CONFIG.farmRadius;
  for (const f of farms) {
    if (f.dim !== dim) continue;
    const dx = loc.x - f.x, dz = loc.z - f.z;
    if (dx * dx + dz * dz <= r2) return f;
  }
  return false;
}

function noteMobDeath(ent) {
  try {
    const dim = ent.dimension?.id, loc = ent.location, mob = ent.typeId;
    if (!dim || !loc || !mob) return;
    const now = Date.now();
    const f = farmAt(dim, loc);
    if (f) { f.last = now; return; }
    const key = `${dim}|${mob}`;
    let list = recentDeaths.get(key);
    if (!list) { list = []; recentDeaths.set(key, list); }
    list.push({ t: now, x: loc.x, z: loc.z });
    while (list.length && now - list[0].t > CONFIG.farmWindowSec * 1000) list.shift();
    const r2 = CONFIG.farmRadius * CONFIG.farmRadius;
    const near = list.filter(d => (d.x - loc.x) ** 2 + (d.z - loc.z) ** 2 <= r2);
    if (near.length >= CONFIG.farmKills) {
      const cx = near.reduce((a, d) => a + d.x, 0) / near.length;
      const cz = near.reduce((a, d) => a + d.z, 0) / near.length;
      farms.push({ dim, x: cx, z: cz, last: now, mob });
      recentDeaths.delete(key);
      emit("mob_farm", { mob, kills: near.length, seconds: CONFIG.farmWindowSec, radius: CONFIG.farmRadius, location: { x: cx, y: loc.y, z: cz }, dimension: dim });
    }
    if (recentDeaths.size > 200) recentDeaths.clear();
  } catch {}
}

system.runInterval(() => {
  try {
    const now = Date.now();
    for (let i = farms.length - 1; i >= 0; i--) {
      const f = farms[i];
      if (now - f.last > CONFIG.farmExpireMin * 60000) {
        farms.splice(i, 1);
        emit("mob_farm_end", { minutes: CONFIG.farmExpireMin, location: { x: f.x, y: 64, z: f.z }, dimension: f.dim });
      }
    }
  } catch {}
}, 200);

const MOD_OF = { movement: "movement", chat: "chat" };
const CAT_MOD = { P: "player", B: "blocks", E: "entities", I: "items", R: "redstone", D: "dupes", S: "staff_audit" };
function emit(type, data = {}) {
  if (!modOn(MOD_OF[type] ?? CAT_MOD[CATEGORY[type] ?? "P"])) return;
  if (FARM_QUIET.has(type) && (type === "piston" || data.mobVictim) && farmAt(data.dimension, data.location)) return;
  let text;
  try {
    text = FORMAT[type] ? FORMAT[type](data) : `${type} ${JSON.stringify(data)}`;
  } catch {
    text = type;
  }
  const stamp = timeStamp();
  buffer.push({ day: stamp.slice(0, 10), line: `${CATEGORY[type] ?? "P"}|${COLOR.time}${stamp.slice(11)}${T} ${text}` });
  if (CONFIG.consoleOutput !== "none" && modOn("console") && !CONFIG.consoleSkip.includes(type)) {
    const plain = text.replace(/§./g, ""); // no color codes in the file
    const catName = CAT_NAME[CATEGORY[type] ?? "P"];
    const line = `[ZephyCubeLogs] ${stamp} [${catName}] ${plain}`;
    if ((type === "block_break" || type === "block_place") && CONFIG_IGNORE.has(short(data.block))) { /* common block, not written to the file */ }
    else if (conAllow(type, data, line, catName)) {
      if (CONFIG.consoleOutput === "warn") console.warn(line);
      else console.log(line);
    }
  }
}

const isPlayer = ent => ent?.typeId === "minecraft:player";
// CrossBlades duels / team duels / FFA: players carry a crossblades:* tag. Kept for 10 s after the tag goes (the tag can be cleared before the death event).
const cbSeen = new Map();
function inCrossBlades(ent) {
  try {
    if (!ent) return false;
    if (ent.getTags().some(t => t.startsWith("crossblades:"))) { cbSeen.set(ent.id, system.currentTick); return true; }
  } catch {}
  const t = cbSeen.get(ent?.id);
  return t !== undefined && system.currentTick - t < 200;
}
system.runInterval(() => {
  for (const p of world.getAllPlayers()) inCrossBlades(p);
  if (cbSeen.size > 100) for (const [k, t] of cbSeen) if (system.currentTick - t > 1200) cbSeen.delete(k);
}, 20);
const who = ent => {
  try { return isPlayer(ent) ? playerName(ent) : ent?.nameTag || safeType(ent); } catch { return "unknown"; } // entity may already be removed
};

function subscribe(name, signal, handler) {
  if (!signal) {
    console.warn(`[ZEPHYCUBE_LOGS] Event "${name}" is not available on this server version, skipping it.`);
    return;
  }
  const safe = ev => {
    try { return handler(ev); } catch (err) {
      // An entity that was removed in the same tick (killed, picked up, despawned) throws InvalidEntityError when read: harmless.
      if (String(err?.name ?? err).includes("InvalidEntity") || String(err).includes("Entity being invalid") || String(err).includes("has the Entity been removed")) return;
      throw err;
    }
  };
  try { signal.subscribe(safe); } catch (e) {
    console.warn(`[ZEPHYCUBE_LOGS] Could not listen for "${name}": ${e}`);
  }
}

/* ---------- database: logs are stored inside the world, one set per day ---------- */

const DB_INDEX = "zclogs:index";
const pageKey = (day, n) => `zclogs:${day}:${n}`;
const buffer = []; // lines waiting to be saved: { day, line }

function loadIndex() {
  try { return JSON.parse(world.getDynamicProperty(DB_INDEX) ?? "{}"); } catch { return {}; }
}
function saveIndex(index) {
  world.setDynamicProperty(DB_INDEX, JSON.stringify(index));
}
function deleteDay(index, day) {
  const info = index[day];
  if (!info) return;
  for (let n = info.first; n <= info.last; n++) world.setDynamicProperty(pageKey(day, n), undefined);
  delete index[day];
}

function flushToDatabase() {
  if (buffer.length === 0) return;
  const pending = buffer.splice(0, buffer.length);
  try {
    const index = loadIndex();
    const open = {}; // day -> text of the page currently being filled
    for (const { day, line } of pending) {
      let info = index[day];
      if (!info) {
        info = index[day] = { first: 0, last: 0, lines: 0 };
        open[day] = "";
      } else if (open[day] === undefined) {
        open[day] = world.getDynamicProperty(pageKey(day, info.last)) ?? "";
      }
      if (open[day].length > 0 && open[day].length + line.length + 1 > CONFIG.pageChars) {
        world.setDynamicProperty(pageKey(day, info.last), open[day]);
        info.last++;
        open[day] = "";
        if (info.last - info.first + 1 > CONFIG.maxPagesPerDay) {
          world.setDynamicProperty(pageKey(day, info.first), undefined); // drop the oldest page
          info.first++;
        }
      }
      open[day] += (open[day] ? "\n" : "") + line;
      info.lines++;
    }
    for (const day of Object.keys(open)) world.setDynamicProperty(pageKey(day, index[day].last), open[day]);

    const days = Object.keys(index).sort();
    while (days.length > CONFIG.keepDays) deleteDay(index, days.shift());
    saveIndex(index);
  } catch (e) {
    console.warn(`[ZEPHYCUBE_LOGS] Could not save logs: ${e}`);
  }
}
system.runInterval(flushToDatabase, CONFIG.saveIntervalTicks);

/* ---------- in-game viewer ---------- */

function canViewLogs(player) {
  try {
    if (player.hasTag(CONFIG.viewerTag)) return true;
    const level = player.playerPermissionLevel;
    if (typeof level === "number") return level >= 2;      // operator
    if (typeof level === "string") return level === "Operator";
    if (typeof player.isOp === "function") return player.isOp();
  } catch {}
  return false;
}

// A form cannot open while chat is still open, so keep trying for a few seconds.
async function showForm(form, player) {
  for (let i = 0; i < 100; i++) {
    const res = await form.show(player);
    if (res.cancelationReason !== "UserBusy") return res;
    await new Promise(resolve => system.runTimeout(resolve, 4));
  }
  return { canceled: true };
}

async function openLogMenu(player) {
  try {
    if (!canViewLogs(player)) {
      player.sendMessage("§cOnly operators can read ZephyCubeLogs.");
      return;
    }
    flushToDatabase();
    for (;;) {
      const index = loadIndex();
      const days = Object.keys(index).sort().reverse();
      if (days.length === 0) { player.sendMessage("§eZephyCubeLogs: nothing saved yet."); return; }

      const menu = new ActionFormData().title("ZephyCubeLogs").body("Pick a day:");
      for (const day of days) menu.button(`${day}\n${index[day].lines} lines`);
      const pick = await showForm(menu, player);
      if (pick.canceled) return;

      const day = days[pick.selection];
      const backToDays = await openDay(player, day);
      if (!backToDays) return;
    }
  } catch (e) {
    console.warn(`[ZEPHYCUBE_LOGS] Log menu error: ${e}`);
  }
}

// Filters shown as buttons after you pick a day.
const FILTERS = [
  { label: "All", cat: null },
  { label: "Player\n§8join, leave, spawn, death", cat: "P" },
  { label: "Blocks\n§8break, place, use", cat: "B" },
  { label: "Entity\n§8fights, kills, taming", cat: "E" },
  { label: "Items\n§8chests, drops, crafting", cat: "I" },
  { label: "Redstone\n§8pistons, levers, buttons", cat: "R" },
  { label: "§cPossible dupes\n§8items from nowhere", cat: "D" },
  { label: "Search\n§8player name, block, anything", cat: "search" },
];

const lineCategory = line => (line[1] === "|" ? line[0] : "");
const lineText = line => (line[1] === "|" ? line.slice(2) : line);

function loadPages(day, cat, search) {
  const info = loadIndex()[day];
  if (!info) return null;
  const needle = search ? search.toLowerCase() : null;
  const pages = [];
  let current = "";
  for (let n = info.first; n <= info.last; n++) {
    const raw = world.getDynamicProperty(pageKey(day, n));
    if (!raw) continue;
    for (const line of raw.split("\n")) {
      if (cat && lineCategory(line) !== cat) continue;
      const text = lineText(line);
      if (needle && !text.replace(/§./g, "").toLowerCase().includes(needle)) continue;
      if (current && current.length + text.length + 2 > CONFIG.pageChars) { pages.push(current); current = ""; }
      current += (current ? "\n\n" : "") + text; // blank line between logs
    }
  }
  if (current) pages.push(current);
  return pages;
}

async function openDay(player, day) {
  for (;;) {
    const menu = new ActionFormData().title("ZephyCubeLogs").body(`§l§6${day}§r§f\nWhat do you want to see?`);
    for (const f of FILTERS) menu.button(f.label);
    menu.button("Back to days");
    const pick = await showForm(menu, player);
    if (pick.canceled) return false;
    if (pick.selection >= FILTERS.length) return true;

    const filter = FILTERS[pick.selection];
    let cat = filter.cat, search = null, label = filter.label.split("\n")[0];
    if (cat === "search") {
      const ask = new ModalFormData().title("ZephyCubeLogs").textField("Show only logs containing:", "player name, block, item ...");
      const res = await showForm(ask, player);
      if (res.canceled) continue;
      search = String(res.formValues?.[0] ?? "").trim();
      if (!search) continue;
      cat = null;
      label = `Search "${search}"`;
    }
    const keepOpen = await viewPages(player, day, cat, search, label);
    if (!keepOpen) return false;
  }
}

// Returns true to go back to the filter buttons, false if the player closed the menu.
async function viewPages(player, day, cat, search, label) {
  let page = null; // null = newest
  let pages = null;
  for (;;) {
    if (!pages) { flushToDatabase(); pages = loadPages(day, cat, search) ?? []; }
    if (page === null || page >= pages.length) page = pages.length - 1;
    if (page < 0) page = 0;

    const header = `§l§6${day}§r§f - ${label} - page ${pages.length ? page + 1 : 0} of ${pages.length}`;
    const form = new ActionFormData()
      .title("ZephyCubeLogs")
      .body(`${header}\n\n${pages[page] ?? "§7Nothing here yet."}`);
    const buttons = [];
    if (page > 0) { form.button("Older"); buttons.push("older"); }
    if (page < pages.length - 1) { form.button("Newer"); buttons.push("newer"); }
    form.button("Refresh"); buttons.push("refresh");
    form.button("Back"); buttons.push("back");

    const res = await showForm(form, player);
    if (res.canceled) return false;
    const action = buttons[res.selection];
    if (action === "older") page--;
    else if (action === "newer") page++;
    else if (action === "refresh") { pages = null; page = null; }
    else if (action === "back") return true;
  }
}


/* ---------- TPS monitor (/zc:tps) ---------- */

const tpsLog = []; // { t, tps }, one sample every 5 s, kept for 5 minutes
let tpsLastWall = null, tpsLastTick = 0, tpsLastWarn = 0, tpsStart = null;
try {
system.runInterval(() => {
  try {
    const now = Date.now(), tick = system.currentTick;
    if (tpsStart === null) tpsStart = now;
    const dt = tpsLastWall === null ? 0 : (now - tpsLastWall) / 1000;
    if (dt > 0.5) {
      const tps = Math.min(20, (tick - tpsLastTick) / dt);
      tpsLog.push({ t: now, tps });
      while (tpsLog.length && now - tpsLog[0].t > 300000) tpsLog.shift();
      if (tps < CONFIG.tpsWarnBelow && now - tpsLastWarn > 30000 && now - tpsStart > 120000) { // not during the first 2 minutes (startup)
        tpsLastWarn = now;
        emit("server_lag", { tps: tps.toFixed(1), players: world.getAllPlayers().length });
      }
    }
    tpsLastWall = now; tpsLastTick = tick;
  } catch {}
}, 100);
} catch (e) { console.warn(`[ZEPHYCUBE_LOGS] TPS sampler not started: ${e}`); }

function avgTps(sec) {
  const now = Date.now();
  const a = tpsLog.filter(x => now - x.t <= sec * 1000);
  return a.length ? a.reduce((sum, x) => sum + x.tps, 0) / a.length : null;
}

function tpsReport() {
  const f = v => (v === null ? "n/a" : v.toFixed(1));
  const c = v => (v === null ? "§7" : v >= 18 ? "§a" : v >= 15 ? "§e" : "§c");
  const n10 = avgTps(10), m1 = avgTps(60), m5 = avgTps(300);
  const worst = tpsLog.length ? Math.min(...tpsLog.map(x => x.tps)) : null;
  let ents = 0;
  try { for (const d of ["overworld", "nether", "the_end"]) ents += world.getDimension(d).getEntities().length; } catch {}
  return `§6[ZephyCubeLogs] TPS§r now ${c(n10)}${f(n10)}§r | 1m ${c(m1)}${f(m1)}§r | 5m ${c(m5)}${f(m5)}§r | worst ${c(worst)}${f(worst)}§r | players ${world.getAllPlayers().length} | entities ${ents}`;
}

// Way 1: the commands /zc:logs and /zc:tps (works with cheats off). A pack can only use ONE command namespace.
try {
  system.beforeEvents.startup.subscribe(init => {
    try {
      init.customCommandRegistry.registerCommand(
        {
          name: "zc:logs",
          description: "Open the ZephyCubeLogs viewer",
          permissionLevel: mc.CommandPermissionLevel?.Any ?? 0,
          cheatsRequired: false
        },
        origin => {
          const player = origin.sourceEntity;
          if (player?.typeId === "minecraft:player") system.run(() => openLogMenu(player));
          return { status: mc.CustomCommandStatus?.Success ?? 0 };
        }
      );
    } catch (e) {
      console.warn(`[ZEPHYCUBE_LOGS] Could not register /zc:logs: ${e}`);
    }
    console.warn("[ZEPHYCUBE_LOGS] registering commands: zc:logs, zc:tps, zc:perms");
    try { registerPerms(init); } catch (e) { console.warn(`[ZEPHYCUBE_LOGS] Could not register /zc:perms: ${e}`); }
    try {
      init.customCommandRegistry.registerCommand(
        {
          name: "zc:tps",
          description: "Show server TPS (staff)",
          permissionLevel: mc.CommandPermissionLevel?.Any ?? 0,
          cheatsRequired: false
        },
        origin => {
          const player = origin.sourceEntity;
          const isPlayer = player?.typeId === "minecraft:player";
          if (isPlayer && !canViewLogs(player)) return { status: mc.CustomCommandStatus?.Failure ?? 1, message: "Staff only." };
          const text = tpsReport();
          if (isPlayer) { system.run(() => { try { player.sendMessage(text); } catch {} }); return { status: mc.CustomCommandStatus?.Success ?? 0 }; }
          return { status: mc.CustomCommandStatus?.Success ?? 0, message: text.replace(/§./g, "") };
        }
      );
    } catch (e) {
      console.warn(`[ZEPHYCUBE_LOGS] Could not register /zc:tps: ${e}`);
    }
  });
} catch (e) {
  console.warn(`[ZEPHYCUBE_LOGS] Custom commands are not available on this server version: ${e}`);
}

// Way 2: use (right click / long press) an item renamed to "logs" in an anvil
subscribe("itemUse", world.afterEvents.itemUse, e => {
  if ((e.itemStack?.nameTag ?? "").trim().toLowerCase() !== CONFIG.viewerItemName) return;
  if (e.source?.typeId === "minecraft:player") openLogMenu(e.source);
});

/* ---------- chest scanner: right-click a container with an item renamed "scanner" ---------- */

const SCANNER_ITEM_ID = "zc:chest_scanner"; // craftable / /give item
const isScannerItem = item =>
  item?.typeId === SCANNER_ITEM_ID || (item?.nameTag ?? "").trim().toLowerCase() === CONFIG.scannerItemName;
const SCANNABLE = /(^|:)(chest|trapped_chest|barrel|hopper|dropper|dispenser|furnace|blast_furnace|smoker|brewing_stand|chiseled_bookshelf|crafter)$|shulker_box$|copper_chest$/;
const DOUBLE_CHEST = /(^|:)(chest|trapped_chest)$|copper_chest$/;
const LOC_RE = /\(X: (-?\d+), Y: (-?\d+), Z: (-?\d+)\)/;

// The block itself, plus the neighbouring half when it is a double chest.
function scanTargets(block) {
  const list = [{ x: block.location.x, y: block.location.y, z: block.location.z }];
  if (DOUBLE_CHEST.test(block.typeId)) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      try {
        const n = block.dimension.getBlock({ x: block.location.x + dx, y: block.location.y, z: block.location.z + dz });
        if (n && n.typeId === block.typeId) list.push({ x: n.location.x, y: n.location.y, z: n.location.z });
      } catch {}
    }
  }
  return list;
}

// Does this stored log line describe the container at one of these positions?
function lineMatchesContainer(line, targets, dimShort) {
  const cat = lineCategory(line);
  if (cat !== "I" && cat !== "B") return false;
  const t = lineText(line).replace(/§./g, "");
  const m = LOC_RE.exec(t);
  if (!m) return false;
  // Lines name the dimension only outside the overworld (or with showDimension); no suffix means overworld
  const dm = /\) in ([a-z_]+)/.exec(t);
  if ((dm ? dm[1] : "overworld") !== dimShort) return false;
  if (!targets.some(p => Math.floor(p.x) === +m[1] && Math.floor(p.y) === +m[2] && Math.floor(p.z) === +m[3])) return false;
  if (cat === "I") return /\bopened\b|\btook\b.+\bfrom\b|\bput\b.+\binto\b/.test(t);
  return /\bbroke\b|\bplaced\b/.test(t);
}

// Newest first, across all saved days.
function scanContainerHistory(targets, dimShort) {
  flushToDatabase();
  const index = loadIndex();
  const out = [];
  for (const day of Object.keys(index).sort().reverse()) {
    const info = index[day];
    for (let n = info.last; n >= info.first; n--) {
      const raw = world.getDynamicProperty(pageKey(day, n));
      if (!raw) continue;
      const lines = raw.split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lineMatchesContainer(lines[i], targets, dimShort)) continue;
        out.push(`${COLOR.time}${day.slice(5)}${T} ${lineText(lines[i])}`);
        if (out.length >= CONFIG.scannerMaxResults) return out;
      }
    }
  }
  return out;
}

function pageEntries(entries) {
  const pages = [];
  let current = "";
  for (const text of entries) {
    if (current && current.length + text.length + 2 > CONFIG.pageChars) { pages.push(current); current = ""; }
    current += (current ? "\n\n" : "") + text;
  }
  if (current) pages.push(current);
  return pages;
}

async function openScanner(player, block) {
  try {
    const type = block.typeId;
    const l = block.location;
    const dim = block.dimension.id;
    const targets = scanTargets(block);
    const entries = scanContainerHistory(targets, short(dim));
    const pages = pageEntries(entries);
    let page = 0;
    const header = `§l§6${short(type)}§r§f ${xyz(l)} in ${COLOR.dimension}${short(dim)}${T}` +
      (targets.length > 1 ? "\n§7(includes the other half of the double chest)§f" : "") +
      `\n§7Newest first, showing ${entries.length} of the last ${CONFIG.keepDays} days${entries.length >= CONFIG.scannerMaxResults ? " (limit reached)" : ""}§f`;
    for (;;) {
      const form = new ActionFormData().title("Chest Scanner")
        .body(`${header} - page ${pages.length ? page + 1 : 0}/${pages.length}\n\n${pages[page] ?? "§7No history for this container."}`);
      const buttons = [];
      if (page < pages.length - 1) { form.button("Older"); buttons.push("older"); }
      if (page > 0) { form.button("Newer"); buttons.push("newer"); }
      form.button("Close"); buttons.push("close");
      const res = await showForm(form, player);
      if (res.canceled) return;
      const action = buttons[res.selection];
      if (action === "older") page++;
      else if (action === "newer") page--;
      else return;
    }
  } catch (e) {
    console.warn(`[ZEPHYCUBE_LOGS] Scanner error: ${e}`);
  }
}

subscribe("playerInteractWithBlock (scanner)", world.beforeEvents.playerInteractWithBlock, e => {
  if (!modOn("scanner") || !isScannerItem(e.itemStack)) return;
  if (!SCANNABLE.test(e.block?.typeId ?? "")) return;
  if (!canViewLogs(e.player)) return; // everyone else just uses the item normally
  e.cancel = true;                    // do not open the container
  const { player, block } = e;
  system.run(() => openScanner(player, block));
});


if (CONFIG.logJoinLeave) {
  subscribe("playerJoin", world.afterEvents.playerJoin, e => {
    emit("player_join", { player: e.playerName ?? "Unknown" });
  });

  subscribe("playerLeave", world.afterEvents.playerLeave, e => {
    emit("player_leave", { player: e.playerName ?? "Unknown" });
    lastPos.delete(e.playerId);
    lastPlaceTick.delete(e.playerId);
  });
}

if (CONFIG.logBlockBreak) {
  subscribe("playerBreakBlock", world.afterEvents.playerBreakBlock, e => {
    emit("block_break", {
      player: playerName(e.player),
      block: safeType(e.brokenBlockPermutation),
      tool: safeType(e.itemStackBeforeBreak),
      location: e.block?.location,
      dimension: e.dimension?.id
    });
  });
}

if (CONFIG.logBlockPlace) {
  subscribe("playerPlaceBlock", world.afterEvents.playerPlaceBlock, e => {
    lastPlaceTick.set(e.player?.id, system.currentTick);
    emit("block_place", {
      player: playerName(e.player),
      block: safeType(e.block?.permutation),
      location: e.block?.location,
      dimension: e.dimension?.id
    });
  });
}

if (CONFIG.logInteract) {
  subscribe("playerInteractWithBlock", world.afterEvents.playerInteractWithBlock, e => {
    if (!e.isFirstEvent) return;
    if (justPlaced(e.player)) return; // part of placing a block, already logged
    // Buckets and fire are not block placements for the API: log what they put down (lava, powder snow, water, fire)
    const placedByItem = { "minecraft:lava_bucket": "lava", "minecraft:powder_snow_bucket": "powder_snow", "minecraft:water_bucket": "water", "minecraft:flint_and_steel": "fire", "minecraft:fire_charge": "fire" }[e.itemStack?.typeId];
    if (placedByItem) {
      const o = { Up: [0, 1, 0], Down: [0, -1, 0], North: [0, 0, -1], South: [0, 0, 1], East: [1, 0, 0], West: [-1, 0, 0] }[e.blockFace] ?? [0, 0, 0];
      const bl = e.block?.location;
      lastPlaceTick.set(e.player?.id, system.currentTick);
      emit("block_place", {
        player: playerName(e.player),
        block: "minecraft:" + placedByItem,
        location: bl ? { x: bl.x + o[0], y: bl.y + o[1], z: bl.z + o[2] } : bl,
        dimension: e.block?.dimension?.id
      });
      return;
    }
    emit("block_interact", {
      player: playerName(e.player),
      block: safeType(e.block?.permutation),
      location: e.block?.location,
      face: e.blockFace,
      item: safeType(e.itemStack),
      dimension: e.block?.dimension?.id
    });
  });
}

if (CONFIG.logEntityInteract) {
  subscribe("playerInteractWithEntity", world.afterEvents.playerInteractWithEntity, e => {
    emit("entity_interact", {
      player: playerName(e.player),
      entity: safeType(e.target),
      targetName: (() => { try { return e.target?.nameTag ?? ""; } catch { return ""; } })(),
      location: (() => { try { return e.target?.location; } catch { return undefined; } })(),
      dimension: (() => { try { return e.target?.dimension?.id; } catch { return undefined; } })()
    });
  });
}

if (CONFIG.logInventory) {
  subscribe("playerInventoryItemChange", world.afterEvents.playerInventoryItemChange, e => {
    emit("inventory_change", {
      player: playerName(e.player),
      slot: e.slot,
      oldItem: safeType(e.beforeItemStack ?? e.oldItemStack),
      newItem: safeType(e.itemStack ?? e.newItemStack)
    });
  });
}

if (CONFIG.logItemUse) {
  subscribe("itemUse", world.afterEvents.itemUse, e => {
    if (justPlaced(e.source)) return; // part of placing a block, already logged
    if ((e.itemStack?.nameTag ?? "").trim().toLowerCase() === CONFIG.viewerItemName) return;
    if (isScannerItem(e.itemStack)) return;
    emit("item_use", {
      player: playerName(e.source),
      item: safeType(e.itemStack),
      location: e.source?.location,
      dimension: e.source?.dimension?.id
    });
  });
}

if (CONFIG.logCombat) {
  subscribe("entityHurt", world.afterEvents.entityHurt, e => {
    const victim = e.hurtEntity;
    const attacker = e.damageSource?.damagingEntity;
    if (!victim) return;
    let tamedVictim = false;
    try { tamedVictim = !isPlayer(victim) && victim.hasComponent("minecraft:is_tamed"); } catch {}
    if (!tamedVictim && (!isPlayer(victim) || !isPlayer(attacker))) return; // damage lines: player vs player, or anyone hurting a tamed animal
    if (inCrossBlades(victim) || inCrossBlades(attacker)) return; // duels / FFA are not PvP
    emit("entity_hurt", {
      victim: who(victim),
      mobVictim: !isPlayer(victim),
      attacker: attacker ? who(attacker) : "",
      cause: e.damageSource?.cause,
      damage: e.damage,
      location: victim.location,
      dimension: victim.dimension?.id
    });
  });
}

// ---- Inventory snapshot, so a death can list what the player was carrying ----
// By the time the death event fires the inventory is already empty, so the
// last known contents are kept and written out when the player dies.
const invSnapshots = new Map(); // player id -> { list: string[], count: number }
const invDirty = new Set();
const lastFull = new Map(); // player id -> last NON-empty snapshot { list, count, tick }
function describeStack(stack) {
  let t = `${stack.amount}x ${short(stack.typeId)}`;
  try { if (stack.nameTag) t += ` "${stack.nameTag}"`; } catch {}
  try {
    const ench = stack.getComponent("minecraft:enchantable")?.getEnchantments?.() ?? [];
    if (ench.length) t += ` [${ench.map(en => `${short(en.type?.id ?? en.type)} ${en.level}`).join(", ")}]`;
  } catch {}
  return t;
}
function snapshotInventory(player) {
  try {
    const parts = [];
    const plain = new Map(); // identical plain stacks are merged: 3 stacks of 64 dirt = 192x dirt
    let count = 0;
    const take = (stack, tag) => {
      if (!stack) return;
      count += stack.amount;
      const d = describeStack(stack);
      const isPlain = d === `${stack.amount}x ${short(stack.typeId)}`;
      if (isPlain && !tag) plain.set(stack.typeId, (plain.get(stack.typeId) ?? 0) + stack.amount);
      else parts.push(tag ? `${tag}: ${d}` : d);
    };
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (inv) for (let i = 0; i < inv.size; i++) take(inv.getItem(i), "");
    try {
      const eq = player.getComponent("minecraft:equippable");
      if (eq) for (const slot of ["Head", "Chest", "Legs", "Feet", "Offhand"]) take(eq.getEquipment(slot), slot.toLowerCase());
    } catch {}
    for (const [id, n] of plain) parts.push(`${n}x ${short(id)}`);
    let loc, dim;
    try { loc = player.location; dim = player.dimension?.id; } catch {}
    const snap = { list: parts, count, loc, dim, tick: system.currentTick };
    invSnapshots.set(player.id, snap);
    if (count > 0) lastFull.set(player.id, snap);
  } catch {}
}
if (CONFIG.logDeathInventory) {
  subscribe("playerInventoryItemChange (snapshot)", world.afterEvents.playerInventoryItemChange, e => {
    if (e.player) invDirty.add(e.player.id);
  });
  subscribe("entityHurt (snapshot)", world.afterEvents.entityHurt, e => {
    if (!isPlayer(e.hurtEntity)) return;
    const id = e.hurtEntity.id, last = invSnapshots.get(id);
    if (last && !invDirty.has(id) && system.currentTick - last.tick < 10) return; // unchanged and fresh: no need to scan 40 slots on every hit
    snapshotInventory(e.hurtEntity); // fresh copy right before a possible death
  });
  subscribe("playerLeave (snapshot)", world.afterEvents.playerLeave, e => { invSnapshots.delete(e.playerId); invDirty.delete(e.playerId); lastFull.delete(e.playerId); });
  system.runInterval(() => {
    for (const p of world.getAllPlayers()) {
      if (invDirty.has(p.id) || !invSnapshots.has(p.id)) { invDirty.delete(p.id); snapshotInventory(p); }
    }
  }, 10);
  system.runInterval(() => { for (const p of world.getAllPlayers()) snapshotInventory(p); }, 100);
}

if (CONFIG.logDeath) {
  subscribe("entityDie", world.afterEvents.entityDie, e => {
    const ent = e.deadEntity;
    const killer = e.damageSource?.damagingEntity;
    if (ent && !isPlayer(ent)) noteMobDeath(ent);
    if (!isPlayer(ent) && !isPlayer(killer)) return; // ignore mobs dying on their own
    if (inCrossBlades(ent) || inCrossBlades(killer)) return; // duels / FFA: no kill line, no death inventory
    if (!isPlayer(ent) && CONFIG.ignoreMobKills.includes(String(ent?.typeId ?? "").replace("minecraft:", ""))) return; // common mobs: not logged
    let loc, dimId;
    try { loc = ent?.location; dimId = ent?.dimension?.id; } catch {}
    const snap = invSnapshots.get(ent?.id);
    if (!loc && snap) { loc = snap.loc; dimId = snap.dim; }
    emit("entity_death", {
      mobVictim: !isPlayer(ent),
      entity: who(ent),
      killer: killer ? who(killer) : "",
      cause: e.damageSource?.cause,
      location: loc,
      dimension: dimId
    });
    if (CONFIG.logDeathInventory && isPlayer(ent)) {
      // The gravestone/keepInventory logic empties the inventory around the death, so an empty snapshot
      // taken within 5 s of the death is replaced by the last non-empty one.
      let use = snap;
      const full = lastFull.get(ent.id);
      if ((!use || use.count === 0) && full && system.currentTick - full.tick < 100) use = full;
      emit("death_inventory", {
        player: playerName(ent),
        items: use?.list ?? [],
        total: use?.count ?? 0,
        location: loc,
        dimension: dimId
      });
    }
  });
}

if (CONFIG.logDimension) {
  subscribe("playerDimensionChange", world.afterEvents.playerDimensionChange, e => {
    emit("dimension_change", {
      player: playerName(e.player),
      from: e.fromDimension?.id,
      to: e.toDimension?.id,
      location: e.player?.location
    });
  });
}

if (CONFIG.logContainer) {
  // What was inside a container when a player opened it, so we can tell what
  // they took or put in when they close it.
  const openContainers = new Map(); // player id -> { name, isBlock, location, dimension, before }

  const countItems = container => {
    const counts = {};
    if (!container) return null;
    for (let i = 0; i < container.size; i++) {
      const stack = container.getItem(i);
      if (stack) counts[stack.typeId] = (counts[stack.typeId] ?? 0) + stack.amount;
    }
    return counts;
  };
  const inventoryOf = target => {
    try { return target?.getComponent("minecraft:inventory")?.container; } catch { return undefined; }
  };

  const onOpen = (player, target, isBlock) => {
    if (!isPlayer(player)) return;
    const name = isBlock ? safeType(target?.permutation) : safeType(target);
    const info = {
      name, isBlock,
      location: target?.location,
      dimension: target?.dimension?.id,
      before: null
    };
    try { info.before = countItems(inventoryOf(target)); } catch {}
    openContainers.set(player.id, info);
    emit(isBlock ? "container_open" : "entity_container_open", {
      player: playerName(player),
      block: name, entity: name,
      location: info.location, dimension: info.dimension
    });
  };

  const onClose = (player, target) => {
    if (!isPlayer(player)) return;
    const info = openContainers.get(player.id);
    openContainers.delete(player.id);
    if (!info?.before) return;
    let after = null;
    try { after = countItems(inventoryOf(target)); } catch {}
    if (!after) return;
    const took = [], put = [];
    for (const id of new Set([...Object.keys(info.before), ...Object.keys(after)])) {
      const diff = (after[id] ?? 0) - (info.before[id] ?? 0);
      if (diff < 0) took.push({ item: id, amount: -diff });
      else if (diff > 0) put.push({ item: id, amount: diff });
    }
    const base = {
      player: playerName(player),
      container: info.name, isBlock: info.isBlock,
      location: info.location, dimension: info.dimension
    };
    if (took.length) emit("container_take", { ...base, items: took });
    if (put.length) emit("container_put", { ...base, items: put });
  };

  subscribe("blockContainerOpened", world.afterEvents.blockContainerOpened, e =>
    onOpen(e.openSource?.entity ?? e.player, e.block, true));
  subscribe("blockContainerClosed", world.afterEvents.blockContainerClosed, e =>
    onClose(e.closeSource?.entity ?? e.player, e.block));
  subscribe("entityContainerOpened", world.afterEvents.entityContainerOpened, e =>
    onOpen(e.openSource?.entity ?? e.player, e.entity, false));
  subscribe("entityContainerClosed", world.afterEvents.entityContainerClosed, e =>
    onClose(e.closeSource?.entity ?? e.player, e.entity));
  subscribe("playerLeave", world.afterEvents.playerLeave, e => openContainers.delete(e.playerId));
}

if (CONFIG.logCursor) {
  subscribe("playerCursorItemGrab", world.afterEvents.playerCursorItemGrab, e => {
    emit("cursor_grab", { player: playerName(e.player), item: safeType(e.item), amount: e.item?.amount });
  });
  subscribe("playerCursorItemRelease", world.afterEvents.playerCursorItemRelease, e => {
    emit("cursor_release", { player: playerName(e.player), item: safeType(e.item), amount: e.item?.amount });
  });
}

// ---- Extra events (v1.1.0). Any event your server version does not have is
// ---- skipped with a "Failed subscription" warning; the rest keep working.


if (CONFIG.logSpawn) {
  subscribe("playerSpawn", world.afterEvents.playerSpawn, e => {
    emit(e.initialSpawn ? "player_spawn" : "player_respawn", {
      player: playerName(e.player),
      location: e.player?.location,
      dimension: e.player?.dimension?.id
    });
  });
}

// Staff audit feed from AdminTools: scriptevent zc:audit player|action|target|detail (script-sent only)
try {
  system.afterEvents.scriptEventReceive.subscribe(e => {
    if (e.id !== "zc:audit" || e.sourceType !== mc.ScriptEventSource.Server) return;
    const [player = "?", action = "?", target = "", ...rest] = String(e.message).split("|");
    emit("staff_audit", { player, action, target, detail: rest.join("|") });
  });
} catch {}

if (CONFIG.logGameMode) {
  subscribe("playerGameModeChange", world.afterEvents.playerGameModeChange, e => {
    if (e.fromGameMode === e.toGameMode) return;
    emit("gamemode_change", {
      player: playerName(e.player),
      from: e.fromGameMode,
      to: e.toGameMode
    });
  });
}

if (CONFIG.logCraft) {
  subscribe("playerCraftRecipe", world.afterEvents.playerCraftRecipe, e => {
    emit("craft", {
      player: playerName(e.player),
      item: safeType(e.itemStack),
      amount: e.itemStack?.amount,
      block: safeType(e.block)
    });
  });
}

if (CONFIG.logItemDropPickup) {
  subscribe("entityItemDrop", world.afterEvents.entityItemDrop, e => {
    if (!isPlayer(e.entity)) return;
    const items = (e.items ?? []).map(it => {
      try {
        const stack = it.getComponent("minecraft:item")?.itemStack;
        return { item: safeType(stack), amount: stack?.amount };
      } catch { return { item: "unknown" }; }
    });
    emit("item_drop", {
      player: playerName(e.entity),
      items,
      location: e.entity?.location,
      dimension: e.entity?.dimension?.id
    });
  });

  subscribe("entityItemPickup", world.afterEvents.entityItemPickup, e => {
    if (!isPlayer(e.entity)) return;
    emit("item_pickup", {
      player: playerName(e.entity),
      items: (e.items ?? []).map(stack => ({ item: safeType(stack), amount: stack?.amount })),
      location: e.entity?.location,
      dimension: e.entity?.dimension?.id
    });
  });
}

if (CONFIG.logEffects) {
  subscribe("effectAdd", world.afterEvents.effectAdd, e => {
    if (!isPlayer(e.entity)) return;
    emit("effect_add", {
      player: playerName(e.entity),
      effect: safeType(e.effect),
      amplifier: e.effect?.amplifier,
      durationTicks: e.effect?.duration
    });
  });
}

if (CONFIG.logRedstone) {
  subscribe("leverAction", world.afterEvents.leverAction, e => {
    emit("lever", {
      player: playerName(e.player),
      powered: e.isPowered,
      location: e.block?.location,
      dimension: e.dimension?.id
    });
  });

  subscribe("buttonPush", world.afterEvents.buttonPush, e => {
    if (!isPlayer(e.source)) return;
    emit("button_push", {
      by: who(e.source),
      block: safeType(e.block),
      location: e.block?.location,
      dimension: e.dimension?.id
    });
  });
}

if (CONFIG.logExplosion) {
  subscribe("explosion", world.afterEvents.explosion, e => {
    let blocks = [];
    try { blocks = e.getImpactedBlocks(); } catch {}
    emit("explosion", {
      cause: e.source ? who(e.source) : "unknown",
      blocksDestroyed: blocks.length,
      location: e.source?.location ?? blocks[0]?.location,
      dimension: e.dimension?.id
    });
  });
}

if (CONFIG.logProjectile) {
  subscribe("projectileHitEntity", world.afterEvents.projectileHitEntity, e => {
    if (!isPlayer(e.source)) return;
    let victim;
    try { victim = e.getEntityHit()?.entity; } catch {}
    emit("projectile_hit", {
      shooter: e.source ? who(e.source) : "unknown",
      projectile: safeType(e.projectile),
      mobVictim: !!victim && !isPlayer(victim),
      victim: victim ? who(victim) : "unknown",
      location: e.location,
      dimension: e.dimension?.id
    });
  });
}

if (CONFIG.logTame) {
  subscribe("entityTamed", world.afterEvents.entityTamed, e => {
    emit("entity_tamed", {
      player: who(e.tamingEntity),
      entity: safeType(e.entity),
      location: e.entity?.location,
      dimension: e.entity?.dimension?.id
    });
  });
}

if (CONFIG.logChat) {
  subscribe("chatSend", world.afterEvents?.chatSend, e => {
    emit("chat", { player: playerName(e.sender), message: String(e.message ?? "").replace(/§./g, "").slice(0, 300) });
  });
}

if (CONFIG.logEmote) {
  subscribe("playerEmote", world.afterEvents.playerEmote, e => {
    emit("emote", { player: playerName(e.player), emote: e.personaPieceId });
  });
}

if (CONFIG.logRedstone) {
  // Farms and clocks fire these many times a second, so each block is logged
  // at most once per CONFIG.redstoneQuietSeconds.
  const lastSeen = new Map();
  const quiet = (kind, block, dimension) => {
    const l = block?.location;
    const key = `${kind}:${dimension?.id}:${l?.x},${l?.y},${l?.z}`;
    const now = system.currentTick;
    if (now - (lastSeen.get(key) ?? -1e9) < CONFIG.redstoneQuietSeconds * 20) return true;
    if (lastSeen.size > 5000) lastSeen.clear();
    lastSeen.set(key, now);
    return false;
  };

  subscribe("pistonActivate", world.afterEvents.pistonActivate, e => {
    if (quiet("piston", e.block, e.dimension)) return;
    emit("piston", {
      block: safeType(e.block),
      extending: e.isExpanding,
      location: e.block?.location,
      dimension: e.dimension?.id
    });
  });

  subscribe("pressurePlatePush", world.afterEvents.pressurePlatePush, e => {
    if (!isPlayer(e.source)) return; // mobs walking on plates would flood the log
    if (quiet("plate", e.block, e.dimension)) return;
    emit("pressure_plate", {
      player: playerName(e.source),
      block: safeType(e.block),
      location: e.block?.location,
      dimension: e.dimension?.id
    });
  });

  subscribe("tripWireTrip", world.afterEvents.tripWireTrip, e => {
    if (!e.isPowered) return;
    const player = (e.sources ?? []).find(isPlayer);
    if (!player) return;
    if (quiet("tripwire", e.block, e.dimension)) return;
    emit("tripwire", {
      player: playerName(player),
      location: e.block?.location,
      dimension: e.dimension?.id
    });
  });

  subscribe("targetBlockHit", world.afterEvents.targetBlockHit, e => {
    if (!isPlayer(e.source)) return;
    emit("target_hit", {
      player: playerName(e.source),
      location: e.block?.location,
      dimension: e.dimension?.id
    });
  });
}

// ---- Possible dupe detection --------------------------------------------
// Every second, count everything each player is carrying. If items appear
// from nowhere (nothing picked up, no container open, nothing else used up,
// not in creative), it is logged as a POSSIBLE dupe. It is a hint, not proof.
if (CONFIG.logPossibleDupe) {
  const carried = new Map();       // player id -> { counts, tick }
    const containerOpen = new Set(); // player ids with a chest etc open right now
  const containerTick = new Map(); // player id -> last tick they opened or closed one
  const watch = new Set(CONFIG.dupeWatchItems);
  const credits = new Map();       // player id -> [{ item ("*" = any), amount, expires }]
  const pending = new Map();       // player id -> { gains, checksLeft }
  const cbLast = new Map();        // player id -> last tick CrossBlades was active for them
  subscribe("playerSpawn (dupe grace)", world.afterEvents.playerSpawn, e => { if (e.initialSpawn && e.player) cbLast.set(e.player.id, system.currentTick); });
  function addCredit(id, item, amount, ttl) {
    const list = credits.get(id) ?? [];
    list.push({ item, amount, expires: system.currentTick + ttl });
    if (list.length > 400) list.splice(0, list.length - 400);
    credits.set(id, list);
  }
  // Use up credits for `need` items of one kind; returns what is still unexplained.
  function takeCredit(id, item, need) {
    const now = system.currentTick;
    const list = (credits.get(id) ?? []).filter(c => c.expires > now && c.amount > 0);
    for (const kind of [item, "*"]) {
      for (const c of list) {
        if (need <= 0) break;
        if (c.item !== kind) continue;
        const used = Math.min(c.amount, need);
        c.amount -= used; need -= used;
      }
    }
    credits.set(id, list.filter(c => c.amount > 0));
    return need;
  }
  const EQUIP_SLOTS = ["Head", "Chest", "Legs", "Feet", "Offhand"];

  const add = (counts, stack) => {
    if (!stack) return;
    counts[stack.typeId] = (counts[stack.typeId] ?? 0) + stack.amount;
    if (stack.amount > (stack.maxAmount ?? 64)) counts["!illegal"] = `${stack.amount}x ${short(stack.typeId)}`;
  };
  const countCarried = player => {
    const counts = {};
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (inv) for (let i = 0; i < inv.size; i++) add(counts, inv.getItem(i));
    try { add(counts, player.getComponent("minecraft:cursor_inventory")?.item); } catch {}
    try {
      const eq = player.getComponent("minecraft:equippable");
      if (eq) for (const slot of EQUIP_SLOTS) add(counts, eq.getEquipment(slot));
    } catch {}
    return counts;
  };

  const touch = (player, open) => {
    if (!isPlayer(player)) return;
    containerTick.set(player.id, system.currentTick);
    if (open) containerOpen.add(player.id); else containerOpen.delete(player.id);
  };
  // Attribution: remember what each player touched recently, so a dupe flag says where it likely came from.
  const trail = new Map();   // player id -> [{ tick, text, loc, dim }]
  const pistons = [];        // recent piston activity { tick, loc, dim }
  const TRAIL_TICKS = 600;   // 30 seconds
  const note = (player, text, loc, dim) => {
    if (!isPlayer(player)) return;
    const list = trail.get(player.id) ?? [];
    list.push({ tick: system.currentTick, text, loc, dim });
    while (list.length > 8) list.shift();
    trail.set(player.id, list);
  };
  const where3 = l => l && typeof l.x === "number" ? `(${Math.floor(l.x)}, ${Math.floor(l.y)}, ${Math.floor(l.z)})` : "";
  subscribe("playerInteractWithBlock (trail)", world.afterEvents.playerInteractWithBlock, e => {
    if (!e.isFirstEvent) return;
    note(e.player, `used ${short(safeType(e.block?.permutation))} ${where3(e.block?.location)}`, e.block?.location, e.block?.dimension?.id);
  });
  subscribe("playerInteractWithEntity (trail)", world.afterEvents.playerInteractWithEntity, e => {
    note(e.player, `interacted with ${short(safeType(e.target))} ${where3(e.target?.location)}`, e.target?.location, e.target?.dimension?.id);
  });
  subscribe("pistonActivate (trail)", world.afterEvents.pistonActivate, e => {
    pistons.push({ tick: system.currentTick, loc: e.block?.location, dim: e.block?.dimension?.id });
    while (pistons.length > 40) pistons.shift();
  });
  const describeSource = (player, now) => {
    const parts = [];
    const recent = (trail.get(player.id) ?? []).filter(t => now - t.tick <= TRAIL_TICKS).slice(-3);
    for (const t of recent) parts.push(`${t.text} ${Math.round((now - t.tick) / 20)}s ago`);
    try {
      const ride = player.getComponent("minecraft:riding")?.entityRidingOn;
      if (ride) parts.push(`riding ${short(ride.typeId)}`);
    } catch {}
    const l = player.location;
    for (const pi of pistons) {
      if (now - pi.tick > 100 || pi.dim !== player.dimension?.id || !pi.loc) continue;
      if (Math.abs(pi.loc.x - l.x) <= 8 && Math.abs(pi.loc.y - l.y) <= 8 && Math.abs(pi.loc.z - l.z) <= 8) {
        parts.push(`piston ${where3(pi.loc)} fired ${Math.round((now - pi.tick) / 20)}s ago`); break;
      }
    }
    try {
      const h = player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex);
      if (h) parts.push(`holding ${short(h.typeId)}`);
    } catch {}
    return parts.join("; ") || "nothing recent (no chest, block, mount or piston)";
  };

  subscribe("blockContainerOpened", world.afterEvents.blockContainerOpened, e => note(e.openSource?.entity ?? e.player, `opened ${short(safeType(e.block?.permutation))} ${where3(e.block?.location)}`, e.block?.location, e.block?.dimension?.id));
  subscribe("blockContainerOpened", world.afterEvents.blockContainerOpened, e => touch(e.openSource?.entity ?? e.player, true));
  subscribe("blockContainerClosed", world.afterEvents.blockContainerClosed, e => touch(e.closeSource?.entity ?? e.player, false));
  subscribe("entityContainerOpened", world.afterEvents.entityContainerOpened, e => touch(e.openSource?.entity ?? e.player, true));
  subscribe("entityContainerClosed", world.afterEvents.entityContainerClosed, e => touch(e.closeSource?.entity ?? e.player, false));

  subscribe("entityItemPickup", world.afterEvents.entityItemPickup, e => {
    if (!isPlayer(e.entity)) return;
    let stacks = [];
    try { stacks = (e.items ?? []).map(x => x); } catch { try { stacks = Array.from(e.items); } catch {} }
    for (const stack of stacks) addCredit(e.entity.id, stack.typeId, stack.amount, 200);
  });

  // Gravestones (Admin Tools) hand a player's saved items back: that is not a dupe.
  subscribe("playerInteractWithEntity (grave)", world.afterEvents.playerInteractWithEntity, e => {
    if (e.player && e.target?.typeId === "jm_at:grave") addCredit(e.player.id, "*", 2400, 400);
  });
  subscribe("playerInteractWithBlock (grave)", world.afterEvents.playerInteractWithBlock, e => {
    if (e.player && e.block?.typeId === "jm_at:gravestone") addCredit(e.player.id, "*", 2400, 400);
  });

  // Things that explain a gain: picked-up items, blocks the player placed (mining it back
  // returns the item), and blocks they just broke (their drops).
  subscribe("playerPlaceBlock (dupe)", world.afterEvents.playerPlaceBlock, e => {
    if (!e.player) return;
    addCredit(e.player.id, safeType(e.block?.permutation), 1, CONFIG.dupePlacedMemoryMin * 1200);
  });
  subscribe("playerBreakBlock (dupe)", world.afterEvents.playerBreakBlock, e => {
    if (!e.player) return;
    addCredit(e.player.id, safeType(e.brokenBlockPermutation), 1, 100);
    addCredit(e.player.id, "*", CONFIG.dupeBreakAllowance, 100);
  });

  subscribe("playerLeave", world.afterEvents.playerLeave, e => {
    carried.delete(e.playerId); cbLast.delete(e.playerId); credits.delete(e.playerId); pending.delete(e.playerId); trail.delete(e.playerId);
    containerOpen.delete(e.playerId); containerTick.delete(e.playerId);
  });

  const alertOperators = text => {
    if (!CONFIG.dupeAlertOperators) return;
    for (const p of world.getAllPlayers()) {
      try { if (canViewLogs(p)) p.sendMessage(`§c[ZephyCubeLogs] §f${text}`); } catch {}
    }
  };

  system.runInterval(() => {
    if (!modOn("dupes")) return;
    for (const player of world.getAllPlayers()) {
      try {
        const id = player.id;
        const before = carried.get(id);
        const counts = countCarried(player);
        const illegal = counts["!illegal"];
        delete counts["!illegal"];
        carried.set(id, { counts, tick: system.currentTick });
        if (!before) continue; // first look at this player, nothing to compare yet

        // CrossBlades duels / FFA / kits clear and refill the inventory (and restore it afterwards).
        // Those items come from nowhere by design, so do not judge the player during or just after.
        let cbTag = false;
        try { cbTag = player.getTags().some(t => t.startsWith("crossblades:") || t === "zc:grave"); } catch {}
        if (cbTag) cbLast.set(id, system.currentTick);
        const inGrace = system.currentTick - (cbLast.get(id) ?? -999999) < CONFIG.dupeKitGraceSec * 20;
        if (inGrace) pending.delete(id);

        // Gains that were unexplained last time: give late pickup events a chance to arrive.
        const wait = pending.get(id);
        if (wait) {
          const stillGained = [];
          for (const g of wait.gains) {
            const left = takeCredit(id, g.item, g.amount);
            if (left > 0) stillGained.push({ item: g.item, amount: left });
          }
          if (stillGained.length && wait.checksLeft > 0) {
            wait.gains = stillGained; wait.checksLeft--;
          } else {
            pending.delete(id);
            if (stillGained.length) {
              const source = describeSource(player, system.currentTick);
              const w = { location: player.location, dimension: player.dimension?.id };
              emit("possible_dupe", { player: playerName(player), items: stillGained, source, ...w });
              alertOperators(`Possible dupe: ${playerName(player)} gained ${stillGained.map(g => `${g.amount}x ${short(g.item)}`).join(", ")} | ${source}`);
            }
          }
        }

        const where = { location: player.location, dimension: player.dimension?.id };

        if (illegal && before.illegal !== illegal) {
          emit("illegal_stack", { player: playerName(player), stack: illegal, ...where });
          alertOperators(`${playerName(player)} has an impossible stack: ${illegal}`);
        }
        carried.get(id).illegal = illegal;

        let mode = "";
        try { mode = String(player.getGameMode()).toLowerCase(); } catch {}
        if (mode === "creative") continue;
        if (inGrace) continue;
        if (containerOpen.has(id) || (containerTick.get(id) ?? -1) >= before.tick) continue;

        const gained = [];
        let usedSomething = false;
        for (const item of new Set([...Object.keys(counts), ...Object.keys(before.counts)])) {
          const diff = (counts[item] ?? 0) - (before.counts[item] ?? 0);
          if (diff < 0) usedSomething = true; // crafting, trading, eating ... not a dupe
          if (diff > 0) {
            const unexplained = takeCredit(id, item, diff);
            if (unexplained > 0) gained.push({ item, amount: unexplained });
          }
        }
        if (usedSomething) continue;
        if (gained.length >= CONFIG.dupeBulkGainTypes) continue; // whole-inventory load (kit / restore)

        const suspicious = gained.filter(g => watch.has(g.item) || g.amount >= CONFIG.dupeMinAmount);
        if (suspicious.length === 0) continue;

        // Do not flag yet: wait for the next check(s) in case the explaining event arrives late.
        const old = pending.get(id);
        pending.set(id, { gains: old ? [...old.gains, ...suspicious] : suspicious, checksLeft: CONFIG.dupeConfirmChecks });
      } catch {}
    }
  }, CONFIG.dupeCheckTicks);
}

// Movement sampling: deliberately throttled to avoid flooding the server log/Discord.
if (CONFIG.logMovement) {
  system.runInterval(() => {
    if (!modOn("movement")) return;
    for (const p of world.getAllPlayers()) {
      try {
        const now = pos(p);
        const old = lastPos.get(p.id);

        if (!old) {
          lastPos.set(p.id, now);
          continue;
        }

        const dx = now.x - old.x;
        const dy = now.y - old.y;
        const dz = now.z - old.z;
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

        if (now.dimension !== old.dimension || distance >= CONFIG.movementMinDistance) {
          emit("movement", {
            player: playerName(p),
            from: old,
            to: now,
            distance: Number(distance.toFixed(2))
          });
          lastPos.set(p.id, now);
        }
      } catch {}
    }
  }, CONFIG.movementIntervalTicks);
}

emit("server_logger_started", {
  title: "ZephyCubeLogs",
  author: "@iharvs",
  betaApisRequired: false
});
/* ---------- player name tagger (merged from "BedrockToolChest - Player Name Tagger" by Rob 'myGen') ----------
 * On join, saves { name, id } as the player's dynamic property "player", so the BedrockToolChest world editor can
 * show who a player entity in the world file is. */
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn || !modOn("player_tag")) return;
  try { player.setDynamicProperty("player", JSON.stringify({ name: player.name, id: player.id })); } catch {}
});
