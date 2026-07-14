import * as C from "./constants.js";

/**
 * Open the composite scene builder: pick a scene folder and build a single
 * multi-level scene out of its scenes.
 *
 * Level detection: each scene name must end with a number ("Torre 00",
 * "Torre 01", "Torre 02"...). 00 is the basement, 01 the ground floor and
 * the highest number is the roof.
 */
export async function openBuilder() {
  const folders = game.folders.filter(f => f.type === "Scene" && f.contents.length > 0);
  if (!folders.length) {
    return ui.notifications.warn(C.loc("MLS.Build.NoFolders"));
  }
  const options = folders
    .map(f => `<option value="${f.id}">${f.name} (${f.contents.length})</option>`)
    .join("");
  const content = `
    <p>${C.loc("MLS.Build.Hint")}</p>
    <div class="form-group">
      <label>${C.loc("MLS.Build.FolderLabel")}</label>
      <select name="folder" style="width: 100%;">${options}</select>
    </div>`;

  const folderId = await foundry.applications.api.DialogV2.prompt({
    window: { title: C.loc("MLS.Build.Title") },
    content,
    ok: {
      label: C.loc("MLS.Build.Confirm"),
      icon: "fa-solid fa-hammer",
      callback: (event, button) => button.form.elements.folder.value
    },
    rejectClose: false
  });
  if (!folderId) return;

  const folder = game.folders.get(folderId);
  if (!folder) return;
  return buildComposite(folder);
}

/**
 * Build the composite multi-level scene from a scene folder.
 * @param {Folder} folder
 * @returns {Promise<Scene|void>}
 */
export async function buildComposite(folder) {
  const parsed = [];
  for (const scene of folder.contents) {
    const match = scene.name.trim().match(/(\d+)$/);
    if (!match) {
      ui.notifications.warn(C.locf("MLS.Build.SkippedNoNumber", { name: scene.name }));
      continue;
    }
    parsed.push({ scene, level: parseInt(match[1], 10) });
  }
  if (parsed.length < 2) {
    return ui.notifications.error(C.loc("MLS.Build.NeedTwo"));
  }
  parsed.sort((a, b) => a.level - b.level);

  const seen = new Set();
  for (const p of parsed) {
    if (seen.has(p.level)) {
      return ui.notifications.error(C.locf("MLS.Build.DuplicateLevel", { level: p.level }));
    }
    seen.add(p.level);
  }

  const base = parsed[0].scene;
  const baseData = base.toObject();
  if (parsed.some(p => (p.scene.width !== base.width) || (p.scene.height !== base.height))) {
    ui.notifications.warn(C.loc("MLS.Build.DimMismatch"));
  }

  const levelsMeta = parsed.map(p => ({
    level: p.level,
    name: p.scene.name,
    src: p.scene.background?.src ?? null
  }));

  const newScene = await Scene.create({
    name: `${folder.name} (${C.loc("MLS.Build.SceneSuffix")})`,
    width: baseData.width,
    height: baseData.height,
    padding: baseData.padding,
    grid: baseData.grid,
    backgroundColor: baseData.backgroundColor ?? "#000000",
    tokenVision: true,
    fog: { exploration: true },
    flags: {
      [C.MODULE_ID]: { levels: levelsMeta, stairs: [], building: [] }
    }
  });

  const d = newScene.dimensions;
  const tiles = [];
  const walls = [];
  const lights = [];

  for (const { scene, level } of parsed) {
    const elevation = C.elevationFor(level);

    // Floor background as a full-map tile
    const src = scene.background?.src;
    if (src) {
      tiles.push({
        texture: { src },
        x: d.sceneX,
        y: d.sceneY,
        width: d.sceneWidth,
        height: d.sceneHeight,
        elevation,
        sort: -1000 + level,
        flags: { [C.MODULE_ID]: { level } }
      });
    } else {
      ui.notifications.warn(C.locf("MLS.Build.NoBackground", { name: scene.name }));
    }

    // Copy tiles, walls and lights from the source scene, tagged by level
    for (const t of scene.tiles) {
      const data = t.toObject();
      delete data._id;
      data.elevation = elevation + (data.elevation ?? 0);
      foundry.utils.setProperty(data, `flags.${C.MODULE_ID}.level`, level);
      tiles.push(data);
    }
    for (const w of scene.walls) {
      const data = w.toObject();
      delete data._id;
      foundry.utils.setProperty(data, `flags.${C.MODULE_ID}.level`, level);
      walls.push(data);
    }
    for (const l of scene.lights) {
      const data = l.toObject();
      delete data._id;
      foundry.utils.setProperty(data, `flags.${C.MODULE_ID}.level`, level);
      lights.push(data);
    }
  }

  if (tiles.length) await newScene.createEmbeddedDocuments("Tile", tiles);
  if (walls.length) await newScene.createEmbeddedDocuments("Wall", walls);
  if (lights.length) await newScene.createEmbeddedDocuments("AmbientLight", lights);

  ui.notifications.info(C.locf("MLS.Build.Done", {
    name: newScene.name,
    count: parsed.length
  }));
  await newScene.view();
  return newScene;
}
