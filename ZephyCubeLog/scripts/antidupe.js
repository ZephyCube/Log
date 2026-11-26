// Anti-dupe modules. Merged from "DupeGuard" (1.5.0) and "Anti Dupe Bundle" by GoodmorningDat, rewritten for this pack.
// Every module is a switch in /zc:logmodules. All are off by default except disable_bundles. What a module blocks is logged in the DUPE category and sent to staff.
//
//   anti_bundle        bundles put in hoppers, droppers, dispensers or crafters are removed (bundle hopper dupe)
//   disable_bundles    (on by default) bundles cannot be used or carried: a bundle in a player's inventory is taken
//                      away and its contents are given back (dropped at the player's feet when the inventory is full)
//   anti_loop          two hoppers / droppers / dispensers feeding into each other cannot be made (by hand or with pistons)
//   anti_crash_drop    items that spawn where a player disconnected, in the 3 seconds around it, are removed
//   explosion_protect  explosions do not destroy containers: the contents and the container drop intact
//   portal_protect     items thrown into a Nether portal go back to the nearest player
//   inventory_sync     remembers what each player carries; after a crash or rejoin, items that are
//                      more than the last saved count are removed. New items count only after 15 seconds.
import { world, system } from "@minecraft/server";

const FEEDERS = new Set(["minecraft:hopper", "minecraft:dropper", "minecraft:dispenser"]);
const BUNDLE_HOLDERS = new Set(["minecraft:hopper", "minecraft:dropper", "minecraft:dispenser", "minecraft:crafter"]);
const CONTAINER = /(^|:)(chest|trapped_chest|barrel|hopper|dropper|dispenser|furnace|blast_furnace|smoker|brewing_stand|crafter|chiseled_bookshelf)$|shulker_box$|copper_chest$/;
// facing_direction of hoppers, droppers and dispensers: 0 down, 1 up, 2 north, 3 south, 4 west, 5 east
const OFFSET = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
const FACE = { Down: 0, Up: 1, North: 2, South: 3, West: 4, East: 5 };
const isBundle = (id) => typeof id === "string" && id.includes("bundle");
const fl = (l) => ({ x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) });
const add = (l, o) => ({ x: l.x + o[0], y: l.y + o[1], z: l.z + o[2] });
const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
const xyz = (l) => `${Math.floor(l.x)} ${Math.floor(l.y)} ${Math.floor(l.z)}`;

