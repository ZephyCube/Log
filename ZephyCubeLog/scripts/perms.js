// /zc:perms [player]: one menu for every permission tag the ZephyCube add-ons read.
// Pick an online player (or name one), then switch each permission on or off.
//
// Each permission is a plain tag (for example zc:border_bypass). Some of them can also be granted by the
// AdminTools bitmask tag zc:p.<hex>; the bit numbers below match AdminTools, so a permission given there shows as on
// here too. Turning one off here removes the plain tag and clears its bit in zc:p.<hex>.
import * as mc from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { showForm } from "./modules.js";

const { world, system } = mc;

// tag: the plain tag. bit: AdminTools bitmask bit, or undefined when there is none.
export const PERMS = [
  { tag: "zc_logs", label: "Log: open the viewer and chest scanner", addon: "Log" },
  { tag: "zc:invsee", label: "InvSee: view and edit players' inventories (staff tags admin/moderator/mod also allow it)", addon: "Log" },
  { tag: "zc:border_bypass", bit: 8, label: "Border bypass: can cross the world border", addon: "Border" },
  { tag: "zc:lag_alert", bit: 10, label: "Lag alerts: low TPS and mob cap messages", addon: "AntiLag" },
  { tag: "zc:combat_bypass", label: "Combat bypass: never combat tagged", addon: "AntiCombat" },
  { tag: "zc:pvpday_bypass", label: "PvE-day PvP bypass: can hit and be hit on PvE days", addon: "AntiCombat" },
];

function maskTag(player) {
  try { return player.getTags().find((t) => t.startsWith("zc:p.")); } catch { return undefined; }
}
export function hasPerm(player, perm) {
  try {
    if (player.hasTag(perm.tag)) return true;
    if (perm.bit === undefined) return false;
    const t = maskTag(player);
    return !!t && ((parseInt(t.slice(5), 16) >> perm.bit) & 1) === 1;
  } catch { return false; }
}
function setPerm(player, perm, on) {
  if (on) { player.addTag(perm.tag); return; }
  player.removeTag(perm.tag);
  if (perm.bit === undefined) return;
  const t = maskTag(player);
  if (!t) return;
  const mask = parseInt(t.slice(5), 16);
  if (!((mask >> perm.bit) & 1)) return;
  const next = mask & ~(1 << perm.bit);
  player.removeTag(t);
  if (next) player.addTag(`zc:p.${next.toString(16)}`);
}

async function editPlayer(staff, target) {
  const form = new ModalFormData().title(`Permissions: ${target.name}`);
  for (const p of PERMS) form.toggle(p.label, { defaultValue: hasPerm(target, p), tooltip: `${p.addon} add-on, tag ${p.tag}${p.bit !== undefined ? `, AdminTools bit ${p.bit}` : ""}` });
  form.submitButton("Save");
  const r = await showForm(staff, form);
  if (!r || r.canceled || !r.formValues) return;
  const vals = r.formValues.filter((v) => typeof v === "boolean");
  if (vals.length !== PERMS.length || !target.isValid) return;
  const changed = [];
  PERMS.forEach((p, i) => {
    if (vals[i] === hasPerm(target, p)) return;
    try { setPerm(target, p, vals[i]); changed.push(`${p.tag} ${vals[i] ? "§aon" : "§coff"}§r`); } catch { }
  });
  try { staff.sendMessage(changed.length ? `Permissions of ${target.name}: ${changed.join(", ")}.` : `No changes for ${target.name}.`); } catch { }
}

async function pickPlayer(staff) {
  const players = world.getAllPlayers().sort((a, b) => a.name.localeCompare(b.name));
  const form = new ActionFormData().title("Permissions").body("Pick a player.");
  for (const p of players) {
    const n = PERMS.filter((x) => hasPerm(p, x)).length;
    form.button(`${p.name}\n§8${n} permission${n === 1 ? "" : "s"}`);
  }
  const r = await showForm(staff, form);
  if (!r || r.canceled || r.selection === undefined) return;
  const target = players[r.selection];
  if (target?.isValid) await editPlayer(staff, target);
}

export function registerPerms(init) {
  init.customCommandRegistry.registerCommand(
    {
      name: "zc:perms",
      description: "Permissions menu for every ZephyCube add-on (bypass and alert tags)",
      permissionLevel: mc.CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
      optionalParameters: [{ name: "player", type: mc.CustomCommandParamType.PlayerSelector }],
    },
    (origin, targets) => {
      const staff = origin.sourceEntity;
      const list = Array.isArray(targets) ? targets : [];
      if (staff?.typeId !== "minecraft:player") {
        const ps = list.length ? list : world.getAllPlayers();
        const text = ps.map((p) => `${p.name}: ${PERMS.filter((x) => hasPerm(p, x)).map((x) => x.tag).join(", ") || "none"}`).join("\n");
        return { status: mc.CustomCommandStatus.Success, message: text || "No players online." };
      }
      system.run(() => {
        (list.length === 1 ? editPlayer(staff, list[0]) : pickPlayer(staff)).catch(() => { });
      });
      return { status: mc.CustomCommandStatus.Success, message: "Close the chat to open the permissions menu." };
    }
  );
}
