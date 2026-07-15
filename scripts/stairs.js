import * as C from "./constants.js";
import { followToken } from "./view.js";

/**
 * Per-client memory of which stairs zone each token currently occupies.
 * A token is only prompted when it transitions from "outside" to "inside"
 * a zone: answering "stay" (or anything else) suppresses further prompts
 * until the token fully leaves the zone and enters it again. Leaving a
 * zone never prompts.
 * @type {Map<string, string>} tokenId -> stairs zone id
 */
const activeZone = new Map();

export function clearStairsState() {
  activeZone.clear();
}

export function forgetToken(tokenId) {
  activeZone.delete(tokenId);
}

/**
 * When a token moves, check the stairs zone it overlaps (any part of the
 * token counts, not just its center) and prompt its owner with an
 * "up / down / stay" dialog on zone entry. The dialog is always shown on
 * entry, even when only one direction is available.
 *
 * A stairs zone may be bound to a level (it only triggers for tokens on
 * that floor) and to a direction: "up", "down" or "both".
 *
 * @param {TokenDocument} tokenDoc
 */
export async function maybePromptStairs(tokenDoc) {
  const scene = tokenDoc.parent;
  if (!C.isComposite(scene)) return;
  if (!tokenDoc.isOwner) return;

  const bounds = C.tokenBounds(tokenDoc);
  const cur = C.tokenLevel(tokenDoc);
  const rect = C.stairsRects(scene).find(r =>
    C.rectsOverlap(bounds, r) && ((r.level == null) || (r.level === cur))
  );

  // Outside every zone: clear the memory so the next entry prompts again
  if (!rect) {
    activeZone.delete(tokenDoc.id);
    return;
  }
  // Still inside the same zone it was already prompted for: stay silent
  if (activeZone.get(tokenDoc.id) === rect.id) return;
  activeZone.set(tokenDoc.id, rect.id);

  const nums = C.levelNumbers(scene);
  const direction = rect.direction ?? "both";
  const up = direction !== "down" ? (nums.find(n => n > cur) ?? null) : null;
  const down = direction !== "up" ? ([...nums].reverse().find(n => n < cur) ?? null) : null;
  if (up === null && down === null) return;

  const buttons = [];
  if (up !== null) {
    buttons.push({
      action: "up",
      label: C.locf("MLS.Stairs.Up", { name: C.levelName(scene, up), level: up }),
      icon: "fa-solid fa-arrow-up"
    });
  }
  if (down !== null) {
    buttons.push({
      action: "down",
      label: C.locf("MLS.Stairs.Down", { name: C.levelName(scene, down), level: down }),
      icon: "fa-solid fa-arrow-down"
    });
  }
  buttons.push({
    action: "stay",
    label: C.loc("MLS.Stairs.Stay"),
    icon: "fa-solid fa-xmark",
    default: true
  });

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: C.loc("MLS.Stairs.Title") },
    content: `<p>${C.locf("MLS.Stairs.Prompt", { name: tokenDoc.name })}</p>`,
    buttons,
    rejectClose: false
  });

  const target = choice === "up" ? up : (choice === "down" ? down : null);
  if (target === null || target === undefined) return;

  await tokenDoc.update({
    [`flags.${C.MODULE_ID}.level`]: target,
    elevation: C.elevationFor(target)
  }, { mlsSync: true });

  // The GM view follows the token it just moved through the stairs
  if (game.user.isGM) followToken();
  ui.notifications.info(C.locf("MLS.Stairs.Moved", {
    token: tokenDoc.name,
    name: C.levelName(scene, target),
    level: target
  }));
}
