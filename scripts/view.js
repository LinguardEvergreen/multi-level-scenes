import * as C from "./constants.js";
import { refreshOverlay } from "./layer.js";

/**
 * Per-client level view logic.
 *
 * - The GM chooses the viewed level manually (arrow tools in scene controls).
 * - Players automatically view the level their token is on. If their token is
 *   outside every "building" rectangle they see the top level (the roof).
 *
 * Everything here is purely local (client-side): tiles, walls, lights and
 * tokens of other levels are hidden without modifying the documents.
 */

let gmLevel = null;

/* -------------------------------------------- */
/*  Viewed level                                 */
/* -------------------------------------------- */

/**
 * The token that drives a player's point of view.
 * @returns {Token|null}
 */
export function primaryToken() {
  if (!canvas.ready) return null;
  const controlled = canvas.tokens.controlled[0];
  if (controlled) return controlled;
  return canvas.tokens.placeables.find(t => t.isOwner && t.actor?.hasPlayerOwner)
    ?? canvas.tokens.placeables.find(t => t.isOwner)
    ?? null;
}

/**
 * The interaction level of this client: the floor whose walls, doors,
 * lights and tokens are active. This is always the ACTUAL floor of the
 * point-of-view token — standing outside the building does NOT change it
 * (a token outside is on the ground: it sees the roof image, but interacts
 * with its own floor, entrance doors included).
 *
 * Players follow their token. The GM follows the token they control — the
 * arrow tools set a manual override, cleared again as soon as the GM
 * controls or moves a token.
 * @returns {number|null}
 */
export function getViewedLevel() {
  const scene = canvas.scene;
  if (!C.isComposite(scene)) return null;
  if (game.user.isGM) {
    if (gmLevel != null && C.levelNumbers(scene).includes(gmLevel)) return gmLevel;
    const controlled = canvas.tokens.controlled[0];
    if (controlled) return C.tokenLevel(controlled.document);
    return C.defaultLevel(scene);
  }
  const token = primaryToken();
  if (!token) return C.defaultLevel(scene);
  return C.tokenLevel(token.document);
}

/**
 * The level whose floor image (tile) is displayed. Purely visual: when the
 * point-of-view token stands outside every building rectangle, the roof
 * (top level) image is shown instead of its own floor — but walls, doors
 * and everything else keep following {@link getViewedLevel}.
 * @returns {number|null}
 */
export function getDisplayedTileLevel() {
  const scene = canvas.scene;
  if (!C.isComposite(scene)) return null;
  if (game.user.isGM && gmLevel != null && C.levelNumbers(scene).includes(gmLevel)) return gmLevel;
  const token = game.user.isGM ? canvas.tokens.controlled[0] : primaryToken();
  if (token && C.isOutsideBuilding(token.document)) {
    return C.topLevel(scene) ?? getViewedLevel();
  }
  return getViewedLevel();
}

export function resetGMLevel() {
  gmLevel = null;
}

/**
 * Drop the GM manual override so the view derives live from the controlled
 * token again (floor and roof logic). Called when the GM moves a token.
 */
export function followToken() {
  if (game.user.isGM) gmLevel = null;
}

/**
 * Handle token control changes: gaining control makes the GM view follow
 * that token; releasing the last token freezes the view on the level the
 * token was viewing, so the map does not jump around.
 * @param {Token} token
 * @param {boolean} controlled
 */
export function onControlToken(token, controlled) {
  if (!canvas.ready || !C.isComposite(canvas.scene)) return;
  if (game.user.isGM) {
    if (controlled) gmLevel = null;
    else if (!canvas.tokens.controlled.length) {
      const lvl = C.tokenLevel(token.document);
      if (C.levelNumbers(canvas.scene).includes(lvl)) gmLevel = lvl;
    }
  }
  refreshView();
}

export function setGMLevel(level) {
  const scene = canvas.scene;
  if (!C.isComposite(scene)) return;
  if (!C.levelNumbers(scene).includes(level)) {
    return ui.notifications.warn(C.locf("MLS.Warn.NoSuchLevel", { level }));
  }
  gmLevel = level;
  refreshView();
  ui.notifications.info(C.locf("MLS.Info.ViewingLevel", { name: C.levelName(scene, level), level }));
}

