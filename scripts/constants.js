export const MODULE_ID = "multi-level-scenes";

/* -------------------------------------------- */
/*  Localization helpers                        */
/* -------------------------------------------- */

export function loc(key) {
  return game.i18n.localize(key);
}

export function locf(key, data = {}) {
  return game.i18n.format(key, data);
}

/* -------------------------------------------- */
/*  Scene / level helpers                       */
/* -------------------------------------------- */

/**
 * Is this scene a composite multi-level scene built by this module?
 * @param {Scene} scene
 * @returns {boolean}
 */
export function isComposite(scene) {
  return Array.isArray(scene?.getFlag(MODULE_ID, "levels"));
}

/**
 * Get the ordered level metadata of a composite scene.
 * @param {Scene} scene
 * @returns {{level: number, name: string, src: string|null}[]}
 */
export function levelsOf(scene) {
  const levels = scene?.getFlag(MODULE_ID, "levels") ?? [];
  return [...levels].sort((a, b) => a.level - b.level);
}

/**
 * Get the sorted numeric levels of a composite scene.
 * @param {Scene} scene
 * @returns {number[]}
 */
export function levelNumbers(scene) {
  return levelsOf(scene).map(l => l.level);
}

/**
 * The top-most level (the roof) of a composite scene.
 * @param {Scene} scene
 * @returns {number|null}
 */
export function topLevel(scene) {
  const nums = levelNumbers(scene);
  return nums.length ? nums[nums.length - 1] : null;
}

/**
 * Display name for a level of a composite scene.
 * @param {Scene} scene
 * @param {number} level
 * @returns {string}
 */
export function levelName(scene, level) {
  const meta = levelsOf(scene).find(l => l.level === level);
  return meta?.name ?? String(level);
}

/* -------------------------------------------- */
/*  Settings shortcuts                          */
/* -------------------------------------------- */

export function floorHeight() {
  return game.settings.get(MODULE_ID, "floorHeight");
}

/**
 * The default level for newly placed tokens (players usually start on
 * level 1, the ground floor, since 00 is the basement).
 * @param {Scene} scene
 * @returns {number}
 */
export function defaultLevel(scene) {
  const nums = levelNumbers(scene);
  const def = game.settings.get(MODULE_ID, "defaultLevel");
  if (nums.includes(def)) return def;
  return nums[0] ?? 1;
}

/* -------------------------------------------- */
/*  Token helpers                               */
/* -------------------------------------------- */

/**
 * The level a token is currently on.
 * @param {TokenDocument} tokenDoc
 * @returns {number}
 */
export function tokenLevel(tokenDoc) {
  const lvl = tokenDoc.getFlag(MODULE_ID, "level");
  return Number.isFinite(lvl) ? lvl : defaultLevel(tokenDoc.parent);
}

/**
 * Elevation (in grid distance units) matching a level.
 * Level 1 (ground floor) is elevation 0; level 0 (basement) is negative.
 * @param {number} level
 * @returns {number}
 */
export function elevationFor(level) {
  return (level - 1) * floorHeight();
}

/**
 * The floor matching a given elevation, rounding to the NEAREST floor so
 * that grids stepping elevation by 1.5m (e.g. +4.5 with floor height 5)
 * still land on the intended level.
 * E.g. with floorHeight 5: elevation 0..2.4 → level 1, 2.5..7.4 → level 2,
 * clearly negative → level 0 (basement).
 * @param {Scene} scene
 * @param {number} elevation
 * @returns {number|null}
 */
export function levelFromElevation(scene, elevation) {
  const nums = levelNumbers(scene);
  if (!nums.length) return null;
  const fh = floorHeight() || 1;
  const candidate = Math.round(elevation / fh) + 1;
  let best = nums[0];
  for (const n of nums) {
    if (n <= candidate) best = n;
  }
  return best;
}

/**
 * The pixel center of a token document.
 * @param {TokenDocument} tokenDoc
 * @returns {{x: number, y: number}}
 */
export function tokenCenter(tokenDoc) {
  const gs = tokenDoc.parent?.grid?.size ?? 100;
  return {
    x: tokenDoc.x + (tokenDoc.width * gs) / 2,
    y: tokenDoc.y + (tokenDoc.height * gs) / 2
  };
}

/* -------------------------------------------- */
/*  Rectangle zones (stairs & building)         */
/* -------------------------------------------- */

export function rectContains(rect, point) {
  return point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/**
 * The pixel bounds occupied by a token document.
 * @param {TokenDocument} tokenDoc
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function tokenBounds(tokenDoc) {
  const gs = tokenDoc.parent?.grid?.size ?? 100;
  return { x: tokenDoc.x, y: tokenDoc.y, width: tokenDoc.width * gs, height: tokenDoc.height * gs };
}

/** Do two rectangles overlap (any intersection at all)? */
export function rectsOverlap(a, b) {
  return (a.x < b.x + b.width) && (a.x + a.width > b.x)
    && (a.y < b.y + b.height) && (a.y + a.height > b.y);
}

/**
 * Stairs zones. `level` binds the zone to a floor (null = every floor,
 * legacy zones). `direction` is "up", "down" or "both" (default "both").
 * @returns {{id: string, x: number, y: number, width: number, height: number, level: number|null, direction: string}[]}
 */
export function stairsRects(scene) {
  return scene?.getFlag(MODULE_ID, "stairs") ?? [];
}

/**
 * Stairs zones that apply to a given floor.
 * @param {Scene} scene
 * @param {number} level
 */
export function stairsRectsForLevel(scene, level) {
  return stairsRects(scene).filter(r => (r.level == null) || (r.level === level));
}

/** @returns {{id: string, x: number, y: number, width: number, height: number}[]} */
export function buildingRects(scene) {
  return scene?.getFlag(MODULE_ID, "building") ?? [];
}

/**
 * Is a token outside every building rectangle?
 * If no building rectangle is defined the whole map counts as "inside"
 * (no roof logic applies).
 * @param {TokenDocument} tokenDoc
 * @returns {boolean}
 */
export function isOutsideBuilding(tokenDoc) {
  const rects = buildingRects(tokenDoc.parent);
  if (!rects.length) return false;
  const c = tokenCenter(tokenDoc);
  return !rects.some(r => rectContains(r, c));
}
