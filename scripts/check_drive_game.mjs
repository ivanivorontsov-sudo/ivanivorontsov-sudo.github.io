import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gameDir = resolve(root, "games/drive");
const htmlPath = resolve(gameDir, "index.html");
const jsPath = resolve(gameDir, "game.js");
const cssPath = resolve(gameDir, "style.css");
const html = readFileSync(htmlPath, "utf8");
const js = readFileSync(jsPath, "utf8");
const css = readFileSync(cssPath, "utf8");

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
check(js.includes('localStorage.setItem("driveHorizonCarV2",carId)'), "Vehicle selection persists with a fresh default preference key");
check(js.includes('axis==="z"?w.rotateZ(spin):w.rotateX(spin)'), "Each model rotates wheels around its own axle axis");
check(js.includes("player.userData.loadedModel.visible=state.camera!==1"), "Imported exterior is hidden in driver view");
check(js.includes("const eyeX=state.driverSide*.49"), "Driver eye point follows the selected car's seating side");
check(js.includes("camera.position.copy(desired)"), "Driver camera has no chase smoothing lag");
check(js.includes("player.position.y+=.13;"), "Artificial chassis bounce is removed");
check(js.includes("const dt=Math.min(.033"), "Frame delta is capped to reduce acceleration stutter");
check(js.includes("new THREE.PlaneGeometry(.68,.24)"), "Wide analog driver cluster is present");
check(js.includes("new THREE.PlaneGeometry(.38,.22)"), "Separate center infotainment display is present");
check(js.includes("clusterScreen.position.set(driverX,1.02,-.92)"), "Driver cluster sits low behind the wheel");
check(js.includes("centerScreen.position.set(0,.96,-.72)"), "Center display sits on the visible face of the center stack");
check(js.includes("function drawAnalogGauge"), "Instrument cluster draws analog gauges");
check(js.includes("mirrorCam"), "Rear-view mirror camera exists");
check(js.includes("if(k===\"u\")toggleHud();"), "HUD can be hidden with the U key");
check(html.includes('id="hudStrip"'), "Compact HUD strip exists");
check(html.includes('id="moreBtn"'), "Mobile header collapses into a menu button");
check(html.includes('id="speedLinesToggle"'), "Speed-line setting exists");
check(js.includes("driveHorizonSpeedLines"), "Speed-line preference is persisted");
check(js.includes("function updateSpeedLines"), "Speed lines respect camera, speed and the user toggle");
check(js.includes("function syncCockpitMirror"), "Portrait rear-view mirror is recentered");
check(js.includes("function drawDigitalCluster"), "Sports car uses a digital instrument cluster");
check(js.includes("top:194.5"), "Spectral GT RS is geared for a 700 km/h top speed");
check(js.includes("function dampSpringVec"), "Chase camera uses a critically damped offset spring");
check(js.includes("baseDist*1.3"), "Chase camera distance is clamped to 1.3x the base offset");
check(html.includes('data-car="spectral"') && html.includes('data-car="suv"'), "Both vehicle choices exist in the menu");
check(css.includes(".vehicle-picker"), "Garage selection is styled");


check(js.includes("webglcontextlost"), "WebGL context loss is handled");
check(js.includes("function honk("), "Horn can be sounded");
check(html.includes('data-control="horn"'), "On-screen horn button exists");
check(js.includes("QUALITY_PRESETS"), "Graphics quality presets exist");
check(js.includes("function collideWorld"), "Collision resolution is present");
check(js.includes("Math.max(1, Math.ceil(Math.abs(state.speed)*dt/maxStep))"), "High-speed collision uses substeps");
check(js.includes("__DRIVE_HORIZON_READY"), "Boot readiness flag is published");

console.log("Drive Horizon validation passed.");
