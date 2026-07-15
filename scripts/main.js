import * as C from "./constants.js";
import { MLSLayer, refreshOverlay } from "./layer.js";
import * as view from "./view.js";
import { maybePromptStairs, clearStairsState, forgetToken } from "./stairs.js";
import { openBuilder, buildComposite } from "./builder.js";

/* -------------------------------------------- */
/*  Init                                         */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(C.MODULE_ID, "floorHeight", {
    name: "MLS.Settings.FloorHeight.Name",
    hint: "MLS.Settings.FloorHeight.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 5,
    onChange: () => view.refreshView()
  });
  game.settings.register(C.MODULE_ID, "defaultLevel", {
    name: "MLS.Settings.DefaultLevel.Name",
    hint: "MLS.Settings.DefaultLevel.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 1,
    onChange: () => view.refreshView()
  });
  game.settings.register(C.MODULE_ID, "migration", {
    scope: "world",
    config: false,
    type: String,
    default: "0"
  });
  // Deprecated: stairs zones are GM-only now. Kept registered so worlds
  // that stored a value do not error.
  game.settings.register(C.MODULE_ID, "showStairsToPlayers", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  CONFIG.Canvas.layers.mls = { layerClass: MLSLayer, group: "interface" };

  view.patchToken();
  view.patchLights();
  view.patchSweep();
  view.patchDoorControls();

  const module = game.modules.get(C.MODULE_ID);
  module.api = {
    buildComposite,
    openBuilder,
    setLevel: view.setGMLevel,
    getViewedLevel: view.getViewedLevel,
    refresh: view.refreshView
  };
});

/* -------------------------------------------- */
/*  Ready: one-time fixes                        */
/* -------------------------------------------- */

Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  // Floor height must be a round 5: a 4.5 value put tokens right on the
  // floor boundary, flipping them to the wrong level as soon as they moved
  if (game.settings.get(C.MODULE_ID, "floorHeight") === 4.5) {
    await game.settings.set(C.MODULE_ID, "floorHeight", 5);
    ui.notifications.info(C.loc("MLS.Info.FloorHeightFixed"));
  }
  await migrate();
});

/**
 * One-time migrations, tracked by a hidden world setting.
 */
async function migrate() {
  const current = game.settings.get(C.MODULE_ID, "migration");

  // 0.5.0: floor tiles used to carry a real elevation, which made the roof
  // tile render above ground-level tokens standing outside the building.
  // Bring every level-flagged tile back to its base elevation.
  if (foundry.utils.isNewerVersion("0.5.0", current)) {
    for (const scene of game.scenes) {
      if (!C.isComposite(scene)) continue;
      const updates = [];
      for (const tile of scene.tiles) {
        const level = tile.getFlag(C.MODULE_ID, "level");
        if (level == null) continue;
        const elevation = Math.max(0, tile.elevation - C.elevationFor(level));
        if (tile.elevation !== elevation) updates.push({ _id: tile.id, elevation });
      }
      if (updates.length) {
        await scene.updateEmbeddedDocuments("Tile", updates);
        console.log(`${C.MODULE_ID} | migrated ${updates.length} tile elevations in "${scene.name}"`);
      }
    }
  }

  // 0.7.0: basement tiles must follow their negative elevation, or tokens
  // down there (elevation -5) render BELOW their own floor tile and vanish.
  // Also tag the full-map floor tiles created by the builder.
  if (foundry.utils.isNewerVersion("0.7.0", current)) {
    for (const scene of game.scenes) {
      if (!C.isComposite(scene)) continue;
      const updates = [];
      for (const tile of scene.tiles) {
        const level = tile.getFlag(C.MODULE_ID, "level");
        if (level == null) continue;
        const update = { _id: tile.id };
        const base = Math.min(0, C.elevationFor(level));
        if (base !== 0) update.elevation = base + tile.elevation;
        if (tile.sort === (-1000 + level)) update[`flags.${C.MODULE_ID}.floor`] = true;
        if (Object.keys(update).length > 1) updates.push(update);
      }
      if (updates.length) {
        await scene.updateEmbeddedDocuments("Tile", updates);
        console.log(`${C.MODULE_ID} | migrated ${updates.length} tiles (0.7.0) in "${scene.name}"`);
      }
    }
  }

  const version = game.modules.get(C.MODULE_ID).version;
  if (current !== version) await game.settings.set(C.MODULE_ID, "migration", version);
}

/* -------------------------------------------- */
/*  Canvas lifecycle                             */
/* -------------------------------------------- */

Hooks.on("canvasReady", () => {
  view.wrapEdges();
  view.resetGMLevel();
  clearStairsState();
  refreshOverlay();
  view.refreshView();
});

/* -------------------------------------------- */
/*  Scene controls                               */
/* -------------------------------------------- */

