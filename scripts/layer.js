import * as C from "./constants.js";
import { getViewedLevel, roofModeActive } from "./view.js";

const COLORS = {
  stairs: 0xff9900,
  building: 0x3399ff
};

const DIRECTION_ARROWS = {
  both: "↕",
  up: "↑",
  down: "↓"
};

/* -------------------------------------------- */
/*  Persistent overlay (visible to everyone)     */
/* -------------------------------------------- */

let overlay = null;

function ensureOverlay() {
  if (!overlay || overlay.destroyed || overlay.parent !== canvas.interface) {
    overlay = new PIXI.Container();
    overlay.zIndex = 400;
    overlay.eventMode = "none";
    canvas.interface.addChild(overlay);
  }
  return overlay;
}

/**
 * Redraw the module overlay:
 * - the ROOF: when the point-of-view token is outside the building, the top
 *   level's floor image is painted over the building rectangles, above fog
 *   and vision, while the token keeps interacting with its own floor;
 * - the stairs / building zone rectangles, GM ONLY (players never see them).
 * Stairs zones are only drawn for the currently viewed level (zones without
 * a level apply everywhere and are always drawn).
 */
export function refreshOverlay() {
  if (!canvas.ready) return;
  const o = ensureOverlay();
  for (const child of [...o.children]) child.destroy({ children: true });
  const scene = canvas.scene;
  if (!C.isComposite(scene)) return;

  drawRoof(o, scene);

  if (!game.user.isGM) return;
  const viewed = getViewedLevel();
  for (const r of C.stairsRectsForLevel(scene, viewed)) {
    o.addChild(makeRect(r, COLORS.stairs, 0.9, 0.15));
    o.addChild(makeLabel(stairsLabel(scene, r), r, COLORS.stairs));
  }
  for (const r of C.buildingRects(scene)) {
    o.addChild(makeRect(r, COLORS.building, 0.9, 0.06));
    o.addChild(makeLabel(C.loc("MLS.Layer.Building"), r, COLORS.building));
  }
}

/**
 * Paint the top level's floor image over the building rectangles when the
 * point-of-view token stands outside the building.
 */
function drawRoof(overlayContainer, scene) {
  if (!roofModeActive()) return;
  const top = C.topLevel(scene);
  if (top == null) return;
  const rects = C.buildingRects(scene);

  // The roof image comes from the top level's floor tile, whose texture is
  // already loaded even while the tile itself is hidden
  const tiles = canvas.tiles.placeables.filter(t => t.document.getFlag(C.MODULE_ID, "level") === top && t.texture);
  const roofTile = tiles.find(t => t.document.getFlag(C.MODULE_ID, "floor"))
    ?? tiles.sort((a, b) => (b.document.width * b.document.height) - (a.document.width * a.document.height))[0];
  if (!roofTile) return;

  const container = new PIXI.Container();
  container.eventMode = "none";
  const sprite = new PIXI.Sprite(roofTile.texture);
  sprite.position.set(roofTile.document.x, roofTile.document.y);
  sprite.width = roofTile.document.width;
  sprite.height = roofTile.document.height;
  const mask = new PIXI.Graphics();
  mask.beginFill(0xffffff);
  for (const r of rects) mask.drawRect(r.x, r.y, r.width, r.height);
  mask.endFill();
  container.addChild(sprite);
  container.addChild(mask);
  container.mask = mask;
  overlayContainer.addChildAt(container, 0);
}

function stairsLabel(scene, r) {
  const arrow = DIRECTION_ARROWS[r.direction ?? "both"] ?? DIRECTION_ARROWS.both;
  const where = r.level == null
    ? C.loc("MLS.StairsConfig.AnyLevelShort")
    : C.locf("MLS.Layer.LevelShort", { level: r.level });
  return `${C.loc("MLS.Layer.Stairs")} ${arrow} · ${where}`;
}

