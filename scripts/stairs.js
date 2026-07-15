import * as C from "./constants.js";
import { setGMLevel } from "./view.js";

/**
 * When a token finishes a movement inside a stairs rectangle, prompt its
 * owner (the client that moved it) with an "up / down / stay" dialog.
 * The dialog is always shown, even when only one direction is available.
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

  const center = C.tokenCenter(tokenDoc);
  const cur = C.tokenLevel(tokenDoc);
  const rect = C.stairsRects(scene).find(r =>
    C.rectContains(r, center) && ((r.level == null) || (r.level === cur))
  );
  if (!rect) return;

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
  if (game.user.isGM) setGMLevel(target);
  else ui.notifications.info(C.locf("MLS.Stairs.Moved", {
    token: tokenDoc.name,
    name: C.levelName(scene, target),
    level: target
  }));
}
