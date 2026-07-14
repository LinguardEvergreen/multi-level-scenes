import * as C from "./constants.js";

const COLORS = {
  stairs: 0xff9900,
  building: 0x3399ff
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
 * Redraw the stairs / building rectangles overlay.
 * GM sees both zone types with labels; players see stairs zones faintly
 * (if enabled in settings) and never see building zones.
 */
export function refreshOverlay() {
  if (!canvas.ready) return;
  const o = ensureOverlay();
  for (const child of [...o.children]) child.destroy({ children: true });
  const scene = canvas.scene;
  if (!C.isComposite(scene)) return;

  const isGM = game.user.isGM;
  const showStairsToPlayers = game.settings.get(C.MODULE_ID, "showStairsToPlayers");

  if (isGM || showStairsToPlayers) {
    for (const r of C.stairsRects(scene)) {
      o.addChild(makeRect(r, COLORS.stairs, isGM ? 0.9 : 0.35, isGM ? 0.15 : 0.06));
      if (isGM) o.addChild(makeLabel(C.loc("MLS.Layer.Stairs"), r, COLORS.stairs));
    }
  }
  if (isGM) {
    for (const r of C.buildingRects(scene)) {
      o.addChild(makeRect(r, COLORS.building, 0.9, 0.06));
      o.addChild(makeLabel(C.loc("MLS.Layer.Building"), r, COLORS.building));
    }
  }
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
    const list = [...(scene.getFlag(C.MODULE_ID, key) ?? [])];
    list.push({ id: foundry.utils.randomID(), ...rect });
    await scene.setFlag(C.MODULE_ID, key, list);
  }

  /** @override */
  _onDragLeftCancel(event) {
    this.#preview?.clear();
  }

  /**
   * Right-click deletes the zone under the cursor (with confirmation).
   * @override
   */
  async _onClickRight(event) {
    if (!game.user.isGM) return;
    const scene = canvas.scene;
    if (!C.isComposite(scene)) return;
    const pos = event.interactionData?.origin ?? event.getLocalPosition?.(this);
    if (!pos) return;
    for (const key of ["stairs", "building"]) {
      const list = scene.getFlag(C.MODULE_ID, key) ?? [];
      const hit = list.findLast?.(r => C.rectContains(r, pos))
        ?? [...list].reverse().find(r => C.rectContains(r, pos));
      if (!hit) continue;
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: C.loc("MLS.Layer.DeleteTitle") },
        content: `<p>${C.locf("MLS.Layer.DeleteContent", { type: C.loc(key === "building" ? "MLS.Layer.Building" : "MLS.Layer.Stairs") })}</p>`,
        rejectClose: false,
        modal: true
      });
      if (confirmed) {
        await scene.setFlag(C.MODULE_ID, key, list.filter(r => r.id !== hit.id));
      }
      return;
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