function makeRect(r, color, lineAlpha, fillAlpha) {
  const g = new PIXI.Graphics();
  g.lineStyle(3, color, lineAlpha);
  g.beginFill(color, fillAlpha);
  g.drawRect(r.x, r.y, r.width, r.height);
  g.endFill();
  return g;
}

function makeLabel(text, r, color) {
  const style = CONFIG.canvasTextStyle.clone();
  style.fontSize = 22;
  style.fill = color;
  const label = new PIXI.Text(text, style);
  label.position.set(r.x + 6, r.y + 4);
  return label;
}

/* -------------------------------------------- */
/*  Stairs configuration dialog                  */
/* -------------------------------------------- */

/**
 * Show the stairs zone configuration dialog (level binding + direction).
 * @param {Scene} scene
 * @param {object} data              Current zone values
 * @param {object} [options]
 * @param {boolean} [options.isNew]  Hide the delete button for new zones
 * @returns {Promise<{level: number|null, direction: string}|"delete"|null>}
 */
async function stairsConfigDialog(scene, data, { isNew = false } = {}) {
  const nums = C.levelNumbers(scene);
  const levelOptions = [
    `<option value="" ${data.level == null ? "selected" : ""}>${C.loc("MLS.StairsConfig.AnyLevel")}</option>`,
    ...nums.map(n =>
      `<option value="${n}" ${n === data.level ? "selected" : ""}>${C.levelName(scene, n)} (${C.locf("MLS.Layer.LevelShort", { level: n })})</option>`
    )
  ].join("");

  const dirLabels = {
    both: C.loc("MLS.StairsConfig.DirBoth"),
    up: C.loc("MLS.StairsConfig.DirUp"),
    down: C.loc("MLS.StairsConfig.DirDown")
  };
  const current = data.direction ?? "both";
  const dirOptions = ["both", "up", "down"]
    .map(d => `<option value="${d}" ${d === current ? "selected" : ""}>${dirLabels[d]}</option>`)
    .join("");

  const content = `
    <div class="form-group">
      <label>${C.loc("MLS.StairsConfig.LevelLabel")}</label>
      <select name="level" style="width: 100%;">${levelOptions}</select>
      <p class="hint">${C.loc("MLS.StairsConfig.LevelHint")}</p>
    </div>
    <div class="form-group">
      <label>${C.loc("MLS.StairsConfig.DirectionLabel")}</label>
      <select name="direction" style="width: 100%;">${dirOptions}</select>
      <p class="hint">${C.loc("MLS.StairsConfig.DirectionHint")}</p>
    </div>`;

  const buttons = [
    {
      action: "save",
      label: C.loc("MLS.StairsConfig.Save"),
      icon: "fa-solid fa-check",
      default: true,
      callback: (event, button) => {
        const raw = button.form.elements.level.value;
        return {
          level: raw === "" ? null : Number(raw),
          direction: button.form.elements.direction.value
        };
      }
    }
  ];
  if (!isNew) {
    buttons.push({
      action: "delete",
      label: C.loc("MLS.StairsConfig.Delete"),
      icon: "fa-solid fa-trash"
    });
  }
  buttons.push({
    action: "cancel",
    label: C.loc("MLS.StairsConfig.Cancel"),
    icon: "fa-solid fa-xmark"
  });

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: C.loc("MLS.StairsConfig.Title") },
    content,
    buttons,
    rejectClose: false
  });
  if (result === "delete") return "delete";
  if (!result || result === "cancel") return null;
  return result;
}

/* -------------------------------------------- */
/*  Interaction layer (GM drawing tools)         */
/* -------------------------------------------- */