export function stepGMLevel(delta) {
  const scene = canvas.scene;
  if (!C.isComposite(scene)) {
    return ui.notifications.warn(C.loc("MLS.Warn.NotComposite"));
  }
  const nums = C.levelNumbers(scene);
  if (!nums.length) return;
  const cur = getViewedLevel();
  let idx = nums.indexOf(cur);
  if (idx === -1) idx = 0;
  const next = nums[Math.clamp(idx + delta, 0, nums.length - 1)];
  if (next === cur) {
    return ui.notifications.info(C.locf("MLS.Info.ViewingLevel", { name: C.levelName(scene, cur), level: cur }));
  }
  setGMLevel(next);
}

/* -------------------------------------------- */
/*  Visibility rules                             */
/* -------------------------------------------- */

/**
 * Should a token be visible for the current client, level-wise?
 * @param {Token} token
 * @returns {boolean}
 */
export function tokenLevelVisible(token) {
  const scene = token.document?.parent;
  if (!scene || !C.isComposite(scene)) return true;
  if (token.controlled) return true;
  const viewed = getViewedLevel();
  const lvl = C.tokenLevel(token.document);
  const outside = C.isOutsideBuilding(token.document);
  if (game.user.isGM) return (lvl === viewed) || outside;
  const mine = primaryToken();
  if (mine === token) return true;
  if (lvl === viewed) return true;
  // Two tokens both outside the building see each other regardless of level
  const myOutside = mine ? C.isOutsideBuilding(mine.document) : false;
  return myOutside && outside;
}

/**
 * Generic per-document level visibility (tiles, walls, lights).
 * Documents without a level flag are always visible.
 * @param {Document} doc
 * @returns {boolean}
 */
export function docLevelVisible(doc) {
  const scene = doc.parent;
  if (!C.isComposite(scene)) return true;
  const lvl = doc.getFlag(C.MODULE_ID, "level");
  if (lvl == null) return true;
  return lvl === getViewedLevel();
}

/* -------------------------------------------- */
/*  Enforcement hooks (called from main.js)      */
/* -------------------------------------------- */

export function enforceTileVisibility(tile) {
  if (!C.isComposite(tile.document.parent)) return;
  const lvl = tile.document.getFlag(C.MODULE_ID, "level");
  if (lvl == null) return;
  // Tiles follow the DISPLAYED level (roof logic), unlike walls & doors
  const shown = lvl === getDisplayedTileLevel();
  if (!shown) {
    tile.visible = false;
    if (tile.mesh) tile.mesh.visible = false;
  } else if (tile.mesh) {
    tile.mesh.visible = tile.visible && (!tile.document.hidden || game.user.isGM);
  }
}

export function enforceWallVisibility(wall) {
  if (!C.isComposite(wall.document.parent)) return;
  if (wall.document.getFlag(C.MODULE_ID, "level") == null) return;
  wall.visible = docLevelVisible(wall.document);
}

export function enforceLightVisibility(light) {
  if (!C.isComposite(light.document.parent)) return;
  if (light.document.getFlag(C.MODULE_ID, "level") == null) return;
  if (!docLevelVisible(light.document)) light.visible = false;
}

/* -------------------------------------------- */
/*  Core patches                                 */
/* -------------------------------------------- */

/**
 * Patch Token#isVisible so tokens on other levels are hidden locally.
 * Must be called once during "init".
 */
export function patchToken() {
  const Token = foundry.canvas.placeables.Token;
  const original = Object.getOwnPropertyDescriptor(Token.prototype, "isVisible");
  if (!original?.get) {
    console.error(`${C.MODULE_ID} | Unable to patch Token#isVisible`);
    return;
  }
  Object.defineProperty(Token.prototype, "isVisible", {
    get() {
      try {
        if (!tokenLevelVisible(this)) return false;
      } catch (err) {
        console.error(`${C.MODULE_ID} | tokenLevelVisible failed`, err);
      }
      return original.get.call(this);
    },
    configurable: true
  });
}

/**
 * Patch AmbientLight#initializeLightSource so lights on other levels are
 * suppressed locally, surviving any core lighting re-initialization.
 * Must be called once during "init".
 */
export function patchLights() {
  const AmbientLight = foundry.canvas.placeables.AmbientLight;
  const original = AmbientLight.prototype.initializeLightSource;
  AmbientLight.prototype.initializeLightSource = function(options = {}) {
    try {
      if (!options.deleted && !docLevelVisible(this.document)) {
        options = { ...options, deleted: true };
      }
    } catch (err) {
      console.error(`${C.MODULE_ID} | light level filter failed`, err);
    }
    return original.call(this, options);
  };
}

