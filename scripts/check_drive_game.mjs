import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gameDir = resolve(root, "games/drive");
const htmlPath = resolve(gameDir, "index.html");
const jsPath = resolve(gameDir, "game.js");
const html = readFileSync(htmlPath, "utf8");
const js = readFileSync(jsPath, "utf8");

function check(condition, message) {
  assert.ok(condition, message);
  console.log("OK  " + message);
}

// Parse the browser module without executing DOM/WebGL code.
const parseable = js.replace(/^import\s+.*?;\s*$/gm, "");
new Function(parseable);
check(true, "Drive Horizon JavaScript syntax");

// Make sure the page points to the local game module and the referenced file exists.
const moduleTag = html.match(/<script\s+type=["']module["']\s+src=["']([^"']+)["']/i);
check(Boolean(moduleTag), "HTML contains a module entry point");
const modulePath = moduleTag[1].split("?")[0];
check(existsSync(resolve(gameDir, modulePath)), "HTML module path exists: " + modulePath);

// Every direct $() lookup must have a corresponding element in the page.
const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
const lookups = new Set([...js.matchAll(/\$\(["']([^"']+)["']\)/g)].map((match) => match[1]));
const missing = [...lookups].filter((id) => !ids.has(id));
check(missing.length === 0, "All direct DOM lookups exist" + (missing.length ? ": " + missing.join(", ") : ""));

// Regressions: original sports car default, alternate SUV, clear dashboard and stable camera.
check(js.includes('car: "spectral"'), "Spectral GT RS is the first-run default");
check(js.includes("spectral_gt_rs_game_ready.glb"), "Premium Spectral model is registered");
check(js.includes('id:"suv"'), "Kenney SUV remains selectable");
check(js.includes('localStorage.setItem("driveHorizonCar",carId)'), "Vehicle selection persists locally");
check(js.includes('axis==="z"?w.rotateZ(spin):w.rotateX(spin)'), "Each model rotates wheels around its own axle axis");
check(js.includes("player.userData.loadedModel.visible=state.camera!==1"), "Imported exterior is hidden in driver view");
check(js.includes("const eyeX=state.driverSide*.49"), "Driver eye point follows the selected car's seating side");
check(js.includes("camera.position.copy(desired)"), "Driver camera has no chase smoothing lag");
check(js.includes("player.position.y+=.13;"), "Artificial chassis bounce is removed");
check(js.includes("const dt=Math.min(.033"), "Frame delta is capped to reduce acceleration stutter");
check(js.includes("new THREE.PlaneGeometry(.68,.34)"), "Wide digital driver cluster is present");
check(js.includes("new THREE.PlaneGeometry(.48,.27)"), "Separate center infotainment display is present");
check(html.includes('data-car="spectral"') && html.includes('data-car="suv"'), "Both vehicle choices exist in the menu");
check(css.includes(".vehicle-picker"), "Garage selection is styled");

console.log("Drive Horizon validation passed.");