export class MLSLayer extends foundry.canvas.layers.InteractionLayer {

  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "mls",
      zIndex: 480
    });
  }

  /** Drag preview graphics */
  #preview = null;

  get #activeTool() {
    const tool = ui.controls?.tool;
    return typeof tool === "string" ? tool : (tool?.name ?? null);
  }

  /** @override */
  async _draw(options) {
    await super._draw(options);
    this.#preview = this.addChild(new PIXI.Graphics());
  }

  /** @override */
  _onDragLeftStart(event) {
    if (!game.user.isGM) return;
    this.#preview?.clear();
  }

  /** @override */
  _onDragLeftMove(event) {
    if (!game.user.isGM || !this.#preview) return;
    const rect = this.#dragRect(event);
    if (!rect) return;
    const color = this.#activeTool === "building" ? COLORS.building : COLORS.stairs;
    const g = this.#preview;
    g.clear();
    g.lineStyle(2, color, 0.8);
    g.beginFill(color, 0.1);
    g.drawRect(rect.x, rect.y, rect.width, rect.height);
    g.endFill();
  }

  /** @override */
  async _onDragLeftDrop(event) {
    this.#preview?.clear();
    if (!game.user.isGM) return;
    const scene = canvas.scene;
    if (!C.isComposite(scene)) {
      return ui.notifications.warn(C.loc("MLS.Warn.NotComposite"));
    }
    const rect = this.#dragRect(event);
    if (!rect || rect.width < 10 || rect.height < 10) return;

    const key = this.#activeTool === "building" ? "building" : "stairs";
    const entry = { id: foundry.utils.randomID(), ...rect };

    if (key === "stairs") {
      const config = await stairsConfigDialog(scene, { level: getViewedLevel(), direction: "both" }, { isNew: true });
      if (!config) return;
      entry.level = config.level;
      entry.direction = config.direction;
    }

    const list = [...(scene.getFlag(C.MODULE_ID, key) ?? [])];
    list.push(entry);
    await scene.setFlag(C.MODULE_ID, key, list);
  }

  /** @override */
  _onDragLeftCancel(event) {
    this.#preview?.clear();
  }

  /**
   * Right-click a stairs zone to edit it (level, direction, delete);
   * right-click a building zone to delete it (with confirmation).
   * Only zones of the currently viewed level are targeted.
   * @override
   */
  async _onClickRight(event) {
    if (!game.user.isGM) return;
    const scene = canvas.scene;
    if (!C.isComposite(scene)) return;
    const pos = event.interactionData?.origin ?? event.getLocalPosition?.(this);
    if (!pos) return;

    // Stairs zones: edit dialog
    const stairs = scene.getFlag(C.MODULE_ID, "stairs") ?? [];
    const viewed = getViewedLevel();
    const stairsHit = [...stairs].reverse().find(r =>
      C.rectContains(r, pos) && ((r.level == null) || (r.level === viewed))
    );
    if (stairsHit) {
      const result = await stairsConfigDialog(scene, stairsHit);
      if (result === "delete") {
        await scene.setFlag(C.MODULE_ID, "stairs", stairs.filter(r => r.id !== stairsHit.id));
      } else if (result) {
        const updated = stairs.map(r => r.id === stairsHit.id ? { ...r, level: result.level, direction: result.direction } : r);
        await scene.setFlag(C.MODULE_ID, "stairs", updated);
      }
      return;
    }

    // Building zones: delete confirmation
    const building = scene.getFlag(C.MODULE_ID, "building") ?? [];
    const buildingHit = [...building].reverse().find(r => C.rectContains(r, pos));
    if (buildingHit) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: C.loc("MLS.Layer.DeleteTitle") },
        content: `<p>${C.locf("MLS.Layer.DeleteContent", { type: C.loc("MLS.Layer.Building") })}</p>`,
        rejectClose: false,
        modal: true
      });
      if (confirmed) {
        await scene.setFlag(C.MODULE_ID, "building", building.filter(r => r.id !== buildingHit.id));
      }
    }
  }

  #dragRect(event) {
    const { origin, destination } = event.interactionData ?? {};
    if (!origin || !destination) return null;
    return {
      x: Math.min(origin.x, destination.x),
      y: Math.min(origin.y, destination.y),
      width: Math.abs(destination.x - origin.x),
      height: Math.abs(destination.y - origin.y)
    };
  }
}
