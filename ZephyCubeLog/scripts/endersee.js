// EnderSee: like InvSee, but for a player's ender chest. Staff only, the target must be online.
// How it opens (the same trick InvSee uses): an invisible 27-slot entity (zc:ender_viewer) is spawned at the staff
// member and they are seated on it; pressing the inventory key opens the entity's container as a normal chest
// screen titled "Ender Chest: <player>". Every 2 ticks the screen and the target's real ender chest
// (minecraft:ender_inventory) are compared slot by slot and changes are copied across, both ways. Items are copied as
// they are, so enchantments, names and shulker box contents are kept. When the screen closes (or either player leaves)
// the entity is emptied and removed. The entity is transient, so it is never saved with the world.
// If the staff member and the target change the same slot at the same moment, the target's ender chest wins.
import { world, system, CommandPermissionLevel, CustomCommandStatus, CustomCommandParamType } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { showForm } from "./modules.js";

const ENTITY = "zc:ender_viewer";
const SIZE = 27;
const sessions = new Map(); // staff id -> session

function sig(item) {
  if (!item) return "";
  try {
    const dur = item.getComponent("minecraft:durability");
    return [item.typeId, item.amount, item.nameTag ?? "", item.getLore().join("\n"), dur ? dur.damage : ""].join("|");
  } catch { return `${item.typeId}|${item.amount}`; }
}
const short = (id) => String(id ?? "").replace(/^minecraft:/, "");
const describe = (item) => `${item.amount}x ${short(item.typeId)}${item.nameTag ? ` "${item.nameTag}"` : ""}`;

/**
 * gate(player): a message when the player may not use EnderSee, else undefined.
 * audit(staffName, action, targetName, detail): writes a STAFF line to the log.
 */
