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

// Guard the fixes that previously regressed in the mobile driving scene.
check(js.includes("assets/models/cars/suv.glb"), "Ordinary SUV is the default imported vehicle");
check(js.includes("w.rotateX(-state.speed*dt/radius)"), "Wheels rotate around their local axle X");
check(js.includes('obj.name.toLowerCase()==="body"'), "Imported exterior body shell is identified");
check(js.includes("player.userData.bodyShell.visible=state.camera!==1"), "Exterior shell is hidden only in driver view");
check(js.includes("if(cockpitGroup)cockpitGroup.visible=state.camera===1"), "Cabin appears in driver view");
check(js.includes("new THREE.PlaneGeometry(1.82,.78)"), "Compact driver cabin includes windshield geometry");
check(js.includes("steeringWheelVisual.position.set(-.48,1.02,-.62)"), "Steering wheel is placed in front of driver");
check(js.includes("box(.34,.25,.30,dashMat,.27,.83,-.47)"), "Center stack stays low and narrow");

console.log("Drive Horizon validation passed.");
