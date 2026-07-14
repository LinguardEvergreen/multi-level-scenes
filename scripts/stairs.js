import * as C from "./constants.js";

/**
 * When a token finishes a movement inside a stairs rectangle, prompt its
 * owner (the client that moved it) with an "up / down / stay" dialog.
 * The dialog is always shown, even when only one direction is available.
 *
 * A stairs rectangle is level-agnostic: entering it on level N offers the
 * next level above and/or below N among the levels of the composite scene,
 * so a single stairwell rectangle works across every floor.
 *
 * @param {TokenDocument} tokenDoc
 */
export async function maybePromptStairs(tokenDoc) {
  const scene = tokenDoc.parent;
  if (!C.isComposite(scene)) return;
  if (!tokenDoc.isOwner) return;

  const center = C.tokenCenter(tokenDoc);
  const rect = C.stairsRects(scene).find(r => C.rectContains(r, center));
  if (!rect) return;

  const nums = C.levelNumbers(scene);
  const cur = C.tokenLevel(tokenDoc);
  const up = nums.find(n => n > cur) ?? null;
  const down = [...nums].reverse().find(n => n < cur) ?? null;
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
  });
  ui.notifications.info(C.locf("MLS.Stairs.Moved", {
    token: tokenDoc.name,
    name: C.levelName(scene, target),
    level: target
  }));
}