/** on(module): module switch. report(text, data): log line (DUPE category) and staff alert. */
export function startAntiDupe(on, report) {
  // ---------------------------------------------------------------- anti_bundle
  const tracked = new Map(); // "dim|x,y,z" -> { d, pos, until }
  const track = (dimId, pos, ms) => {
    const k = `${dimId}|${pos.x},${pos.y},${pos.z}`;
    const until = Date.now() + ms;
    if ((tracked.get(k)?.until ?? 0) < until) tracked.set(k, { d: dimId, pos, until });
  };
  function carriesBundle(p) {
    try {
      const inv = p.getComponent("minecraft:inventory")?.container;
      if (inv) for (let i = 0; i < inv.size; i++) if (isBundle(inv.getItem(i)?.typeId)) return true;
      return isBundle(p.getComponent("minecraft:equippable")?.getEquipment("Offhand")?.typeId);
    } catch { return false; }
  }
  // a player who opens a hopper (etc.) while carrying a bundle: watch that block for 2 minutes
  world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
    try {
      if (!on("anti_bundle") || !BUNDLE_HOLDERS.has(ev.block.typeId) || !carriesBundle(ev.player)) return;
      track(ev.block.dimension.id, fl(ev.block.location), 120000);
    } catch { }
  });
  system.runInterval(() => {
    if (!on("anti_bundle")) return;
    // a bundle lying on the ground near a player: watch the block under it (a hopper can pick it up)
    for (const p of world.getAllPlayers()) {
      try {
        for (const e of p.dimension.getEntities({ type: "minecraft:item", location: p.location, maxDistance: 16 })) {
          if (isBundle(e.getComponent("minecraft:item")?.itemStack?.typeId)) {
            const l = fl(e.location);
            track(e.dimension.id, { x: l.x, y: l.y - 1, z: l.z }, 5000);
            track(e.dimension.id, l, 5000);
          }
        }
      } catch { }
    }
    const now = Date.now();
    for (const [k, t] of tracked) {
      if (now > t.until) { tracked.delete(k); continue; }
      try {
        const dim = world.getDimension(t.d);
        const b = dim.getBlock(t.pos);
        if (!b) continue; // not loaded right now
        if (!BUNDLE_HOLDERS.has(b.typeId)) { tracked.delete(k); continue; }
        const c = b.getComponent("minecraft:inventory")?.container;
        if (!c) continue;
        for (let i = 0; i < c.size; i++) {
          const it = c.getItem(i);
          if (!isBundle(it?.typeId)) continue;
          c.setItem(i, undefined);
          const near = dim.getPlayers({ location: t.pos, maxDistance: 16 }).map((p) => p.name);
          report(`bundle removed from a ${b.typeId.replace("minecraft:", "")} at ${xyz(t.pos)} (bundle hopper dupe)${near.length ? `, players near: ${near.join(", ")}` : ""}`,
            { location: t.pos, dimension: t.d });
          for (const p of dim.getPlayers({ location: t.pos, maxDistance: 16 })) { try { p.playSound("note.bass", { pitch: 0.5 }); } catch { } }
        }
      } catch { tracked.delete(k); }
    }
  }, 10);

  // ---------------------------------------------------------------- disable_bundles (off by default)
  world.beforeEvents.itemUse.subscribe((ev) => {
    try {
      if (!on("disable_bundles") || !isBundle(ev.itemStack?.typeId)) return;
      ev.cancel = true;
      const p = ev.source;
      system.run(() => { try { p.sendMessage("§cBundles are disabled on this server."); } catch { } });
    } catch { }
  });
  function unpackBundles(p) {
    const inv = p.getComponent("minecraft:inventory")?.container;
    const eq = p.getComponent("minecraft:equippable");
    const found = [];
    if (inv) for (let i = 0; i < inv.size; i++) { const it = inv.getItem(i); if (isBundle(it?.typeId)) { found.push(it); inv.setItem(i, undefined); } }
    const off = eq?.getEquipment("Offhand");
    if (isBundle(off?.typeId)) { found.push(off); eq.setEquipment("Offhand", undefined); }
    if (!found.length) return;
    let returned = 0;
    for (const b of found) {
      const c = b.getComponent("minecraft:inventory")?.container;
      if (!c) continue;
      for (let i = 0; i < c.size; i++) {
        const it = c.getItem(i);
        if (!it) continue;
        returned += it.amount;
        const left = inv ? inv.addItem(it) : it;
        if (left) p.dimension.spawnItem(left, p.location);
      }
    }
    p.sendMessage(`§cBundles are disabled on this server: ${found.length} bundle(s) removed${returned ? `, ${returned} item(s) inside were given back` : ""}.`);
    report(`${p.name}: ${found.length} bundle(s) removed, contents given back (bundles disabled)`, { player: p.name, location: fl(p.location), dimension: p.dimension.id });
  }
  system.runInterval(() => {
    if (!on("disable_bundles")) return;
    for (const p of world.getAllPlayers()) { try { unpackBundles(p); } catch { } }
  }, 20);

  // ---------------------------------------------------------------- anti_loop
  function facing(b) { try { const f = b.permutation.getState("facing_direction"); return typeof f === "number" ? f : undefined; } catch { return undefined; } }
  // true when the feeder at pos outputs into a feeder that outputs straight back
  function loopsAt(dim, pos) {
    const a = dim.getBlock(pos);
    if (!a || !FEEDERS.has(a.typeId)) return false;
    const fa = facing(a);
    if (fa === undefined) return false;
    const tpos = add(pos, OFFSET[fa]);
    const t = dim.getBlock(tpos);
    if (!t || !FEEDERS.has(t.typeId)) return false;
    const ft = facing(t);
    return ft !== undefined && same(add(tpos, OFFSET[ft]), pos);
  }
  function breakBlock(dim, pos) { // drops the block and what is in it
    try { dim.runCommand(`setblock ${pos.x} ${pos.y} ${pos.z} air destroy`); } catch { }
  }
  // placing a hopper on the side of a hopper that outputs into the new spot
  world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
    try {
      if (!on("anti_loop") || ev.itemStack?.typeId !== "minecraft:hopper" || ev.block.typeId !== "minecraft:hopper") return;
      const face = FACE[ev.blockFace];
      if (face === undefined || face < 2) return;
      if (facing(ev.block) !== face) return;
      ev.cancel = true;
      const p = ev.player, pos = fl(ev.block.location), d = ev.block.dimension.id;
      system.run(() => {
        try { p.playSound("note.bass", { pitch: 0.5 }); } catch { }
        report(`${p.name} tried to place a hopper loop at ${xyz(pos)} (blocked)`, { player: p.name, location: pos, dimension: d });
      });
    } catch { }
  });
  // placing a dropper / dispenser (or hopper) that makes a loop: it pops off
  world.afterEvents.playerPlaceBlock.subscribe((ev) => {
    try {
      if (!on("anti_loop") || !FEEDERS.has(ev.block.typeId)) return;
      const dim = ev.block.dimension, pos = fl(ev.block.location);
      if (!loopsAt(dim, pos)) return;
      breakBlock(dim, pos);
      report(`${ev.player.name} placed a ${ev.block.typeId.replace("minecraft:", "")} loop at ${xyz(pos)} (popped off)`, { player: ev.player.name, location: pos, dimension: dim.id });
    } catch { }
  });
  // pistons pushing feeders into a loop: check only the blocks that moved and their neighbours
  world.afterEvents.pistonActivate.subscribe((ev) => {
    try {
      if (!on("anti_loop") || !ev.isExpanding) return;
      const dim = ev.dimension ?? ev.block?.dimension;
      const moved = ev.piston.getAttachedBlocksLocations().map(fl);
      if (!moved.length) return;
      system.runTimeout(() => {
        const seen = new Set();
        for (const m of moved) {
          for (const o of [[0, 0, 0], ...OFFSET]) {
            const q = add(m, o), k = `${q.x},${q.y},${q.z}`;
            if (seen.has(k)) continue;
            seen.add(k);
            try {
              if (!loopsAt(dim, q)) continue;
              breakBlock(dim, q);
              report(`a piston pushed a hopper/dropper loop together at ${xyz(q)} (popped off)`, { location: q, dimension: dim.id });
              return;
            } catch { }
          }
        }
      }, 4);
    } catch { }
  });

  // ---------------------------------------------------------------- anti_crash_drop
  const lastLoc = new Map();       // player id -> { d, l, name }
  const disconnects = [];          // { d, l, t, name }
  const itemSpawns = [];           // { e, d, l, t }
  const deaths = [];               // { d, l, t }: drops from a death (e.g. a combat-log kill) are kept
  system.runInterval(() => {
    if (!on("anti_crash_drop")) return;
    for (const p of world.getAllPlayers()) { try { lastLoc.set(p.id, { d: p.dimension.id, l: { ...p.location }, name: p.name }); } catch { } }
  }, 2);
  const near = (a, b, r) => a.d === b.d && (a.l.x - b.l.x) ** 2 + (a.l.y - b.l.y) ** 2 + (a.l.z - b.l.z) ** 2 <= r * r;
  const recentDeath = (spot, now) => deaths.some((x) => now - x.t < 5000 && near(x, spot, 4));
  function prune(now) {
    while (disconnects.length && now - disconnects[0].t > 5000) disconnects.shift();
    while (itemSpawns.length && now - itemSpawns[0].t > 5000) itemSpawns.shift();
    while (deaths.length && now - deaths[0].t > 5000) deaths.shift();
  }
  const keep = (e) => { try { return e.hasTag("zc:keep_drop"); } catch { return true; } };
  world.afterEvents.entityDie.subscribe((ev) => {
    try { if (ev.deadEntity?.typeId === "minecraft:player") deaths.push({ d: ev.deadEntity.dimension.id, l: { ...ev.deadEntity.location }, t: Date.now() }); } catch { }
  });
  world.afterEvents.playerLeave.subscribe((ev) => {
    const last = lastLoc.get(ev.playerId);
    lastLoc.delete(ev.playerId);
    if (!on("anti_crash_drop") || !last) return;
    const now = Date.now();
    prune(now);
    const spot = { d: last.d, l: last.l, t: now, name: last.name };
    disconnects.push(spot);
    if (recentDeath(spot, now)) return;
    let n = 0;
    for (const s of itemSpawns) {
      if (now - s.t < 3000 && near(s, spot, 3) && !keep(s.e)) { try { if (s.e.isValid) { s.e.remove(); n++; } } catch { } }
    }
    if (n) report(`${n} item(s) dropped as ${last.name} disconnected were removed (crash drop dupe)`, { player: last.name, location: last.l, dimension: last.d });
  });
  world.afterEvents.entitySpawn.subscribe((ev) => {
    try {
      if (!on("anti_crash_drop") || ev.entity?.typeId !== "minecraft:item") return;
      const e = ev.entity, now = Date.now();
      const s = { e, d: e.dimension.id, l: { ...e.location }, t: now };
      itemSpawns.push(s);
      if (itemSpawns.length > 500) itemSpawns.shift();
      for (const dc of disconnects) {
        if (now - dc.t > 3000 || !near(s, dc, 3) || recentDeath(dc, now) || keep(e)) continue;
        e.remove();
        report(`an item dropped right after ${dc.name} disconnected was removed (crash drop dupe)`, { player: dc.name, location: dc.l, dimension: dc.d });
        return;
      }
    } catch { }
  });

  // ---------------------------------------------------------------- explosion_protect
  world.beforeEvents.explosion.subscribe((ev) => {
    try {
      if (!on("explosion_protect")) return;
      const keepBlocks = [], hit = [];
      for (const b of ev.getImpactedBlocks()) {
        if (CONTAINER.test(b.typeId)) hit.push({ pos: fl(b.location) }); else keepBlocks.push(b);
      }
      if (!hit.length) return;
      ev.setImpactedBlocks(keepBlocks);
      const dim = ev.dimension;
      system.run(() => {
        for (const h of hit) {
          try {
            const b = dim.getBlock(h.pos);
            if (!b || !CONTAINER.test(b.typeId)) continue;
            breakBlock(dim, h.pos); // drops the container and its contents, like breaking it by hand
          } catch { }
        }
        report(`an explosion hit ${hit.length} container(s); they dropped intact instead of being destroyed`, { location: hit[0].pos, dimension: dim.id });
      });
    } catch { }
  });

  // ---------------------------------------------------------------- portal_protect
  system.runInterval(() => {
    if (!on("portal_protect")) return;
    for (const p of world.getAllPlayers()) {
      try {
        for (const e of p.dimension.getEntities({ type: "minecraft:item", location: p.location, maxDistance: 10 })) {
          const b = e.dimension.getBlock(e.location);
          if (b?.typeId !== "minecraft:portal") continue;
          const st = e.getComponent("minecraft:item")?.itemStack;
          if (!st) continue;
          const left = p.getComponent("minecraft:inventory")?.container?.addItem(st);
          if (left) e.dimension.spawnItem(left, p.location);
          e.remove();
          p.sendMessage("§cItems cannot be thrown into Nether portals: it was given back to you.");
          report(`${p.name}: ${st.amount}x ${st.typeId.replace("minecraft:", "")} thrown into a Nether portal was given back (portal dupe)`, { player: p.name, location: fl(p.location), dimension: p.dimension.id });
        }
      } catch { }
    }
  }, 5);

  // ---------------------------------------------------------------- inventory_sync (off by default)
  const invKey = (id) => `zclog:inv:${id}`;
  const committed = new Map(); // player id -> counts
  const pendingGain = new Map(); // player id -> first time an unconfirmed gain was seen
  function counts(p) {
    const o = {};
    const inv = p.getComponent("minecraft:inventory")?.container;
    if (inv) for (let i = 0; i < inv.size; i++) { const it = inv.getItem(i); if (it) o[it.typeId] = (o[it.typeId] ?? 0) + it.amount; }
    return o;
  }
  function loadCommitted(id) {
    if (committed.has(id)) return committed.get(id);
    let o = {};
    try { const s = world.getDynamicProperty(invKey(id)); if (typeof s === "string") o = JSON.parse(s); } catch { }
    committed.set(id, o);
    return o;
  }
  function commit(id, o) {
    committed.set(id, o);
    pendingGain.delete(id);
    try { world.setDynamicProperty(invKey(id), JSON.stringify(o)); } catch { }
  }
  system.runInterval(() => {
    if (!on("inventory_sync")) return;
    const now = Date.now();
    for (const p of world.getAllPlayers()) {
      try {
        const cur = counts(p), old = loadCommitted(p.id);
        const gained = Object.keys(cur).some((k) => cur[k] > (old[k] ?? 0));
        if (!gained) { commit(p.id, cur); continue; }
        const since = pendingGain.get(p.id);
        if (since === undefined) pendingGain.set(p.id, now);
        else if (now - since > 15000) commit(p.id, cur);
      } catch { }
    }
  }, 10);
  world.afterEvents.playerSpawn.subscribe((ev) => {
    if (!ev.initialSpawn) return;
    const p = ev.player;
    system.runTimeout(() => {
      try {
        if (!on("inventory_sync") || !p.isValid) return;
        committed.delete(p.id);
        let s;
        try { s = world.getDynamicProperty(invKey(p.id)); } catch { }
        if (typeof s !== "string") return;
        const saved = JSON.parse(s), cur = counts(p), inv = p.getComponent("minecraft:inventory")?.container;
        const removed = [];
        for (const id of Object.keys(cur)) {
          let extra = cur[id] - (saved[id] ?? 0);
          if (extra <= 0 || !inv) continue;
          removed.push(`${extra}x ${id.replace("minecraft:", "")}`);
          for (let i = 0; i < inv.size && extra > 0; i++) {
            const it = inv.getItem(i);
            if (it?.typeId !== id) continue;
            if (it.amount > extra) { it.amount -= extra; inv.setItem(i, it); extra = 0; }
            else { extra -= it.amount; inv.setItem(i, undefined); }
          }
        }
        if (removed.length) {
          try { p.playSound("note.bass", { pitch: 0.5 }); } catch { }
          report(`${p.name} joined with more than they had when they left; removed ${removed.join(", ")} (inventory sync)`, { player: p.name, location: fl(p.location), dimension: p.dimension.id });
        }
      } catch { }
    }, 10);
  });
}

export const ANTI_DUPE_MODULES = [
  { key: "anti_bundle", name: "Anti-dupe: bundles in hoppers", label: "bundles in hoppers, droppers, dispensers and crafters are removed (from DupeGuard and Anti Dupe Bundle)", defaultOff: true },
  { key: "disable_bundles", name: "Disable bundles", label: "bundles are disabled: they cannot be used, and a carried bundle is removed with its contents given back" },
  { key: "anti_loop", name: "Anti-dupe: hopper loops", label: "hopper / dropper / dispenser loops cannot be built (by hand or with pistons)", defaultOff: true },
  { key: "anti_crash_drop", name: "Anti-dupe: crash drops", label: "items dropped where a player crashed or disconnected are removed", defaultOff: true },
  { key: "explosion_protect", name: "Anti-dupe: explosion protection", label: "explosions drop containers and their contents intact instead of destroying them", defaultOff: true },
  { key: "portal_protect", name: "Anti-dupe: portal protection", label: "items thrown into a Nether portal go back to the nearest player", defaultOff: true },
  { key: "inventory_sync", name: "Anti-dupe: inventory sync", label: "after a crash or rejoin, items above the last saved count are removed (strict)", defaultOff: true },
];