export function startEnderSee(gate, audit) {
  function enderOf(p) { try { return p.getComponent("minecraft:ender_inventory")?.container; } catch { return undefined; } }

  function open(staff, target) {
    const m = gate(staff);
    if (m) { staff.sendMessage(`§c${m}`); return; }
    if (!target?.isValid) { staff.sendMessage("§cThat player is not online."); return; }
    if (sessions.has(staff.id)) { staff.sendMessage("§cClose the ender chest you have open first."); return; }
    const ender = enderOf(target);
    if (!ender) { staff.sendMessage("§cCould not read that player's ender chest."); return; }
    let entity;
    try {
      entity = staff.dimension.spawnEntity(ENTITY, staff.location);
      entity.nameTag = `Ender Chest: ${target.name}`;
      const box = entity.getComponent("minecraft:inventory")?.container;
      for (let i = 0; i < SIZE; i++) box.setItem(i, ender.getItem(i));
      if (!entity.getComponent("minecraft:rideable")?.addRider(staff)) throw new Error("could not seat the viewer");
    } catch (e) {
      try { entity?.remove(); } catch { }
      staff.sendMessage("§cCould not open the ender chest viewer here.");
      return;
    }
    const last = [];
    for (let i = 0; i < SIZE; i++) last.push(sig(ender.getItem(i)));
    sessions.set(staff.id, { staff, target, entity, last, opened: false, since: system.currentTick, changes: 0 });
    system.runTimeout(() => {
      try { staff.playAnimation("animation.r4isen1920_invsee.player.riding.cancel", { stopExpression: "q.is_sneaking || !q.is_riding" }); } catch { }
    }, 2);
    staff.sendMessage(`§aEnder chest of ${target.name}: press your inventory key (or tap the inventory button) to open it. Sneak to leave.`);
    audit(staff.name, "opened the ender chest of", target.name, "");
  }

  function close(s, why) {
    sessions.delete(s.staff.id);
    try { sync(s); } catch { }
    try {
      const box = s.entity.getComponent("minecraft:inventory")?.container;
      box?.clearAll(); // nothing may drop or stay behind
      s.entity.remove();
    } catch { }
    if (why) { try { s.staff.sendMessage(`§e${why}`); } catch { } }
    audit(s.staff.name, "closed the ender chest of", s.target.name ?? "?", s.changes ? `${s.changes} change(s)` : "no changes");
  }

  // copies changes across; the target's ender chest wins when both sides changed the same slot
  function sync(s) {
    const box = s.entity.getComponent("minecraft:inventory")?.container;
    const ender = enderOf(s.target);
    if (!box || !ender) return false;
    for (let i = 0; i < SIZE; i++) {
      const p = box.getItem(i), e = ender.getItem(i);
      const ps = sig(p), es = sig(e);
      if (ps === es) { s.last[i] = es; continue; }
      if (es !== s.last[i]) {
        box.setItem(i, e); // the target (or something else) changed their ender chest: show it
      } else {
        ender.setItem(i, p); // the staff member changed the slot: write it to the real ender chest
        s.changes++;
        const before = s.last[i] ? s.last[i].split("|") : undefined;
        audit(s.staff.name, p ? "put into" : "took from", `the ender chest of ${s.target.name}`,
          `slot ${i + 1}: ${p ? describe(p) : "empty"}${before ? ` (was ${before[1]}x ${short(before[0])})` : ""}`);
      }
      s.last[i] = sig(ender.getItem(i));
    }
    return true;
  }

  system.runInterval(() => {
    for (const s of [...sessions.values()]) {
      try {
        if (!s.staff.isValid) { close(s); continue; }
        if (!s.target.isValid) { close(s, `${s.target.name ?? "The player"} left: the ender chest viewer closed.`); continue; }
        if (!s.entity.isValid) { close(s); continue; }
        if (gate(s.staff)) { close(s, "EnderSee was turned off."); continue; }
        if (!sync(s)) { close(s); continue; }
        // left the seat without opening the chest (sneaking), or never opened it within 60 s
        const riders = s.entity.getComponent("minecraft:rideable")?.getRiders() ?? [];
        if (!riders.some((r) => r.id === s.staff.id) && !s.opened) close(s);
        else if (!s.opened && system.currentTick - s.since > 1200) close(s, "The ender chest viewer timed out.");
      } catch { close(s); }
    }
  }, 2);

  world.afterEvents.entityContainerOpened?.subscribe((ev) => {
    try { for (const s of sessions.values()) if (ev.entity?.id === s.entity.id) s.opened = true; } catch { }
  });
  world.afterEvents.entityContainerClosed.subscribe((ev) => {
    try { for (const s of [...sessions.values()]) if (ev.entity?.id === s.entity.id) close(s); } catch { }
  });
  world.afterEvents.playerLeave.subscribe((ev) => {
    for (const s of [...sessions.values()]) if (s.staff.id === ev.playerId) { try { s.entity.remove(); } catch { } sessions.delete(ev.playerId); }
  });
  // a viewer entity left over from a crash or reload: remove it (it holds nothing the player still needs)
  system.runTimeout(() => {
    for (const d of ["overworld", "nether", "the_end"]) {
      try { for (const e of world.getDimension(d).getEntities({ type: ENTITY })) { e.getComponent("minecraft:inventory")?.container?.clearAll(); e.remove(); } } catch { }
    }
  }, 100);

  async function pick(staff) {
    const players = world.getAllPlayers().filter((p) => p.id !== staff.id).sort((a, b) => a.name.localeCompare(b.name));
    if (!players.length) { staff.sendMessage("§eNo other players are online."); return; }
    const form = new ActionFormData().title("EnderSee").body("Pick a player to open their ender chest.");
    for (const p of players) form.button(p.name);
    const r = await showForm(staff, form);
    if (!r || r.canceled || r.selection === undefined) return;
    open(staff, players[r.selection]);
  }

  system.beforeEvents.startup.subscribe((init) => {
    init.customCommandRegistry.registerCommand({
      name: "zc:endersee",
      description: "Staff: open a player's ender chest to view and edit it",
      permissionLevel: CommandPermissionLevel.Any, // the gate decides (staff tags work too)
      cheatsRequired: false,
      optionalParameters: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    }, (origin, targets) => {
      const staff = origin.sourceEntity;
      if (staff?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "This command can only be run by a player." };
      const m = gate(staff);
      if (m) return { status: CustomCommandStatus.Failure, message: m };
      const list = Array.isArray(targets) ? targets : [];
      if (list.length > 1) return { status: CustomCommandStatus.Failure, message: "Pick one player." };
      system.run(() => { (list.length ? Promise.resolve(open(staff, list[0])) : pick(staff)).catch(() => { }); });
      return { status: CustomCommandStatus.Success };
    });
  });
}
