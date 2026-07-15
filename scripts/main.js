import * as C from "./constants.js";
import { MLSLayer, refreshOverlay } from "./layer.js";
import * as view from "./view.js";
import { maybePromptStairs } from "./stairs.js";
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
    default: 5
  });
  game.settings.register(C.MODULE_ID, "defaultLevel", {
    name: "MLS.Settings.DefaultLevel.Name",
    hint: "MLS.Settings.DefaultLevel.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 1
  });
  game.settings.register(C.MODULE_ID, "showStairsToPlayers", {
    name: "MLS.Settings.ShowStairsToPlayers.Name",
    hint: "MLS.Settings.ShowStairsToPlayers.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  CONFIG.Canvas.layers.mls = { layerClass: MLSLayer, group: "interface" };

  view.patchToken();
  view.patchLights();

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
/*  Canvas lifecycle                             */
/* -------------------------------------------- */

Hooks.on("canvasReady", () => {
  view.wrapEdges();
  view.resetGMLevel();
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
  const onScene = canvas.ready && (canvas.scene === doc.parent);
  const level = onScene ? (view.getViewedLevel() ?? C.defaultLevel(doc.parent)) : C.defaultLevel(doc.parent);
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
        if (game.user.isGM && canvas.ready && (doc.parent === canvas.scene)) view.setGMLevel(level);
      }
    } else if (levelChanged) {
      const elevation = C.elevationFor(C.tokenLevel(doc));
      if (doc.elevation !== elevation) doc.update({ elevation }, { mlsSync: true });
    }
  }

  if (!canvas.ready || (doc.parent !== canvas.scene)) return;
  if (!moved && !levelChanged && !elevationChanged) return;
  view.refreshView();
  if (moved && (game.user.id === userId)) maybePromptStairs(doc);
});

Hooks.on("createToken", doc => {
  if (canvas.ready && (doc.parent === canvas.scene) && C.isComposite(canvas.scene)) view.refreshView();
});

Hooks.on("controlToken", () => {
  if (!game.user.isGM && canvas.ready && C.isComposite(canvas.scene)) view.refreshView();
});

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