/**
 * Patch ClockwiseSweepPolygon edge inclusion so walls of non-viewed levels
 * never take part in vision, lighting, sound or movement-collision sweeps.
 * This is the primary wall filter: it works even if the edge collection
 * still contains every wall. Must be called once during "init".
 */
export function patchSweep() {
  const CSP = foundry.canvas.geometry?.ClockwiseSweepPolygon ?? globalThis.ClockwiseSweepPolygon;
  if (!CSP?.prototype?._testEdgeInclusion) {
    console.error(`${C.MODULE_ID} | Unable to patch ClockwiseSweepPolygon#_testEdgeInclusion`);
    return;
  }
  const original = CSP.prototype._testEdgeInclusion;
  CSP.prototype._testEdgeInclusion = function(edge, ...args) {
    try {
      if (!edgeLevelVisible(edge)) return false;
    } catch (err) {
      console.error(`${C.MODULE_ID} | edge level filter failed`, err);
    }
    return original.call(this, edge, ...args);
  };
}

function edgeLevelVisible(edge) {
  if (!canvas.ready || !C.isComposite(canvas.scene)) return true;
  const doc = edge?.object?.document ?? canvas.walls.get(edge?.id)?.document;
  if (!doc || (doc.documentName !== "Wall")) return true;
  return docLevelVisible(doc);
}

/**
 * Patch DoorControl#isVisible so door icons of non-viewed levels are hidden
 * (for the GM too). Must be called once during "init".
 */
export function patchDoorControls() {
  const DoorControl = foundry.canvas.containers?.DoorControl ?? globalThis.DoorControl;
  const original = DoorControl && Object.getOwnPropertyDescriptor(DoorControl.prototype, "isVisible");
  if (!original?.get) {
    console.error(`${C.MODULE_ID} | Unable to patch DoorControl#isVisible`);
    return;
  }
  Object.defineProperty(DoorControl.prototype, "isVisible", {
    get() {
      try {
        const doc = this.wall?.document;
        if (doc && !docLevelVisible(doc)) return false;
      } catch (err) {
        console.error(`${C.MODULE_ID} | door level filter failed`, err);
      }
      return original.get.call(this);
    },
    configurable: true
  });
}

/**
 * Wrap canvas.edges.initialize so wall edges of non-viewed levels are removed
 * from the client-side edge collection (vision & movement blocking).
 * Must be called on every "canvasReady".
 */
export function wrapEdges() {
  const edges = canvas.edges;
  if (!edges || edges._mlsWrapped) return;
  const original = edges.initialize.bind(edges);
  edges.initialize = (...args) => {
    const result = original(...args);
    try {
      pruneEdges();
    } catch (err) {
      console.error(`${C.MODULE_ID} | edge pruning failed`, err);
    }
    return result;
  };
  edges._mlsWrapped = true;
}

function pruneEdges() {
  if (!C.isComposite(canvas.scene)) return;
  const toDelete = [];
  for (const [key, edge] of canvas.edges.entries()) {
    const doc = edge.object?.document ?? canvas.walls.get(edge.id ?? key)?.document;
    if (!doc || doc.documentName !== "Wall") continue;
    if (!docLevelVisible(doc)) toDelete.push(key);
  }
  for (const key of toDelete) canvas.edges.delete(key);
}

/* -------------------------------------------- */
/*  Full refresh                                 */
/* -------------------------------------------- */

/**
 * Re-apply the level view on this client: rebuild edges, re-initialize
 * lighting & vision and refresh every level-flagged placeable.
 */
export function refreshView() {
  if (!canvas.ready) return;
  if (!C.isComposite(canvas.scene)) return;
  canvas.edges.initialize();
  canvas.perception.update({
    initializeLighting: true,
    refreshLighting: true,
    initializeVision: true,
    refreshVision: true,
    refreshOcclusion: true
  });
  for (const t of canvas.tiles.placeables) t.renderFlags.set({ refresh: true });
  for (const t of canvas.tokens.placeables) t.renderFlags.set({ refreshVisibility: true });
  for (const w of canvas.walls.placeables) w.renderFlags.set({ refresh: true });
  for (const l of canvas.lighting.placeables) l.renderFlags.set({ refresh: true });
  try {
    for (const dc of canvas.controls?.doors?.children ?? []) dc.visible = dc.isVisible;
  } catch (err) {
    console.error(`${C.MODULE_ID} | door controls refresh failed`, err);
  }
  refreshOverlay();
}