Hooks.on("getSceneControlButtons", controls => {
  if (!game.user.isGM) return;
  controls[C.MODULE_ID] = {
    name: C.MODULE_ID,
    order: 15,
    title: "MLS.Controls.Title",
    icon: "fa-solid fa-layer-group",
    onChange: (event, active) => {
      if (active) canvas.mls?.activate();
    },
    onToolChange: () => {},
    tools: {
      stairs: {
        name: "stairs",
        order: 1,
        title: "MLS.Controls.StairsTool",
        icon: "fa-solid fa-stairs"
      },
      building: {
        name: "building",
        order: 2,
        title: "MLS.Controls.BuildingTool",
        icon: "fa-regular fa-building"
      },
      levelUp: {
        name: "levelUp",
        order: 3,
        title: "MLS.Controls.LevelUp",
        icon: "fa-solid fa-arrow-up",
        button: true,
        onChange: () => view.stepGMLevel(1)
      },
      levelDown: {
        name: "levelDown",
        order: 4,
        title: "MLS.Controls.LevelDown",
        icon: "fa-solid fa-arrow-down",
        button: true,
        onChange: () => view.stepGMLevel(-1)
      },
      build: {
        name: "build",
        order: 5,
        title: "MLS.Controls.Build",
        icon: "fa-solid fa-hammer",
        button: true,
        onChange: () => openBuilder()
      }
    },
    activeTool: "stairs"
  };
});

/* -------------------------------------------- */
/*  Token hooks                                  */
/* -------------------------------------------- */

Hooks.on("preCreateToken", (doc, data, options, userId) => {
  if (!C.isComposite(doc.parent)) return;
  if (foundry.utils.hasProperty(data, `flags.${C.MODULE_ID}.level`)) return;
  // Tokens dropped outside the building always start on the ground floor
  // (they merely SEE the roof from out there); tokens dropped inside start
  // on the floor currently being viewed.
  const onScene = canvas.ready && (canvas.scene === doc.parent);
  let level;
  if (C.isOutsideBuilding(doc)) level = C.defaultLevel(doc.parent);
  else level = onScene ? (view.getViewedLevel() ?? C.defaultLevel(doc.parent)) : C.defaultLevel(doc.parent);
  doc.updateSource({
    [`flags.${C.MODULE_ID}.level`]: level,
    elevation: C.elevationFor(level)
  });
});

Hooks.on("updateToken", (doc, changes, options, userId) => {
  if (!C.isComposite(doc.parent)) return;
  const moved = ("x" in changes) || ("y" in changes);
  const levelChanged = foundry.utils.hasProperty(changes, `flags.${C.MODULE_ID}.level`);
  const elevationChanged = "elevation" in changes;

  // Keep level and elevation in sync (only on the initiating client, and
  // never re-entering when the update came from this module itself)
  if ((game.user.id === userId) && !options.mlsSync) {
    if (elevationChanged) {
      const level = C.levelFromElevation(doc.parent, doc.elevation);
      if ((level != null) && (level !== C.tokenLevel(doc))) {
        doc.update({ [`flags.${C.MODULE_ID}.level`]: level }, { mlsSync: true });
        if (game.user.isGM) view.followToken();
      }
    } else if (levelChanged) {
      const elevation = C.elevationFor(C.tokenLevel(doc));
      if (doc.elevation !== elevation) doc.update({ elevation }, { mlsSync: true });
    }
  }

  // The GM view follows the token it is moving (floor and roof logic)
  if (moved && (game.user.id === userId) && game.user.isGM && doc.object?.controlled) {
    view.followToken();
  }

  if (!canvas.ready || (doc.parent !== canvas.scene)) return;
  if (!moved && !levelChanged && !elevationChanged) return;
  view.refreshView();
  if (moved && (game.user.id === userId)) maybePromptStairs(doc);
});

Hooks.on("deleteToken", doc => {
  forgetToken(doc.id);
  if (canvas.ready && (doc.parent === canvas.scene) && C.isComposite(canvas.scene)) view.refreshView();
});

Hooks.on("createToken", doc => {
  if (canvas.ready && (doc.parent === canvas.scene) && C.isComposite(canvas.scene)) view.refreshView();
});

Hooks.on("controlToken", (token, controlled) => view.onControlToken(token, controlled));

/* -------------------------------------------- */
/*  Auto-tag new placeables with current level   */
/* -------------------------------------------- */

for (const hook of ["preCreateWall", "preCreateAmbientLight", "preCreateTile"]) {
  Hooks.on(hook, (doc, data) => {
    if (!C.isComposite(doc.parent)) return;
    if (!canvas.ready || (canvas.scene !== doc.parent)) return;
    if (foundry.utils.hasProperty(data, `flags.${C.MODULE_ID}.level`)) return;
    const level = view.getViewedLevel();
    if (level == null) return;
    doc.updateSource({ [`flags.${C.MODULE_ID}.level`]: level });
  });
}

/* -------------------------------------------- */
/*  Keep the view consistent on document CRUD    */
/* -------------------------------------------- */

for (const hook of [
  "createWall", "updateWall", "deleteWall",
  "createAmbientLight", "updateAmbientLight", "deleteAmbientLight",
  "createTile", "updateTile", "deleteTile"
]) {
  Hooks.on(hook, doc => {
    if (canvas.ready && (doc.parent === canvas.scene) && C.isComposite(canvas.scene)) {
      view.refreshView();
    }
  });
}

Hooks.on("updateScene", (scene, changes) => {
  if (!canvas.ready || (scene !== canvas.scene)) return;
  if (changes.flags?.[C.MODULE_ID]) {
    refreshOverlay();
    view.refreshView();
  }
});

/* -------------------------------------------- */
/*  Visibility enforcement                       */
/* -------------------------------------------- */

Hooks.on("refreshTile", tile => view.enforceTileVisibility(tile));
Hooks.on("refreshWall", wall => view.enforceWallVisibility(wall));
Hooks.on("refreshAmbientLight", light => view.enforceLightVisibility(light));
