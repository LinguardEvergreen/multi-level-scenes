import * as C from "./constants.js";
import { followToken } from "./view.js";

/**
 * Per-client memory of the stairs zones each token currently overlaps.
 * The dialog only appears when a token enters a zone it was NOT already
 * inside (outside → inside transition). Answering the dialog — including
 * "stay" or closing it — keeps that zone silent until the token fully
 * leaves it and enters it again. Leaving a zone never prompts.
 *
 * After a level change the memory is re-anchored to the zones overlapped
 * on the NEW floor, so the arrival zone (e.g. the "down" zone at the top
 * of a stairwell) does not immediately prompt on the next step.
 *
 * @type {Map<string, Set<string>>} tokenId -> ids of the zones it occupies
 */
const occupied = new Map();

export function clearStairsState() {
  occupied.clear();
}

export function forgetToken(tokenId) {
  occupied.delete(tokenId);
}

/**
 * The stairs zones a token currently overlaps on its own floor.
 * Any overlap counts, not just the token's center.
 * @param {TokenDocument} tokenDoc
 * @returns {object[]}
 */
function zonesAt(tokenDoc) {
  const bounds = C.tokenBounds(tokenDoc);
  const level = C.tokenLevel(tokenDoc);
  return C.stairsRects(tokenDoc.parent).filter(r =>
    C.rectsOverlap(bounds, r) && ((r.level == null) || (r.level === level))
  );
}

/** Store the zones a token currently occupies (or clear the entry). */
function anchor(tokenDoc) {
  const ids = new Set(zonesAt(tokenDoc).map(z => z.id));
  if (ids.size) occupied.set(tokenDoc.id, ids);
  else occupied.delete(tokenDoc.id);
  return ids;
}

/**
 * Called when a token moves: prompt its owner with an "up / down / stay"
 * dialog if it just entered a stairs zone. The dialog is always shown on
 * entry, even when only one direction is available.
 * @param {TokenDocument} tokenDoc
 */
export async function maybePromptStairs(tokenDoc) {
  const scene = tokenDoc.parent;
  if (!C.isComposite(scene)) return;
  if (!tokenDoc.isOwner) return;

  const zones = zonesAt(tokenDoc);
  const previous = occupied.get(tokenDoc.id) ?? new Set();
  anchor(tokenDoc);

  // Prompt only for a zone the token was not already inside
  const entered = zones.find(z => !previous.has(z.id));
  if (!entered) return;

  const nums = C.levelNumbers(scene);
  const cur = C.tokenLevel(tokenDoc);
  const direction = entered.direction ?? "both";
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

  // Re-anchor on the new floor so the arrival zone stays silent until the
  // token leaves it and comes back
  anchor(tokenDoc);

  // The GM view follows the token it just moved through the stairs
  if (game.user.isGM) followToken();
  ui.notifications.info(C.locf("MLS.Stairs.Moved", {
    token: tokenDoc.name,
    name: C.levelName(scene, target),
    level: target
  }));
}
