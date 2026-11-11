import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/postprocessing/OutputPass.js";

const $ = (id) => document.getElementById(id);
const sceneHost = $("scene");
const isTouch = (navigator.maxTouchPoints || 0) > 0 || ("ontouchstart" in window);
const isNarrow = matchMedia("(max-width: 820px)").matches;
const isMobile = isTouch && (isNarrow || matchMedia("(pointer: coarse)").matches);
try { document.documentElement.classList.toggle("touch-ui", isTouch); document.body.classList.toggle("touch-ui", isTouch); } catch (e) { /* DOM ready */ }

function readSpeedLinesPref() {
  try {
    const saved = localStorage.getItem("driveHorizonSpeedLines");
    if (saved === "on") return true;
    if (saved === "off") return false;
  } catch (e) { /* ignore */ }
  return !isMobile;
}

const QUALITY_PRESETS = {
  low:    { pixelRatio:1, shadows:false, bloom:0, shadowSize:512, trees:140, bushes:70, mountains:10, ribbon:380, railSeg:0, anisotropy:1, antialias:false, lamps:0, buildings:14, traffic:5, dprCap:1, post:false },
  medium: { pixelRatio:1.2, shadows:true, bloom:.12, shadowSize:1024, trees:260, bushes:140, mountains:18, ribbon:700, railSeg:420, anisotropy:2, antialias:false, lamps:2, buildings:26, traffic:7, dprCap:1.25, post:true },
  high:   { pixelRatio:1.55, shadows:true, bloom:.22, shadowSize:2048, trees:400, bushes:200, mountains:28, ribbon:1000, railSeg:820, anisotropy:4, antialias:!isMobile, lamps:4, buildings:40, traffic:9, dprCap:isMobile?1.35:1.75, post:true }
};
const QUALITY_LABELS = { low:"низкая", medium:"средняя", high:"высокая" };

function detectQuality() {
  try {
    const saved = localStorage.getItem("driveHorizonQuality");
    if (saved === "low" || saved === "medium" || saved === "high") return saved;
  } catch (e) { /* ignore */ }
  const hc = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (hc <= 2 || mem <= 2) return "low";
  if (isMobile || hc <= 4 || mem <= 4) return "medium";
  return "high";
}

const state = {
  time: "sunset", paint: "#e5e8eb", quality: true, qualityLevel: detectQuality(),
  camera: 0, car: "spectral",
  driverSide: 1, carLoadToken: 0,
  running: false, paused: false, speed: 0, distance: 0, progress: 0,
  lateral: 0, steer: 0, steerInput: 0, totalDistance: 0, hitCooldown: 0,
  messageTimer: 0, soundOn: true, gamepadIndex: null,
  worldReady: false, damage: 0, score: 0, combo: 1, comboTimer: 0,
  hornTimer: 0, shake: 0, fovKick: 0, checkpoint: 0, sectorTime: 0,
  collisionCount: 0, nearMissCool: 0, rpm: 850, gear: "N", gearIndex: 0,
  autoQuality: true, lastInputAt: 0, tiltSteer: 0, tiltOn: false,
  skid: 0, offroad: false, speedLinesOn: readSpeedLinesPref()
};
const controls = { gas:false, brake:false, left:false, right:false, handbrake:false, horn:false };
let renderer, composer, bloomPass, scene, camera, curve, trackLength, player, playerFallback, carPaintMaterial;
let cockpitGroup, steeringWheelVisual, cockpitGaugeContext, cockpitGaugeTexture, cockpitCenterContext, cockpitCenterTexture, cockpitGaugeLast=0, inputTelemetryTimer=0;
const chaseCamOffset=new THREE.Vector3();
const chaseCamVel=new THREE.Vector3();
const chaseDesiredOffset=new THREE.Vector3();
const auxCamOffset=new THREE.Vector3();
let chaseCamReady=false;
let auxCamMode=-1;
let debugSpeedLock=null;
let mirrorRT, mirrorCam, mirrorMesh, mirrorFrame, mirrorFallback;
const hardware = { steer:0, throttle:0, brake:0, handbrake:false, horn:false };
const inputConfig = { steer:"axis0", gas:"button7", brake:"button6", handbrake:"button0", invertSteer:false, invertGas:false, invertBrake:false, pedalsPositive:false, sensitivity:1.25 };
let skyTexture, skyCanvas, skyContext, sun, directionalLight, ambientLight, stars, moon;
let roadTexture, grassTexture, minimapContext, audioContext, masterGain;
let engineOsc, engineOsc2, engineGain, engineFilter, windGain, squealGain, noiseSource;
let traffic = [], lastFrame = performance.now(), frameCount = 0, fpsTime = 0, lowFpsStreak = 0;
const clock = { now: 0 };
const treeColliders = [];
const lampAnchors = [];
const lampLights = [];
const effects = { smoke:[], sparks:[], dust:[], skids:[], skidIndex:0, skidMesh:null, smokeTex:null, sparkTex:null, dustTex:null };
const TRACK_POINTS = [
  new THREE.Vector3(0,.8,-155), new THREE.Vector3(78,1.15,-143),
  new THREE.Vector3(145,.75,-72), new THREE.Vector3(153,1.35,34),
  new THREE.Vector3(88,1.1,135), new THREE.Vector3(-8,.8,164),
  new THREE.Vector3(-112,.95,112), new THREE.Vector3(-168,1.3,18),
  new THREE.Vector3(-119,.8,-107)
];
const PALETTES = {
  sunset: { top:"#214366", middle:"#e28c74", horizon:"#ffd4a1", fog:0xc88e79, ambient:.74, direct:2.15, env:.95 },
  day:    { top:"#4288ad", middle:"#9ccbd0", horizon:"#e2e8cf", fog:0xa5c6c2, ambient:1.08, direct:2.75, env:1.05 },
  night:  { top:"#071326", middle:"#172e4a", horizon:"#34465c", fog:0x1b2b40, ambient:.32, direct:.18, env:.42 }
};
const CHECKPOINTS = 8;

function qcfg() { return QUALITY_PRESETS[state.qualityLevel] || QUALITY_PRESETS.medium; }
function seeded(seed) {
  let value = seed >>> 0;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
}
const rand = seeded(20261111);
const vecRight = (tangent) => new THREE.Vector3(-tangent.z,0,tangent.x).normalize();
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

function setLoadStatus(text) {
  const el = $("loadStatus");
  if (el) el.textContent = text;
}
function showError(text) {
  const box = $("errorBox");
  if (!box) return;
  box.textContent = text;
  box.classList.remove("hidden");
}

function canvasTexture(kind, size=512) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (kind === "road") {
    ctx.fillStyle = "#2c3136"; ctx.fillRect(0,0,size,size);
    for (let i=0;i<5200;i++) {
      const v = Math.floor(58 + rand()*82);
      ctx.fillStyle = "rgba("+v+","+v+","+(v-4)+","+(0.07+rand()*0.24)+")";
      ctx.fillRect(rand()*size,rand()*size,rand()*1.7+0.25,rand()*1.7+0.25);
    }
    for (let i=0;i<48;i++) {
      ctx.strokeStyle="rgba(8,12,16,.12)";ctx.lineWidth=rand()*2+0.5;
      ctx.beginPath();ctx.moveTo(rand()*size,rand()*size);ctx.lineTo(rand()*size,rand()*size);ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,.04)";
    ctx.fillRect(size*0.48,0,size*0.04,size);
  } else if (kind === "grass") {
    ctx.fillStyle="#5d7d56";ctx.fillRect(0,0,size,size);
    for(let i=0;i<9000;i++){
      const g=Math.floor(78+rand()*75),r=Math.floor(45+rand()*35),b=Math.floor(38+rand()*25);
      ctx.fillStyle="rgba("+r+","+g+","+b+","+(0.08+rand()*0.2)+")";
      const s=rand()*3+0.5;ctx.fillRect(rand()*size,rand()*size,s,s);
    }
  } else {
    ctx.fillStyle="#6a5a46";ctx.fillRect(0,0,size,size);
    for(let i=0;i<6000;i++){
      const v=Math.floor(70+rand()*70);
      ctx.fillStyle="rgba("+v+","+(v-12)+","+(v-24)+","+(0.1+rand()*0.25)+")";
      ctx.fillRect(rand()*size,rand()*size,rand()*3+0.4,rand()*3+0.4);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = qcfg().anisotropy;
  return tex;
}

function softParticleTexture(rgb, size=64) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
  g.addColorStop(0,"rgba("+rgb+",.95)");
  g.addColorStop(.45,"rgba("+rgb+",.35)");
  g.addColorStop(1,"rgba("+rgb+",0)");
  ctx.fillStyle = g; ctx.fillRect(0,0,size,size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSky() {
  skyCanvas = document.createElement("canvas"); skyCanvas.width=1024; skyCanvas.height=512;
  skyContext = skyCanvas.getContext("2d");
  skyTexture = new THREE.CanvasTexture(skyCanvas);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  skyTexture.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = skyTexture;
  scene.environmentIntensity = 0.9;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(850,32,18),
    new THREE.MeshBasicMaterial({map:skyTexture,side:THREE.BackSide,depthWrite:false})
  );
  scene.add(sky);
  sun = new THREE.Mesh(new THREE.SphereGeometry(8,24,16),new THREE.MeshBasicMaterial({color:0xffd7a6}));
  sun.position.set(-240,150,-340); scene.add(sun);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(18,24,16),new THREE.MeshBasicMaterial({color:0xffc58b,transparent:true,opacity:.18,depthWrite:false}));
  halo.position.copy(sun.position); scene.add(halo);
  moon = new THREE.Mesh(new THREE.SphereGeometry(5,16,12),new THREE.MeshBasicMaterial({color:0xdce6f4}));
  moon.position.set(220,130,280); moon.visible=false; scene.add(moon);
  const starGeo = new THREE.BufferGeometry(), starPos=[];
  for(let i=0;i<650;i++){
    const a=rand()*Math.PI*2, y=.15+rand()*.85, r=620;
    const h=Math.sqrt(1-y*y); starPos.push(Math.cos(a)*h*r,y*r,Math.sin(a)*h*r);
  }
  starGeo.setAttribute("position",new THREE.Float32BufferAttribute(starPos,3));
  stars = new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xcfe4ff,size:1.35,transparent:true,opacity:.8,sizeAttenuation:false}));
  scene.add(stars);stars.visible=false;
  applyTime(state.time);
}

function applyTime(mode) {
  state.time = mode;
  const p = PALETTES[mode] || PALETTES.sunset;
  if (skyContext) {
    const grad = skyContext.createLinearGradient(0,0,0,512);
    grad.addColorStop(0,p.top); grad.addColorStop(.58,p.middle); grad.addColorStop(1,p.horizon);
    skyContext.fillStyle=grad;skyContext.fillRect(0,0,skyCanvas.width,skyCanvas.height);
    if(mode!=="night"){
      for(let i=0;i<34;i++){
        const x=rand()*skyCanvas.width,y=95+rand()*230,rx=45+rand()*120,ry=9+rand()*25;
        skyContext.save();skyContext.translate(x,y);skyContext.scale(1,ry/rx);
        const cloud=skyContext.createRadialGradient(0,0,2,0,0,rx);
        cloud.addColorStop(0,mode==="sunset"?"rgba(255,226,205,.25)":"rgba(255,255,255,.24)");
        cloud.addColorStop(.55,mode==="sunset"?"rgba(255,220,198,.11)":"rgba(255,255,255,.10)");
        cloud.addColorStop(1,"rgba(255,255,255,0)");
        skyContext.fillStyle=cloud;skyContext.beginPath();skyContext.arc(0,0,rx,0,Math.PI*2);skyContext.fill();skyContext.restore();
      }
    }
    skyTexture.needsUpdate=true;
  }
  if (scene?.fog) scene.fog.color.setHex(p.fog);
  if (ambientLight) ambientLight.intensity=p.ambient;
  if (directionalLight) {
    directionalLight.intensity=p.direct;
    directionalLight.color.set(mode==="night"?0x9bb8e4:0xffe2c1);
  }
  if (sun) sun.visible=mode!=="night";
  if (stars) stars.visible=mode==="night";
  if (moon) moon.visible=mode==="night";
  if (scene) scene.environmentIntensity = p.env;
  if (bloomPass) bloomPass.strength = (mode==="night" ? 0.55 : 1) * qcfg().bloom;
  const lights=player?.userData.headlights||playerFallback?.userData.headlights;
  if(lights)lights.forEach(l=>l.visible=mode==="night" && state.qualityLevel!=="low");
  lampLights.forEach(l=>{ l.visible = mode==="night"; });
  const label = mode==="day"?"День":mode==="night"?"Ночь":"Закат";
  const timeBtn=$("timeBtn");
  if (timeBtn) {
    const icon=timeBtn.querySelector("#timeIcon");
    if(icon) icon.textContent=mode==="day"?"☀️":mode==="night"?"🌙":"🌇";
    const bl=timeBtn.querySelector(".btn-label");
    if(bl) bl.textContent=label;
  }
  document.querySelectorAll(".mode-btn").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));
}

function addRibbon(offset, width, material, yOffset=0.035, segments) {
  const segs = segments || qcfg().ribbon;
  const positions=[], uvs=[], indices=[];
  for(let i=0;i<=segs;i++){
    const t=i/segs,p=curve.getPointAt(t),tan=curve.getTangentAt(t),right=vecRight(tan);
    const center=p.clone().addScaledVector(right,offset);
    const a=center.clone().addScaledVector(right,-width/2);const b=center.clone().addScaledVector(right,width/2);
    a.y+=yOffset;b.y+=yOffset;
    positions.push(a.x,a.y,a.z,b.x,b.y,b.z);
    uvs.push(0,t*50,1,t*50);
    if(i<segs){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();
  const mesh=new THREE.Mesh(g,material);mesh.receiveShadow=true;scene.add(mesh);return mesh;
}

function buildTrack() {
  curve = new THREE.CatmullRomCurve3(TRACK_POINTS,true,"catmullrom",0.42);
  trackLength=curve.getLength();
  const q = qcfg();
  roadTexture=canvasTexture("road", state.qualityLevel==="low"?512:1024);
  roadTexture.repeat.set(1.4,1);
  const asphalt=new THREE.MeshStandardMaterial({map:roadTexture,color:0xffffff,roughness:.93,metalness:.03});
  const shoulder=new THREE.MeshStandardMaterial({color:0x555a5c,roughness:1});
  const curbA=new THREE.MeshStandardMaterial({color:0xc9c4b8,roughness:.85});
  const curbB=new THREE.MeshStandardMaterial({color:0x9a4032,roughness:.85});
  const lineMat=new THREE.MeshStandardMaterial({color:0xe7e7dc,roughness:.75,emissive:0x222018,emissiveIntensity:.35});
  addRibbon(0,20,asphalt,.04);
  addRibbon(-10.45,1.05,shoulder,.035);addRibbon(10.45,1.05,shoulder,.035);
  addRibbon(-9.48,.16,lineMat,.075);addRibbon(9.48,.16,lineMat,.075);
  addRibbon(-10.9,.28,curbA,.09);addRibbon(10.9,.28,curbB,.09);
  const dashGeo=new THREE.BoxGeometry(.14,.035,6.2);
  const dashMat=new THREE.MeshStandardMaterial({color:0xf4f1dc,roughness:.8,emissive:0x151410,emissiveIntensity:.4});
  const dashCount=Math.ceil(trackLength/16)*2+2;
  const dashes=new THREE.InstancedMesh(dashGeo,dashMat,dashCount);
  const dummy=new THREE.Object3D();let k=0;
  for(let t=0;t<1;t+=16/trackLength){
    const p=curve.getPointAt(t),tan=curve.getTangentAt(t),right=vecRight(tan);
    const quat=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),tan);
    for(const lane of [-3.28,3.28]){
      dummy.position.copy(p).addScaledVector(right,lane);dummy.position.y+=.085;
      dummy.quaternion.copy(quat);dummy.scale.set(1,1,1);dummy.updateMatrix();dashes.setMatrixAt(k++,dummy.matrix);
    }
  }
  dashes.count=k;dashes.instanceMatrix.needsUpdate=true;scene.add(dashes);
  const railMat=new THREE.MeshStandardMaterial({color:0x9aa4a8,metalness:.72,roughness:.35});
  for(const side of [-1,1]){
    if (q.railSeg > 0) {
      const pts=[];
      for(let i=0;i<=Math.min(400,q.railSeg);i++){
        const t=i/Math.min(400,q.railSeg),p=curve.getPointAt(t),tan=curve.getTangentAt(t),r=vecRight(tan);
        pts.push(p.addScaledVector(r,side*10.8).add(new THREE.Vector3(0,1.05,0)));
      }
      const railCurve=new THREE.CatmullRomCurve3(pts,true,"catmullrom",.15);
      const rail=new THREE.Mesh(new THREE.TubeGeometry(railCurve,q.railSeg,.095,6,true),railMat);
      rail.castShadow=q.shadows;scene.add(rail);
    } else {
      addRibbon(side*10.8,.18,railMat,1.02);
    }
    const postStep = state.qualityLevel==="low" ? .06 : .035;
    for(let t=.012;t<1;t+=postStep){
      const p=curve.getPointAt(t),tan=curve.getTangentAt(t),r=vecRight(tan);
      const post=new THREE.Mesh(new THREE.BoxGeometry(.11,1.05,.12),railMat);
      post.position.copy(p).addScaledVector(r,side*10.8);post.position.y+=.52;scene.add(post);
    }
  }
}

function addMountains() {
  const rockMat=new THREE.MeshStandardMaterial({color:0x718488,roughness:.96,metalness:.02});
  const snowMat=new THREE.MeshStandardMaterial({color:0xe3e8e4,roughness:.9});
  const count = qcfg().mountains;
  const seg = state.qualityLevel==="low" ? 8 : 16;
  for(let i=0;i<count;i++){
    const a=rand()*Math.PI*2,d=260+rand()*180,h=48+rand()*100,w=32+rand()*58;
    const x=Math.cos(a)*d,z=Math.sin(a)*d;
    const m=new THREE.Mesh(new THREE.ConeGeometry(w,h,seg,3),rockMat);
    m.position.set(x,h/2-8,z);m.rotation.y=rand()*Math.PI;m.rotation.z=(rand()-.5)*.12;m.castShadow=qcfg().shadows;scene.add(m);
    if(h>90){
      const cap=new THREE.Mesh(new THREE.ConeGeometry(w*.31,h*.22,12,2),snowMat);
      cap.position.set(x,h*.88-8,z);cap.rotation.y=m.rotation.y;scene.add(cap);
    }
  }
}

function addForest() {
  const trunkGeo=new THREE.CylinderGeometry(.12,.22,2.6,6);
  const crownGeo=new THREE.ConeGeometry(1.55,4.4,10,2);
  const trunkMat=new THREE.MeshStandardMaterial({color:0x604a38,roughness:1});
  const leafMats=[
    new THREE.MeshStandardMaterial({color:0x315b4a,roughness:.94}),
    new THREE.MeshStandardMaterial({color:0x416c53,roughness:.94}),
    new THREE.MeshStandardMaterial({color:0x547d5b,roughness:.94})
  ];
  const count=qcfg().trees;
  const trunks=new THREE.InstancedMesh(trunkGeo,trunkMat,count);
  const crowns=leafMats.map(mat=>new THREE.InstancedMesh(crownGeo,mat,count));
  const dummy=new THREE.Object3D();
  treeColliders.length = 0;
  for(let i=0;i<count;i++){
    const t=rand(),p=curve.getPointAt(t),tan=curve.getTangentAt(t),r=vecRight(tan);
    const side=rand()>.5?1:-1,dist=14+rand()*88;
    const x=p.x+r.x*side*dist,z=p.z+r.z*side*dist;
    const s=.62+rand()*.82;
    dummy.position.set(x,-.15+1.3*s,z);dummy.rotation.y=rand()*Math.PI*2;dummy.scale.set(s,s,s);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
    const qi=Math.floor(rand()*3);dummy.position.set(x,1.5+3*s,z);dummy.scale.set(s,s,s);dummy.rotation.y=rand()*Math.PI*2;dummy.updateMatrix();crowns[qi].setMatrixAt(i,dummy.matrix);
    if (dist < 28) treeColliders.push({x,z,r:.55*s});
  }
  trunks.instanceMatrix.needsUpdate=true;scene.add(trunks);
  crowns.forEach(mesh=>{mesh.instanceMatrix.needsUpdate=true;scene.add(mesh);});
  const bushGeo=new THREE.DodecahedronGeometry(1,0);
  const bushMat=new THREE.MeshStandardMaterial({color:0x55785a,roughness:1,flatShading:true});
  const bushCount=qcfg().bushes;
  const bushes=new THREE.InstancedMesh(bushGeo,bushMat,bushCount);
  for(let i=0;i<bushCount;i++){
    const t=rand(),p=curve.getPointAt(t),tan=curve.getTangentAt(t),r=vecRight(tan),side=rand()>.5?1:-1;
    dummy.position.set(p.x+r.x*side*(11+rand()*18),-.35,p.z+r.z*side*(11+rand()*18));
    const s=.45+rand()*1.25;dummy.scale.set(s,s*.55,s);dummy.rotation.set(rand(),rand(),rand());dummy.updateMatrix();bushes.setMatrixAt(i,dummy.matrix);
  }
  bushes.instanceMatrix.needsUpdate=true;scene.add(bushes);
}

function addBuildings() {
  const count = qcfg().buildings;
  const wallMats = [
    new THREE.MeshStandardMaterial({color:0xd8d0c2,roughness:.88}),
    new THREE.MeshStandardMaterial({color:0xb9c2c4,roughness:.86}),
    new THREE.MeshStandardMaterial({color:0xc4b49a,roughness:.9}),
    new THREE.MeshStandardMaterial({color:0x8fa0a3,roughness:.82})
  ];
  const roofMat = new THREE.MeshStandardMaterial({color:0x4a3b36,roughness:.78});
  const windowMat = new THREE.MeshStandardMaterial({color:0xf0d9a0,emissive:0xe2b65a,emissiveIntensity:.15,roughness:.35});
  for (let i=0;i<count;i++) {
    const t = (i+0.37)/count;
    const p=curve.getPointAt(t%1),tan=curve.getTangentAt(t%1),r=vecRight(tan);
    const side = i%2?1:-1;
    const dist = 22+rand()*16;
    const g = new THREE.Group();
    const w = 6+rand()*8, d = 5+rand()*7, h = 4+rand()*7;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), wallMats[i%wallMats.length]);
    body.position.y = h/2; body.castShadow = qcfg().shadows; g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w,d)*0.72, 2.2, 4), roofMat);
    roof.position.y = h+1.0; roof.rotation.y = Math.PI/4; g.add(roof);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(w*0.55, h*0.28), windowMat);
    win.position.set(0, h*0.55, d/2+0.03); g.add(win);
    g.position.copy(p).addScaledVector(r, side*dist);
    g.position.y = 0;
    g.rotation.y = Math.atan2(-tan.x,-tan.z) + (side>0?0:Math.PI);
    scene.add(g);
  }
}

function addLake() {
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(48, 40),
    new THREE.MeshPhysicalMaterial({color:0x3d7d86,metalness:.35,roughness:.18,transparent:true,opacity:.78,clearcoat:1,clearcoatRoughness:.15})
  );
  water.rotation.x = -Math.PI/2; water.position.set(210,0.05,40);
  scene.add(water);
  const ring = new THREE.Mesh(new THREE.RingGeometry(48,56,40), new THREE.MeshStandardMaterial({color:0x6b7a52,roughness:1}));
  ring.rotation.x = -Math.PI/2; ring.position.set(210,0.06,40); scene.add(ring);
}

function addStreetFurniture() {
  const postMat=new THREE.MeshStandardMaterial({color:0x42535b,metalness:.45,roughness:.6});
  const lampMat=new THREE.MeshStandardMaterial({color:0xffe0aa,emissive:0xffbc73,emissiveIntensity:1.6});
  lampAnchors.length = 0;
  for(let t=.025;t<1;t+=.075){
    const p=curve.getPointAt(t),tan=curve.getTangentAt(t),r=vecRight(tan);
    const g=new THREE.Group();g.position.copy(p).addScaledVector(r,13.5);g.position.y+=.15;
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.07,.12,7.2,8),postMat);pole.position.y=3.6;g.add(pole);
    const arm=new THREE.Mesh(new THREE.BoxGeometry(.11,.12,2.2),postMat);arm.position.set(-.9,7.05,0);g.add(arm);
    const lamp=new THREE.Mesh(new THREE.BoxGeometry(.58,.18,.42),lampMat);lamp.position.set(-1.85,6.95,0);g.add(lamp);
    scene.add(g);
    const world = new THREE.Vector3();
    lamp.getWorldPosition(world);
    lampAnchors.push(world.clone());
  }
  const signCanvas=document.createElement("canvas");signCanvas.width=512;signCanvas.height=180;
  const c=signCanvas.getContext("2d");c.fillStyle="#153f4a";c.fillRect(0,0,512,180);
  c.strokeStyle="#d8e7d9";c.lineWidth=9;c.strokeRect(8,8,496,164);
  c.fillStyle="#f4f3de";c.font="800 45px Manrope, sans-serif";c.fillText("NORTH COAST",28,76);
  c.font="700 26px Manrope, sans-serif";c.fillStyle="#a8dbd5";c.fillText("SCENIC ROUTE  •  DRIVE SAFE",28,125);
  const tex=new THREE.CanvasTexture(signCanvas);tex.colorSpace=THREE.SRGBColorSpace;
  const signGroup=new THREE.Group();
  const board=new THREE.Mesh(new THREE.BoxGeometry(10,3.5,.22),new THREE.MeshStandardMaterial({map:tex,roughness:.8}));
  board.position.y=9;signGroup.add(board);
  for(const x of [-4.15,4.15]){const pole=new THREE.Mesh(new THREE.CylinderGeometry(.13,.16,8,8),postMat);pole.position.set(x,4,0);signGroup.add(pole);}
  const sp=curve.getPointAt(.08),st=curve.getTangentAt(.08),sr=vecRight(st);
  signGroup.position.copy(sp).addScaledVector(sr,-16);signGroup.position.y=-.3;
  signGroup.rotation.y=Math.atan2(-st.x,-st.z);scene.add(signGroup);
}

function addPitStop() {
  const g=new THREE.Group();
  const wall=new THREE.Mesh(new THREE.BoxGeometry(16,5.5,12),new THREE.MeshStandardMaterial({color:0xddd6c5,roughness:.86}));
  wall.position.y=2.75;g.add(wall);
  const roof=new THREE.Mesh(new THREE.BoxGeometry(17,1,13),new THREE.MeshStandardMaterial({color:0x253b45,roughness:.55,metalness:.25}));
  roof.position.y=5.8;g.add(roof);
  const glass=new THREE.Mesh(new THREE.BoxGeometry(12.5,2.7,.16),new THREE.MeshStandardMaterial({color:0x5d99a0,metalness:.25,roughness:.15,transparent:true,opacity:.75}));
  glass.position.set(0,3.2,-6.08);g.add(glass);
  const fascia=new THREE.Mesh(new THREE.BoxGeometry(14,1.1,.25),new THREE.MeshStandardMaterial({color:0x153b48,roughness:.65}));
  fascia.position.set(0,5.2,-6.2);g.add(fascia);
  const boardCanvas=document.createElement("canvas");boardCanvas.width=512;boardCanvas.height=96;
  const ctx=boardCanvas.getContext("2d");ctx.fillStyle="#153b48";ctx.fillRect(0,0,512,96);ctx.fillStyle="#edbd7e";ctx.font="900 48px Manrope";ctx.textAlign="center";ctx.fillText("PIT  •  STOP",256,65);
  const boardTex=new THREE.CanvasTexture(boardCanvas);boardTex.colorSpace=THREE.SRGBColorSpace;
  const label=new THREE.Mesh(new THREE.PlaneGeometry(12,2.25),new THREE.MeshBasicMaterial({map:boardTex,transparent:true}));
  label.position.set(0,5.2,-6.36);g.add(label);
  for(const x of [-5,0,5]){
    const pump=new THREE.Group();
    const base=new THREE.Mesh(new THREE.BoxGeometry(1.1,1.9,.8),new THREE.MeshStandardMaterial({color:0xd8e3e3,roughness:.4}));
    base.position.y=.95;pump.add(base);
    const screen=new THREE.Mesh(new THREE.BoxGeometry(.78,.48,.045),new THREE.MeshBasicMaterial({color:0x12303a}));
    screen.position.set(0,1.35,.42);pump.add(screen);
    const stripe=new THREE.Mesh(new THREE.BoxGeometry(1.12,.2,.82),new THREE.MeshStandardMaterial({color:0xe26c54}));
    stripe.position.y=1.65;pump.add(stripe);pump.position.set(x,.08,8);g.add(pump);
  }
  const p=curve.getPointAt(.64),t=curve.getTangentAt(.64),r=vecRight(t);
  g.position.copy(p).addScaledVector(r,-30);g.position.y=-.15;g.rotation.y=Math.atan2(-t.x,-t.z);scene.add(g);
  const canopy=new THREE.Mesh(new THREE.BoxGeometry(19,.6,7),new THREE.MeshStandardMaterial({color:0xe7b36f,roughness:.55}));
  canopy.position.set(0,6.4,8);g.add(canopy);
}

function createLampLights() {
  lampLights.length = 0;
  const n = qcfg().lamps;
  for (let i=0;i<n;i++) {
    const light = new THREE.PointLight(0xffcc88, 18, 42, 1.6);
    light.visible = state.time==="night";
    scene.add(light);
    lampLights.push(light);
  }
}

function updateLampLights() {
  if (!lampLights.length || !player || state.time!=="night") return;
  const ranked = lampAnchors.map((p,i)=>({i, d:p.distanceToSquared(player.position)})).sort((a,b)=>a.d-b.d);
  lampLights.forEach((light, idx) => {
    const item = ranked[idx];
    if (!item) { light.visible=false; return; }
    light.visible = true;
    light.position.copy(lampAnchors[item.i]);
    light.position.y += 0.2;
  });
}

function buildWorld() {
  grassTexture=canvasTexture("grass", state.qualityLevel==="low"?512:1024);
  grassTexture.repeat.set(90,90);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(1800,1800),new THREE.MeshStandardMaterial({map:grassTexture,color:0xffffff,roughness:1}));
  ground.rotation.x=-Math.PI/2;ground.position.y=0;ground.receiveShadow=true;scene.add(ground);
  const distantGround=new THREE.Mesh(new THREE.PlaneGeometry(4000,4000),new THREE.MeshStandardMaterial({color:0x5d785d,roughness:1}));
  distantGround.rotation.x=-Math.PI/2;distantGround.position.y=-2.1;scene.add(distantGround);
  const dirt = canvasTexture("dirt", 512); dirt.repeat.set(40,40);
  const verge=new THREE.Mesh(new THREE.CircleGeometry(220,48), new THREE.MeshStandardMaterial({map:dirt,color:0x8a7a5c,roughness:1}));
  verge.rotation.x=-Math.PI/2; verge.position.y=0.01; scene.add(verge);
  buildTrack();addMountains();addForest();addStreetFurniture();addPitStop();addBuildings();
  if (state.qualityLevel!=="low") addLake();
  createLampLights();
}

function makeCar(color, opts={}) {
  const g=new THREE.Group();
  const bodyMat=new THREE.MeshPhysicalMaterial({color,metalness:.72,roughness:.24,clearcoat:.9,clearcoatRoughness:.14});
  const dark=new THREE.MeshStandardMaterial({color:0x111820,metalness:.25,roughness:.3});
  const glass=new THREE.MeshPhysicalMaterial({color:0x1e3544,metalness:.35,roughness:.09,transparent:true,opacity:.88,clearcoat:1});
  const rubber=new THREE.MeshStandardMaterial({color:0x101215,roughness:.94});
  const rim=new THREE.MeshStandardMaterial({color:0xb8c5ca,metalness:.88,roughness:.25});
  const lamp=new THREE.MeshStandardMaterial({color:0xfff1cf,emissive:0xffdba0,emissiveIntensity:2.4});
  const tail=new THREE.MeshStandardMaterial({color:0xff392f,emissive:0xc51e1a,emissiveIntensity:1.4});
  carPaintMaterial=bodyMat;
  const box=(w,h,d,mat,x,y,z,rx=0,ry=0,rz=0)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=true;g.add(m);return m;};
  box(2.12,.58,4.35,bodyMat,0,.74,0);
  box(2.03,.28,1.42,bodyMat,0,.99,-1.42);
  box(1.98,.28,.92,bodyMat,0,.99,1.65);
  box(1.68,.78,1.95,bodyMat,0,1.34,.05);
  box(1.55,.08,1.25,bodyMat,0,1.78,.12);
  box(1.53,.62,.055,glass,0,1.42,-.97,.24);
  box(1.53,.58,.055,glass,0,1.42,1.06,-.22);
  box(.06,.68,1.12,dark,-.86,1.36,.08,0,0,-.07);
  box(.06,.68,1.12,dark,.86,1.36,.08,0,0,.07);
  box(2.14,.18,.16,dark,0,.48,-2.15);
  box(2.14,.18,.16,dark,0,.48,2.15);
  const headMats=[lamp], tailMats=[tail];
  for(const x of [-.77,.77]){
    box(.43,.17,.08,lamp,x,.82,-2.2);
    box(.35,.15,.08,tail,x,.82,2.2);
    const mirror=box(.22,.18,.32,bodyMat,x*1.18,1.35,-.55,0,0,x*.15);
    mirror.scale.set(1,1,.85);
  }
  const wheels=[];
  for(const x of [-1.08,1.08])for(const z of [-1.43,1.43]){
    const w=new THREE.Group();w.position.set(x,.48,z);
    const tire=new THREE.Mesh(new THREE.CylinderGeometry(.43,.43,.34,20),rubber);tire.rotation.z=Math.PI/2;tire.castShadow=true;w.add(tire);
    const rimMesh=new THREE.Mesh(new THREE.CylinderGeometry(.245,.245,.36,12),rim);rimMesh.rotation.z=Math.PI/2;w.add(rimMesh);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.37,12),dark);hub.rotation.z=Math.PI/2;w.add(hub);
    g.add(w);wheels.push(w);
  }
  const headlights=[];
  if (opts.spots) {
    for(const x of [-.72,.72]){
      const light=new THREE.SpotLight(0xf3e5c3,32,58,Math.PI/7,.4,1.2);
      light.position.set(x,.88,-1.8);light.target.position.set(x,0,-24);g.add(light);g.add(light.target);headlights.push(light);
    }
  }
  g.userData={wheels,headlights,bodyMat,headMats,tailMats};
  return g;
}

const CAR_OPTIONS = {
  spectral: {
    id:"spectral", name:"Spectral GT RS", type:"Спортивное купе",
    url:"https://raw.githubusercontent.com/JaronKBragg7337/spectral-gt-rs/main/spectral_gt_rs_game_ready.glb",
    rotationY:Math.PI/2, driverSide:1, spinAxis:"z", wheelRadius:.36,
    accel:28, top:194.5, grip:1,
    gears:8, redline:8500, speedoMax:800, drag:0.000048, powerFalloff:1.65,
    digitalDash:true, shiftAt:[22,42,66,94,122,150,172]
  },
  suv: {
    id:"suv", name:"Kenney SUV", type:"Повседневный SUV",
    url:"https://raw.githubusercontent.com/ivanivorontsov-sudo/car-simulator/main/assets/models/cars/suv.glb",
    rotationY:Math.PI, driverSide:-1, spinAxis:"x", fitLength:4.35, wheelRadius:.30,
    accel:16.5, top:48, grip:1.12,
    gears:6, redline:6500, speedoMax:260, digitalDash:false
  }
};

function disposeVehicleObject(root){
  if(!root)return;
  root.traverse(obj=>{
    if(obj.geometry)obj.geometry.dispose();
    const mats=Array.isArray(obj.material)?obj.material:(obj.material?[obj.material]:[]);
    mats.forEach(mat=>{
      ["map","normalMap","roughnessMap","metalnessMap","emissiveMap","aoMap","alphaMap"].forEach(key=>{
        if(mat[key]&&mat[key].dispose)mat[key].dispose();
      });
      mat.dispose();
    });
  });
}

function updateCarSelectionUI(){
  document.querySelectorAll("[data-car]").forEach(btn=>{
    const active=btn.dataset.car===state.car;
    btn.classList.toggle("active",active);
    btn.setAttribute("aria-pressed",String(active));
  });
}

function updateCarPaint(){
  if(playerFallback?.userData.bodyMat)playerFallback.userData.bodyMat.color.set(state.paint);
  if(player?.userData.loadedModel)player.userData.loadedModel.traverse(obj=>{
    if(!obj.isMesh)return;
    const mats=Array.isArray(obj.material)?obj.material:[obj.material];
    mats.forEach(m=>{
      const n=(m.name||"").toLowerCase();
      if(n.includes("colormap")||n.includes("paint")||n.includes("body paint")||n.includes("spectral blue"))m.color.set(state.paint);
    });
  });
}

function loadCar(carId){
  const config=CAR_OPTIONS[carId]||CAR_OPTIONS.spectral;
  const request=++state.carLoadToken;
  state.car=config.id;
  state.driverSide=config.driverSide;
  updateCarSelectionUI();

  if(player.userData.loadedModel){
    const old=player.userData.loadedModel;player.remove(old);disposeVehicleObject(old);
    player.userData.loadedModel=null;
  }
  if(playerFallback){
    player.remove(playerFallback);disposeVehicleObject(playerFallback);playerFallback=null;
  }
  playerFallback=makeCar(state.paint);
  player.add(playerFallback);
  player.userData.rollingWheels=[];
  player.userData.wheelSpinAxis=config.spinAxis;
  player.userData.wheelRadius=config.wheelRadius;
  player.userData.steeringWheel=null;
  player.userData.steeringWheelBase=null;
  buildCockpit();
  playerFallback.visible=state.camera!==1;
  setLoadStatus("Загружается "+config.name+"…");

  const loader=new GLTFLoader();
  loader.load(config.url,(gltf)=>{
    const model=gltf.scene;
    if(request!==state.carLoadToken){disposeVehicleObject(model);return;}
    model.rotation.y=config.rotationY;
    model.updateMatrixWorld(true);
    let fitScale=1;
    if(config.fitLength){
      const originalBounds=new THREE.Box3().setFromObject(model);
      const originalSize=originalBounds.getSize(new THREE.Vector3());
      fitScale=config.fitLength/(Math.max(originalSize.x,originalSize.z)||2.7);
      model.scale.setScalar(fitScale);
      model.updateMatrixWorld(true);
    }
    const bounds=new THREE.Box3().setFromObject(model);
    model.position.y-=bounds.min.y;
    const rollingWheels=[];let wheelSteering=null;
    model.traverse(obj=>{
      if(!obj.isMesh)return;
      if(obj.isLight){obj.visible=false;obj.intensity=0;return;}
      obj.castShadow=true;obj.receiveShadow=true;
      if(Array.isArray(obj.material))obj.material=obj.material.map(m=>m.clone());
      else if(obj.material)obj.material=obj.material.clone();
      const mats=Array.isArray(obj.material)?obj.material:[obj.material];
      mats.forEach(m=>{
        const n=(m.name||"").toLowerCase();
        if(n.includes("colormap")||n.includes("spectral blue")||n.includes("paint")||n.includes("body paint"))m.color.set(state.paint);
        if(m.emissiveIntensity>1.6)m.emissiveIntensity=1.2;
      });
      const name=(obj.name||"").toLowerCase();
      if(config.id==="spectral"&&/^(front|rear)_(left|right)_tire$/i.test(name))rollingWheels.push(obj);
      if(config.id==="suv"&&/^wheel-(front|back)-(left|right)$/i.test(name))rollingWheels.push(obj);
      if(name==="steering_wheel")wheelSteering=obj;
    });

    player.remove(playerFallback);
    disposeVehicleObject(playerFallback);
    playerFallback=null;
    player.add(model);
    player.userData.loadedModel=model;
    player.userData.bodyShell=null;
    player.userData.rollingWheels=rollingWheels;
    player.userData.wheelSpinAxis=config.spinAxis;
    player.userData.wheelRadius=config.fitLength ? 0.30*fitScale : (config.wheelRadius||.36);
    player.userData.steeringWheel=wheelSteering;
    player.userData.steeringWheelBase=wheelSteering?wheelSteering.rotation.clone():null;
    player.updateMatrixWorld(true);
    updateCarPaint();
    styleLoadedCar(model,config);
    createPlayerDashboard();
    setLoadStatus(config.name+" · модель загружена");
    if(state.camera===1)setMessage("Вид водителя · "+config.name,3);
  },undefined,(error)=>{
    if(request!==state.carLoadToken)return;
    console.warn(config.name+" unavailable; keeping procedural fallback",error);
    setLoadStatus(config.name+" не загрузился · используется резервная машина.");
    toast("Не удалось загрузить модель. Включена резервная машина.");
  });
}

function selectCar(carId){
  if(!CAR_OPTIONS[carId])return;
  if(state.car===carId&&player.userData.loadedModel){updateCarSelectionUI();return;}
  state.car=carId;
  try{localStorage.setItem("driveHorizonCarV2",carId);}catch(e){console.warn("Car preference unavailable",e);}
  updateCarSelectionUI();
  loadCar(carId);
  toast("Выбран автомобиль: "+CAR_OPTIONS[carId].name);
}

function createTraffic() {
  const palette=["#f2f0e9","#2585b9","#d0a04e","#5e7782","#c84a3b","#303844"];
  const n = qcfg().traffic;
  traffic = [];
  for(let i=0;i<n;i++){
    const color=palette[i%palette.length],visual=makeCar(color);
    visual.scale.setScalar(.88);scene.add(visual);
    traffic.push({
      visual, progress:(.06+i*(0.92/n))%1, offset:[-5.7,-1.8,1.8,5.7][i%4],
      speed:21+rand()*14, wiggle:rand()*Math.PI*2, hit:false, hitTimer:0,
      flee:0, honkBack:0, baseOffset:[-5.7,-1.8,1.8,5.7][i%4]
    });
  }
}

function drawMiniMap() {
  if(!minimapContext || !curve)return;
  const c=minimapContext,w=180,h=180;
  c.clearRect(0,0,w,h);c.fillStyle="rgba(7,16,24,.15)";c.fillRect(0,0,w,h);
  const pts=[];let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(let i=0;i<=240;i++){const p=curve.getPointAt(i/240);pts.push(p);minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);}
  const scale=Math.min(130/(maxX-minX),130/(maxZ-minZ));
  const map=(p)=>({x:90+(p.x-(minX+maxX)/2)*scale,y:90+(p.z-(minZ+maxZ)/2)*scale});
  c.lineCap="round";c.lineJoin="round";c.beginPath();
  pts.forEach((p,i)=>{const v=map(p);if(i)c.lineTo(v.x,v.y);else c.moveTo(v.x,v.y);});
  c.closePath();c.strokeStyle="rgba(220,233,230,.22)";c.lineWidth=12;c.stroke();
  c.strokeStyle="#9cb6b5";c.lineWidth=5;c.stroke();
  c.strokeStyle="#e0b77d";c.lineWidth=1.2;c.setLineDash([4,5]);c.stroke();c.setLineDash([]);
  const here=map(curve.getPointAt(((state.progress%1)+1)%1));
  c.beginPath();c.arc(here.x,here.y,6,0,Math.PI*2);c.fillStyle="#72e1d7";c.shadowColor="#72e1d7";c.shadowBlur=12;c.fill();c.shadowBlur=0;
  traffic.forEach(car=>{
    const v=map(curve.getPointAt(car.progress));
    c.fillStyle="#f0b17a";c.fillRect(v.x-2,v.y-2,4,4);
  });
  c.beginPath();c.arc(90,90,75,0,Math.PI*2);c.strokeStyle="rgba(255,255,255,.07)";c.lineWidth=1;c.stroke();
}

function setMessage(text,duration=2.3) {
  const el=$("message");
  if(el){
    el.textContent=text||"";
    el.classList.toggle("hidden", !text);
  }
  state.messageTimer=text?duration:0;
}

function isPortraitView(){ return window.innerHeight > window.innerWidth + 40; }

function syncViewClasses(){
  document.body.classList.toggle("cam-cockpit", state.camera===1);
  document.body.classList.toggle("hud-compact", true);
}

function syncCockpitMirror(){
  const portrait=isPortraitView();
  const x=portrait?state.driverSide*.49:0;
  const y=portrait?1.82:1.76;
  const z=portrait?-1.00:-1.10;
  if(mirrorFrame) mirrorFrame.position.set(x,y,z);
  if(mirrorMesh) mirrorMesh.position.set(x,y,z+.012);
  if(mirrorFallback) mirrorFallback.position.set(x,y,z+.012);
}

function styleLoadedCar(model, config){
  if(!model||config.id!=="spectral") return;
  model.traverse(obj=>{
    if(!obj.isMesh||!obj.material)return;
    const mats=Array.isArray(obj.material)?obj.material:[obj.material];
    mats.forEach(m=>{
      if(!m)return;
      const n=((m.name||"")+" "+(obj.name||"")).toLowerCase();
      const isGlass=/glass|window|windshield|windscreen|canopy/.test(n)||(m.transparent&&(m.opacity??1)<.9);
      const isLight=/light|lamp|led|tail|head|brake|stop/.test(n);
      const isPaint=/colormap|paint|spectral blue|body/.test(n)&&!isGlass;
      if(isGlass){
        m.color.setHex(0x0c141c);
        m.transparent=true;
        m.opacity=Math.min(m.opacity??1,.32);
        m.roughness=.06;
        m.metalness=.2;
      }else if(isPaint){
        m.metalness=Math.max(m.metalness||0,.42);
        m.roughness=Math.min(m.roughness??.28,.18);
        if("clearcoat" in m){m.clearcoat=1;m.clearcoatRoughness=.05;}
      }
      if(m.emissive){
        const er=m.emissive.r,eg=m.emissive.g,eb=m.emissive.b;
        if(er>.45&&eg<.28&&eb<.28){
          if(isLight){m.emissive.setHex(0xff2030);m.emissiveIntensity=Math.min(m.emissiveIntensity||1,.85);}
          else {m.emissive.setHex(0x22080a);m.emissiveIntensity=Math.min(m.emissiveIntensity||0,.12);}
        }
      }
    });
  });
  if(state.qualityLevel!=="low") addHypercarLightStrips(model);
}

function addHypercarLightStrips(model){
  if(!model||!player) return;
  const box=new THREE.Box3().setFromObject(model);
  const size=box.getSize(new THREE.Vector3());
  if(size.x<0.4||size.z<0.4) return;
  const toModel=(x,y,z)=>{
    const w=player.localToWorld(new THREE.Vector3(x,y,z));
    return model.worldToLocal(w);
  };
  const corners=[];
  model.traverse(obj=>{
    if(!obj.isMesh||!obj.geometry)return;
    if(!obj.geometry.boundingBox)obj.geometry.computeBoundingBox();
    const b=obj.geometry.boundingBox;
    for(const x of [b.min.x,b.max.x]) for(const y of [b.min.y,b.max.y]) for(const z of [b.min.z,b.max.z]){
      const p=new THREE.Vector3(x,y,z).applyMatrix4(obj.matrixWorld);
      player.worldToLocal(p);corners.push(p);
    }
  });
  if(!corners.length) return;
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
  corners.forEach(p=>{minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);});
  const frontMat=new THREE.MeshStandardMaterial({color:0xeaf4ff,emissive:0x9ec8ff,emissiveIntensity:1.45,roughness:.25});
  const rearMat=new THREE.MeshStandardMaterial({color:0xff2a28,emissive:0xff1830,emissiveIntensity:1.1,roughness:.3});
  const mk=(w,h,d,mat,x,y,z)=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
    mesh.position.copy(toModel(x,y,z));
    mesh.name="hypercar-led";
    model.add(mesh);
  };
  mk((maxX-minX)*.46,.026,.034,frontMat,(minX+maxX)/2,minY+(maxY-minY)*.30,minZ+.05);
  mk((maxX-minX)*.52,.022,.03,rearMat,(minX+maxX)/2,minY+(maxY-minY)*.38,maxZ-.05);
}

function buildCockpit(){
  if(cockpitGroup&&player){
    player.remove(cockpitGroup);
    cockpitGroup.traverse(obj=>{
      if(obj.geometry)obj.geometry.dispose();
      const mats=Array.isArray(obj.material)?obj.material:(obj.material?[obj.material]:[]);
      mats.forEach(m=>{if(m.map&&m.map.dispose)m.map.dispose();m.dispose();});
    });
  }
  if(mirrorRT){mirrorRT.dispose();mirrorRT=null;}
  mirrorCam=null;mirrorMesh=null;
  cockpitGaugeContext=null;cockpitGaugeTexture=null;cockpitCenterContext=null;cockpitCenterTexture=null;
  cockpitGroup=new THREE.Group();
  player.add(cockpitGroup);
  cockpitGroup.visible=state.camera===1;

  const side=state.driverSide>=0?1:-1;
  const driverX=side*.49;
  const digital=!!carSpec().digitalDash;
  const rich=state.qualityLevel!=="low";
  const dashMat=new THREE.MeshStandardMaterial({color:digital?0x0e1114:0x12181d,roughness:digital?.38:.48,metalness:digital?.45:.28});
  const softMat=new THREE.MeshStandardMaterial({color:0x080c10,roughness:.92});
  const trimMat=new THREE.MeshStandardMaterial({color:digital?0x2a2e32:0xc4ced1,roughness:digital?.32:.24,metalness:digital?.78:.86});
  const seatMat=new THREE.MeshStandardMaterial({color:digital?0x15181c:0x272f36,roughness:.94});
  const leatherMat=new THREE.MeshStandardMaterial({color:0x10151a,roughness:.76});
  const screenFrameMat=new THREE.MeshStandardMaterial({color:0x070b0f,roughness:.22,metalness:.38});
  const glowMat=new THREE.MeshStandardMaterial({color:0x1b3a40,emissive:digital?0x24c2c8:0x1a6a68,emissiveIntensity:rich?(digital?.7:.4):.18,roughness:.4});
  const glassMat=new THREE.MeshPhysicalMaterial({color:0xb5d7e2,roughness:.08,metalness:0,transparent:true,opacity:.03,side:THREE.DoubleSide,depthWrite:false});
  const box=(w,h,d,mat,x,y,z,rx=0,ry=0,rz=0)=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
    mesh.position.set(x,y,z);mesh.rotation.set(rx,ry,rz);
    mesh.castShadow=true;mesh.receiveShadow=true;cockpitGroup.add(mesh);return mesh;
  };
  const cylinder=(radius,depth,mat,x,y,z)=>{
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,depth,28),mat);
    mesh.rotation.x=Math.PI/2;mesh.position.set(x,y,z);cockpitGroup.add(mesh);return mesh;
  };

  // Thin cowl: we should see a short front edge, not a wide tabletop.
  box(1.86,.05,.16,dashMat,0,.90,-.84,-.22);
  box(1.78,.07,.12,leatherMat,0,.85,-.76,-.14);
  box(1.58,.006,.06,trimMat,0,.928,-.86,-.22);
  box(1.34,.007,.035,glowMat,0,.922,-.848,-.22);

  // Recessed binnacle behind the cluster, not covering the screen.
  box(.74,.28,.04,screenFrameMat,driverX,1.02,-.975);
  box(.76,.01,.07,trimMat,driverX,1.15,-.95);

  // Center stack, low and inboard of the wheel.
  box(.44,.22,.13,dashMat,0,.82,-.68,-.16);
  box(.40,.24,.035,screenFrameMat,0,.96,-.718);
  box(.38,.008,.03,trimMat,0,.835,-.70);
  for(let i=0;i<3;i++){
    const knob=cylinder(.026,.03,trimMat,(i-1)*.09,.74,-.62);
    knob.rotation.z=Math.PI/2;
  }

  // Vents sit on the cowl corners, not as a wall.
  for(const x of [-.46,.46]){
    box(.16,.045,.03,trimMat,x,.93,-.79);
    for(let i=-2;i<=2;i++) box(.14,.003,.022,softMat,x,.93+i*.007,-.778);
  }

  // Thin A-pillars pushed wide and tilted back so they only frame the glass.
  box(.02,.03,.95,leatherMat,-1.34,.86,.12);
  box(.02,.03,.95,leatherMat,1.34,.86,.12);

  // Slim roof lip, high enough to sit at the very top of the frame.
  box(1.96,.016,.04,softMat,0,1.94,-1.20);
  const windshield=new THREE.Mesh(new THREE.PlaneGeometry(2.12,1.12),glassMat);
  windshield.position.set(0,1.50,-1.24);
  windshield.renderOrder=2;cockpitGroup.add(windshield);

  // Seats stay behind the camera.
  for(const x of [-.49,.49]){
    box(.57,.14,.62,seatMat,x,.43,.88);
    box(.56,.65,.16,seatMat,x,.78,1.14,-.08);
    box(.34,.15,.13,leatherMat,x,1.12,1.15);
  }

  if(digital&&rich){
    box(1.46,.006,.01,glowMat,0,.935,-.83);
    box(.01,.05,.28,glowMat,driverX-.38,.98,-.88);
  }

  // Smaller wheel, raised and tilted so the rim sits in the lower frame.
  steeringWheelVisual=new THREE.Group();
  steeringWheelVisual.position.set(driverX,.94,-.68);
  steeringWheelVisual.rotation.x=.32;
  cockpitGroup.add(steeringWheelVisual);
  const wheelMat=new THREE.MeshStandardMaterial({color:0x090d11,roughness:digital?.7:.42,metalness:digital?.15:0});
  if(digital){
    const carbon=new THREE.MeshStandardMaterial({color:0x1a1d21,roughness:.3,metalness:.72});
    const arc=new THREE.Mesh(new THREE.TorusGeometry(.148,.015,12,40,Math.PI*1.32),wheelMat);
    arc.rotation.z=Math.PI*.34;steeringWheelVisual.add(arc);
    const flat=new THREE.Mesh(new THREE.BoxGeometry(.18,.016,.022),carbon);
    flat.position.y=-.112;steeringWheelVisual.add(flat);
    const hub=new THREE.Mesh(new THREE.BoxGeometry(.1,.05,.028),carbon);
    hub.position.z=.014;steeringWheelVisual.add(hub);
    for(const [x,y,a] of [[-.055,.02,-.55],[.055,.02,.55],[0,-.055,0]]){
      const spoke=new THREE.Mesh(new THREE.BoxGeometry(.016,.1,.02),carbon);
      spoke.position.set(x,y,.01);spoke.rotation.z=a;steeringWheelVisual.add(spoke);
    }
    if(rich){
      const btn=new THREE.MeshStandardMaterial({color:0x101318,emissive:0x1ad0c8,emissiveIntensity:.45});
      for(const x of [-.028,.028]){
        const b=new THREE.Mesh(new THREE.BoxGeometry(.016,.012,.01),btn);
        b.position.set(x,.008,.03);steeringWheelVisual.add(b);
      }
    }
  }else{
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.135,.016,14,56),wheelMat);
    steeringWheelVisual.add(ring);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(.032,.032,.04,22),trimMat);
    hub.rotation.x=Math.PI/2;hub.position.z=.016;steeringWheelVisual.add(hub);
    for(const [x,y,angle] of [[0,.072,0],[-.062,-.04,-.72],[.062,-.04,.72]]){
      const spoke=new THREE.Mesh(new THREE.BoxGeometry(.016,.11,.02),trimMat);
      spoke.position.set(x,y,.01);spoke.rotation.z=angle;steeringWheelVisual.add(spoke);
    }
  }

  const clusterCanvas=document.createElement("canvas");clusterCanvas.width=1024;clusterCanvas.height=512;
  cockpitGaugeContext=clusterCanvas.getContext("2d");
  cockpitGaugeTexture=new THREE.CanvasTexture(clusterCanvas);cockpitGaugeTexture.colorSpace=THREE.SRGBColorSpace;
  cockpitGaugeTexture.anisotropy=4;
  const clusterScreen=new THREE.Mesh(
    digital?new THREE.PlaneGeometry(.92,.28):new THREE.PlaneGeometry(.68,.24),
    new THREE.MeshBasicMaterial({map:cockpitGaugeTexture,side:THREE.DoubleSide,toneMapped:false})
  );
  if(digital) clusterScreen.position.set(driverX,1.04,-.90);
  else clusterScreen.position.set(driverX,1.02,-.92);
  clusterScreen.rotation.x=.08;clusterScreen.renderOrder=10;cockpitGroup.add(clusterScreen);

  const centerCanvas=document.createElement("canvas");centerCanvas.width=768;centerCanvas.height=480;
  cockpitCenterContext=centerCanvas.getContext("2d");
  cockpitCenterTexture=new THREE.CanvasTexture(centerCanvas);cockpitCenterTexture.colorSpace=THREE.SRGBColorSpace;
  const centerScreen=new THREE.Mesh(
    digital?new THREE.PlaneGeometry(.46,.26):new THREE.PlaneGeometry(.38,.22),
    new THREE.MeshBasicMaterial({map:cockpitCenterTexture,side:THREE.DoubleSide,toneMapped:false})
  );
  if(digital) centerScreen.position.set(0,.97,-.70);
  else centerScreen.position.set(0,.96,-.72);
  centerScreen.rotation.x=.25;centerScreen.renderOrder=10;cockpitGroup.add(centerScreen);

  // Rear-view mirror hangs from the header; portrait recenters it in the driver's view.
  mirrorFrame=box(.38,.12,.018,trimMat,0,1.76,-1.10);
  mirrorFallback=null;
  if(state.qualityLevel!=="low"){
    mirrorRT=new THREE.WebGLRenderTarget(384,160,{colorSpace:THREE.SRGBColorSpace});
    mirrorCam=new THREE.PerspectiveCamera(58,384/160,.15,280);
    mirrorMesh=new THREE.Mesh(
      new THREE.PlaneGeometry(.34,.11),
      new THREE.MeshBasicMaterial({map:mirrorRT.texture,toneMapped:false})
    );
    mirrorMesh.position.set(0,1.76,-1.088);mirrorMesh.renderOrder=11;cockpitGroup.add(mirrorMesh);
  }else{
    mirrorFallback=box(.34,.11,.01,new THREE.MeshBasicMaterial({color:0x152028}),0,1.76,-1.088);
  }
  syncCockpitMirror();

  drawCockpitCenterDisplay();
  cockpitGaugeLast=0;
  drawCockpitDashboard(0,850,"N",true);
}

function drawAnalogGauge(ctx,cx,cy,radius,value,max,opts){
  const start=Math.PI*0.75, sweep=Math.PI*1.5;
  ctx.beginPath();ctx.arc(cx,cy,radius+10,0,Math.PI*2);
  const ring=ctx.createLinearGradient(cx-radius,cy,cx+radius,cy);
  ring.addColorStop(0,"#6f7d84");ring.addColorStop(.5,"#d5e0e4");ring.addColorStop(1,"#6f7d84");
  ctx.strokeStyle=ring;ctx.lineWidth=11;ctx.stroke();
  const face=ctx.createRadialGradient(cx-radius*.25,cy-radius*.3,8,cx,cy,radius);
  face.addColorStop(0,"#1c272e");face.addColorStop(1,"#070b0e");
  ctx.fillStyle=face;ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.fill();
  if(opts.redline!=null){
    const a0=start+sweep*(opts.redline/max);
    ctx.strokeStyle="#d94438";ctx.lineWidth=9;ctx.beginPath();
    ctx.arc(cx,cy,radius-8,a0,start+sweep);ctx.stroke();
  }
  ctx.lineCap="round";
  for(let v=0;v<=max;v+=opts.step){
    const t=v/max,a=start+sweep*t;
    const major=v%(opts.major||opts.step*2)===0;
    const inner=major?radius-26:radius-14;
    ctx.strokeStyle=(opts.redline!=null&&v>=opts.redline)?"#fb6b55":(major?"#e8eef0":"#7f8c93");
    ctx.lineWidth=major?4:2;
    ctx.beginPath();
    ctx.moveTo(cx+Math.cos(a)*inner,cy+Math.sin(a)*inner);
    ctx.lineTo(cx+Math.cos(a)*radius,cy+Math.sin(a)*radius);
    ctx.stroke();
    if(major){
      ctx.fillStyle="#d5dee3";ctx.font="700 18px Manrope, sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
      const label=opts.asK?String(v/1000):String(v);
      ctx.fillText(label,cx+Math.cos(a)*(radius-44),cy+Math.sin(a)*(radius-44));
    }
  }
  const na=start+sweep*clamp(value/max,0,1);
  ctx.save();ctx.translate(cx,cy);ctx.rotate(na);
  ctx.fillStyle="#ff4a38";
  ctx.shadowColor="#ff4a38";ctx.shadowBlur=12;
  ctx.beginPath();ctx.moveTo(-7,7);ctx.lineTo(radius-30,0);ctx.lineTo(-7,-7);ctx.closePath();ctx.fill();
  ctx.restore();
  ctx.fillStyle="#dfe7ea";ctx.beginPath();ctx.arc(cx,cy,11,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#2a3136";ctx.beginPath();ctx.arc(cx,cy,5,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#8fa3ad";ctx.font="800 16px Manrope, sans-serif";ctx.textAlign="center";ctx.textBaseline="alphabetic";
  ctx.fillText(opts.label,cx,cy+58);
  ctx.fillStyle="#c5d4da";ctx.font="700 13px Manrope, sans-serif";ctx.fillText(opts.unit||"",cx,cy+76);
}

function drawCockpitCenterDisplay(){
  if(!cockpitCenterContext||!cockpitCenterTexture)return;
  const c=cockpitCenterContext,w=768,h=480;
  const bg=c.createLinearGradient(0,0,w,h);
  bg.addColorStop(0,"#163846");bg.addColorStop(1,"#0b1c26");
  c.fillStyle=bg;c.fillRect(0,0,w,h);
  c.fillStyle="#8ff0e6";c.font="800 22px Manrope, sans-serif";c.fillText("DRIVE HORIZON",24,36);
  c.fillStyle="#c5e2ea";c.font="700 13px Manrope, sans-serif";c.fillText("LIVE NAV  ·  NEXT CHECKPOINT "+((state.checkpoint%8)+1)+"/8",24,58);
  c.strokeStyle="rgba(255,255,255,.1)";c.beginPath();c.moveTo(22,70);c.lineTo(746,70);c.stroke();
  c.fillStyle="#eaf4f4";c.font="800 28px Manrope, sans-serif";
  c.fillText(String(Math.round(Math.abs(state.speed)*3.6)).padStart(3,"0")+" km/h",24,112);
  c.fillStyle="#f5c58a";c.font="800 22px Manrope, sans-serif";c.fillText("P "+Math.round(state.score),260,112);
  c.fillStyle="#9cb8c1";c.font="700 16px Manrope, sans-serif";c.fillText("x"+state.combo+"   "+(state.distance/1000).toFixed(2)+" km",24,140);
  if(curve){
    const pts=[];let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for(let i=0;i<=120;i++){const p=curve.getPointAt(i/120);pts.push(p);minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);}
    const scale=Math.min(300/(maxX-minX||1),220/(maxZ-minZ||1));
    const map=(p)=>({x:384+(p.x-(minX+maxX)/2)*scale,y:300+(p.z-(minZ+maxZ)/2)*scale});
    c.save();c.strokeStyle="rgba(220,233,230,.2)";c.lineWidth=16;c.lineCap="round";c.beginPath();
    pts.forEach((p,i)=>{const v=map(p);if(i)c.lineTo(v.x,v.y);else c.moveTo(v.x,v.y);});
    c.stroke();c.strokeStyle="#75ded6";c.lineWidth=3;c.stroke();
    const here=map(curve.getPointAt(((state.progress%1)+1)%1));
    c.fillStyle="#f4c58b";c.beginPath();c.arc(here.x,here.y,7,0,Math.PI*2);c.fill();
    const cp=map(curve.getPointAt((state.checkpoint%8)/8));
    c.strokeStyle="#9be8df";c.lineWidth=2;c.setLineDash([5,4]);
    c.beginPath();c.moveTo(here.x,here.y);c.lineTo(cp.x,cp.y);c.stroke();c.setLineDash([]);
    c.fillStyle="#7be2d8";c.beginPath();c.arc(cp.x,cp.y,5,0,Math.PI*2);c.fill();
    c.restore();
  }
  c.fillStyle="rgba(255,255,255,.08)";c.fillRect(22,438,724,24);
  c.fillStyle="#9cb8c1";c.font="700 13px Manrope, sans-serif";
  c.fillText((state.time==="night"?"NIGHT":state.time==="day"?"DAY":"SUNSET")+"  ·  GPS ONLINE  ·  "+(state.damage<20?"OK":"DAMAGE "+Math.round(state.damage)+"%"),36,455);
  cockpitCenterTexture.needsUpdate=true;
}

function drawDigitalCluster(c,speed,rpm,gear){
  const redline=carSpec().redline||8500;
  const cap=carSpec().speedoMax||800;
  const bg=c.createLinearGradient(0,0,0,512);
  bg.addColorStop(0,"#0a1016");bg.addColorStop(1,"#030508");
  c.fillStyle=bg;c.fillRect(0,0,1024,512);
  c.fillStyle="#14e0d2";c.fillRect(0,0,1024,3);
  const start=Math.PI*0.92,end=Math.PI*0.08;
  c.strokeStyle="rgba(255,255,255,.08)";c.lineWidth=16;c.lineCap="round";
  c.beginPath();c.arc(512,390,270,start,end,true);c.stroke();
  const t=clamp(rpm/redline,0,1);
  const grd=c.createLinearGradient(140,0,884,0);
  grd.addColorStop(0,"#2cf0d6");grd.addColorStop(.72,"#f0d08a");grd.addColorStop(1,"#ff4a38");
  const span=start-end;
  c.strokeStyle=grd;c.beginPath();c.arc(512,390,270,start,start-span*t,true);c.stroke();
  c.fillStyle="rgba(255,255,255,.35)";c.font="700 16px Manrope, sans-serif";c.textAlign="center";
  c.fillText("RPM  "+Math.round(rpm).toLocaleString("en-US"),512,148);
  c.fillStyle="#f4fbff";c.font="900 148px Manrope, sans-serif";
  c.fillText(String(Math.min(cap,Math.round(Math.abs(speed)))).padStart(3,"0"),432,340);
  c.fillStyle="#8fa3ad";c.font="800 22px Manrope, sans-serif";c.fillText("KM/H",432,382);
  c.fillStyle="#0b1418";
  if(c.roundRect){c.beginPath();c.roundRect(690,250,150,110,18);c.fill();}
  else c.fillRect(690,250,150,110);
  c.fillStyle="#7fdad4";c.font="800 14px Manrope, sans-serif";c.fillText("GEAR",765,282);
  c.fillStyle="#f5c58a";c.font="900 64px Manrope, sans-serif";c.fillText(String(gear),765,348);
  c.fillStyle="#5ee0c8";c.font="800 13px Manrope, sans-serif";c.fillText("RACE",765,372);
  const fuel=clamp(1-(state.totalDistance||0)/180000,.14,1);
  const temp=clamp(.32+Math.abs(rpm)/9000*.5,.3,.95);
  const bar=(x,y,label,ratio,ok)=>{
    c.fillStyle="#8fa3ad";c.font="700 12px Manrope, sans-serif";c.textAlign="left";c.fillText(label,x,y);
    c.fillStyle="rgba(255,255,255,.1)";c.fillRect(x+58,y-10,160,7);
    c.fillStyle=ok?"#6fd9d6":"#fb6b55";c.fillRect(x+58,y-10,160*ratio,7);
  };
  bar(48,448,"FUEL",fuel,fuel>.2);
  bar(758,448,"TEMP",temp,temp<.82);
  const lamps=[
    ["L", Math.abs(state.steer)>.55 && (clock.now%0.7)<0.35 && state.steer<0, "#59e08a"],
    ["R", Math.abs(state.steer)>.55 && (clock.now%0.7)<0.35 && state.steer>0, "#59e08a"],
    ["LED", state.time==="night", "#f0d08a"],
    ["P", !!(controls.handbrake||hardware.handbrake), "#fb6b55"],
    ["!", state.damage>45, "#fb6b55"]
  ];
  lamps.forEach((lamp,i)=>{
    const x=300+i*90,y=478;
    c.fillStyle=lamp[1]?lamp[2]:"#22292e";
    c.beginPath();c.arc(x,y,10,0,Math.PI*2);c.fill();
    c.fillStyle=lamp[1]?"#081014":"#667176";
    c.font="800 11px Manrope, sans-serif";c.textAlign="center";c.fillText(lamp[0],x,y+4);
  });
  c.fillStyle="#8fa3ad";c.font="700 13px Manrope, sans-serif";c.textAlign="center";
  c.fillText("ODO  "+((state.distance||0)/1000).toFixed(1)+" km    TRIP  "+((state.totalDistance||0)/1000).toFixed(2)+" km",512,508);
  c.textAlign="left";
}

function createPlayerDashboard(){
  if(!cockpitGaugeContext)buildCockpit();
  drawCockpitCenterDisplay();
  drawCockpitDashboard(0,850,"N",true);
}

function drawCockpitDashboard(speed,rpm,gear,force=false){
  if(!cockpitGaugeContext||!cockpitGaugeTexture)return;
  const now=performance.now();
  if(!force&&now-cockpitGaugeLast<80)return;
  cockpitGaugeLast=now;
  const c=cockpitGaugeContext;
  const bg=c.createLinearGradient(0,0,0,512);
  bg.addColorStop(0,"#141c22");bg.addColorStop(1,"#05080b");
  c.fillStyle=bg;c.fillRect(0,0,1024,512);
  c.fillStyle="rgba(255,255,255,.03)";
  for(let i=0;i<80;i++) c.fillRect(Math.random()*1024,Math.random()*512,2,2);
  if(carSpec().digitalDash){
    drawDigitalCluster(c,speed,rpm,gear);
    cockpitGaugeTexture.needsUpdate=true;
    if(state.camera===1) drawCockpitCenterDisplay();
    return;
  }
  drawAnalogGauge(c,250,236,148,Math.min(260,speed),260,{step:10,major:20,label:"SPEED",unit:"KM/H"});
  drawAnalogGauge(c,774,236,148,Math.min(8000,rpm),8000,{step:500,major:1000,label:"RPM",unit:"x1000",asK:true,redline:6500});
  c.fillStyle="#0b1116";c.beginPath();c.roundRect?(c.roundRect(454,168,116,128,16),c.fill()):(c.fillRect(454,168,116,128));
  c.fillStyle="#8fa3ad";c.font="800 14px Manrope, sans-serif";c.textAlign="center";c.fillText("GEAR",512,196);
  c.fillStyle="#f5c58a";c.font="900 64px Manrope, sans-serif";c.fillText(String(gear),512,258);
  c.fillStyle="#6fd9d6";c.font="800 13px Manrope, sans-serif";c.fillText("AUTO",512,286);
  const fuel=clamp(1-(state.totalDistance||0)/180000,.14,1);
  const temp=clamp(.32+Math.abs(rpm)/9000*.5,.3,.95);
  const drawBar=(x,y,label,ratio,ok)=>{
    c.fillStyle="#8fa3ad";c.font="700 12px Manrope, sans-serif";c.textAlign="left";c.fillText(label,x,y);
    c.fillStyle="rgba(255,255,255,.1)";c.fillRect(x+52,y-10,140,8);
    c.fillStyle=ok?"#6fd9d6":"#fb6b55";c.fillRect(x+52,y-10,140*ratio,8);
  };
  const lamps=[
    ["L", Math.abs(state.steer)>.55 && (clock.now%0.7)<0.35 && state.steer<0, "#59e08a"],
    ["R", Math.abs(state.steer)>.55 && (clock.now%0.7)<0.35 && state.steer>0, "#59e08a"],
    ["☀", state.time==="night", "#f0d08a"],
    ["P", !!(controls.handbrake||hardware.handbrake), "#fb6b55"],
    ["!", state.damage>45, "#fb6b55"]
  ];
  lamps.forEach((lamp,i)=>{
    const x=390+i*52,y=392;
    c.fillStyle=lamp[1]?lamp[2]:"#2a3338";
    c.beginPath();c.arc(x,y,12,0,Math.PI*2);c.fill();
    c.fillStyle=lamp[1]?"#081014":"#596268";
    c.font="800 11px Manrope, sans-serif";c.textAlign="center";c.fillText(lamp[0],x,y+4);
  });
  drawBar(40,430,"FUEL",fuel,fuel>.2);
  drawBar(792,430,"TEMP",temp,temp<.82);
  c.fillStyle="#8fa3ad";c.font="700 13px Manrope, sans-serif";c.textAlign="center";
  c.fillText("ODO  "+((state.distance||0)/1000).toFixed(1)+" km    TRIP  "+((state.totalDistance||0)/1000).toFixed(2)+" km",512,462);
  c.textAlign="left";
  cockpitGaugeTexture.needsUpdate=true;
  if(state.camera===1) drawCockpitCenterDisplay();
}

function renderRearMirror(){
  if(state.camera!==1||!mirrorRT||!mirrorCam||!renderer||!player) return;
  if(state.qualityLevel==="low") return;
  const prevCockpit=cockpitGroup.visible;
  const prevModel=player.userData.loadedModel?player.userData.loadedModel.visible:null;
  const prevFallback=playerFallback?playerFallback.visible:null;
  if(cockpitGroup) cockpitGroup.visible=false;
  if(player.userData.loadedModel) player.userData.loadedModel.visible=false;
  if(playerFallback) playerFallback.visible=false;
  mirrorCam.position.copy(player.localToWorld(new THREE.Vector3(0,1.36,.2)));
  mirrorCam.lookAt(player.localToWorld(new THREE.Vector3(0,1.15,28)));
  const prevTarget=renderer.getRenderTarget();
  renderer.setRenderTarget(mirrorRT);
  renderer.render(scene,mirrorCam);
  renderer.setRenderTarget(prevTarget);
  if(cockpitGroup) cockpitGroup.visible=prevCockpit;
  if(player.userData.loadedModel&&prevModel!=null) player.userData.loadedModel.visible=prevModel;
  if(playerFallback&&prevFallback!=null) playerFallback.visible=prevFallback;
}


function carSpec(){ return CAR_OPTIONS[state.car] || CAR_OPTIONS.spectral; }

function initEffects() {
  effects.smokeTex = softParticleTexture("190,190,190");
  effects.sparkTex = softParticleTexture("255,180,80");
  effects.dustTex = softParticleTexture("176,142,96");
  const skidGeo = new THREE.PlaneGeometry(0.28, 1.35);
  const skidMat = new THREE.MeshBasicMaterial({color:0x141414,transparent:true,opacity:.55,depthWrite:false});
  effects.skidMesh = new THREE.InstancedMesh(skidGeo, skidMat, 220);
  effects.skidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  effects.skidMesh.count = 0;
  scene.add(effects.skidMesh);
  effects.skids = [];
  effects.skidIndex = 0;
}

function spawnBillboard(list, texture, pos, life, scale, color) {
  if (list.length > 80) {
    const old = list.shift();
    scene.remove(old.mesh);
    old.mesh.material.dispose();
  }
  const mat = new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false,color:color||0xffffff});
  const mesh = new THREE.Sprite(mat);
  mesh.position.copy(pos);
  mesh.scale.setScalar(scale);
  scene.add(mesh);
  list.push({mesh, life, maxLife:life, vel:new THREE.Vector3((Math.random()-.5)*.8, .6+Math.random()*.8, (Math.random()-.5)*.8)});
}

function spawnSmoke(pos, amount=1) {
  for (let i=0;i<amount;i++) spawnBillboard(effects.smoke, effects.smokeTex, pos.clone().add(new THREE.Vector3((Math.random()-.5)*.4,.2,(Math.random()-.5)*.4)), .7+Math.random()*.5, .6+Math.random()*.5);
}
function spawnSparks(pos, amount=8) {
  for (let i=0;i<amount;i++) {
    spawnBillboard(effects.sparks, effects.sparkTex, pos.clone(), .25+Math.random()*.25, .18+Math.random()*.16, 0xffcc66);
    const p = effects.sparks[effects.sparks.length-1];
    if (p) p.vel.set((Math.random()-.5)*6, 1+Math.random()*4, (Math.random()-.5)*6);
  }
}
function spawnDust(pos) {
  spawnBillboard(effects.dust, effects.dustTex, pos.clone().setY(.15), .45, .8+Math.random()*.4, 0xc4a574);
}

function dropSkid() {
  if (!effects.skidMesh || !player || Math.abs(state.speed) < 4) return;
  if (Math.abs(state.lateral) > 9.4) return;
  const dummy = new THREE.Object3D();
  const tan = curve.getTangentAt(((state.progress%1)+1)%1);
  dummy.position.copy(player.position);
  dummy.position.y = 0.07;
  dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), new THREE.Vector3(0,1,0));
  dummy.lookAt(dummy.position.clone().add(tan));
  dummy.updateMatrix();
  const idx = effects.skidIndex % 220;
  effects.skidMesh.setMatrixAt(idx, dummy.matrix);
  effects.skidIndex++;
  effects.skidMesh.count = Math.min(220, effects.skidIndex);
  effects.skidMesh.instanceMatrix.needsUpdate = true;
}

function updateEffects(dt) {
  const step = (list) => {
    for (let i=list.length-1;i>=0;i--) {
      const p = list[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.y += dt * 0.4;
      const k = Math.max(0, p.life / p.maxLife);
      p.mesh.material.opacity = k * 0.7;
      p.mesh.scale.multiplyScalar(1+dt*1.4);
      if (p.life <= 0) {
        scene.remove(p.mesh);
        p.mesh.material.dispose();
        list.splice(i,1);
      }
    }
  };
  step(effects.smoke); step(effects.sparks); step(effects.dust);
}

function unlockAudio() {
  try {
    if (!state.soundOn) return;
    if (!audioContext) initAudio();
    if (audioContext && audioContext.state === "suspended") audioContext.resume();
  } catch (e) { console.warn("Audio unlock failed", e); }
}

function makeNoiseBuffer(ctx) {
  const length = ctx.sampleRate * 1.2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i=0;i<length;i++) data[i] = Math.random()*2-1;
  return buffer;
}

function initAudio() {
  if(!state.soundOn || audioContext) return;
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.7;
    masterGain.connect(audioContext.destination);

    engineOsc = audioContext.createOscillator(); engineOsc.type = "sawtooth"; engineOsc.frequency.value = 42;
    engineOsc2 = audioContext.createOscillator(); engineOsc2.type = "square"; engineOsc2.frequency.value = 84;
    engineFilter = audioContext.createBiquadFilter(); engineFilter.type = "lowpass"; engineFilter.frequency.value = 280;
    engineGain = audioContext.createGain(); engineGain.gain.value = 0.0001;
    engineOsc.connect(engineFilter); engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain); engineGain.connect(masterGain);
    engineOsc.start(); engineOsc2.start();

    const noise = audioContext.createBufferSource();
    noise.buffer = makeNoiseBuffer(audioContext);
    noise.loop = true;
    const windFilter = audioContext.createBiquadFilter(); windFilter.type = "bandpass"; windFilter.frequency.value = 800; windFilter.Q.value = 0.7;
    windGain = audioContext.createGain(); windGain.gain.value = 0.0001;
    const squealFilter = audioContext.createBiquadFilter(); squealFilter.type = "bandpass"; squealFilter.frequency.value = 1800; squealFilter.Q.value = 4;
    squealGain = audioContext.createGain(); squealGain.gain.value = 0.0001;
    const split = audioContext.createGain(); split.gain.value = 1;
    noise.connect(split);
    split.connect(windFilter); windFilter.connect(windGain); windGain.connect(masterGain);
    split.connect(squealFilter); squealFilter.connect(squealGain); squealGain.connect(masterGain);
    noise.start();
    noiseSource = noise;
  } catch (e) { console.warn("Audio unavailable", e); }
}

function playImpactSound(intensity) {
  if (!audioContext || !state.soundOn) return;
  try {
    const t = audioContext.currentTime;
    const o = audioContext.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(90+intensity*8, t);
    o.frequency.exponentialRampToValueAtTime(35, t+0.18);
    const g = audioContext.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(clamp(0.04+intensity*0.012, 0.04, 0.28), t+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.22);
    o.connect(g); g.connect(masterGain || audioContext.destination);
    o.start(t); o.stop(t+0.25);
  } catch (e) { /* ignore */ }
}

function honk(fromTraffic=false) {
  unlockAudio();
  if (!audioContext || !state.soundOn) return;
  try {
    const t = audioContext.currentTime;
    const o1 = audioContext.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = fromTraffic ? 330 : 392;
    const o2 = audioContext.createOscillator(); o2.type = "sawtooth"; o2.frequency.value = fromTraffic ? 277 : 311;
    const f = audioContext.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 430; f.Q.value = 2.2;
    const g = audioContext.createGain();
    const vol = fromTraffic ? 0.06 : 0.16;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t+0.03);
    g.gain.exponentialRampToValueAtTime(vol*0.7, t+0.28);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.55);
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(masterGain || audioContext.destination);
    o1.start(t); o2.start(t); o1.stop(t+0.58); o2.stop(t+0.58);
  } catch (e) { console.warn("Horn failed", e); }
  if (!fromTraffic) {
    state.hornTimer = 0.45;
    reactTrafficToHorn();
  }
}

function reactTrafficToHorn() {
  traffic.forEach(car => {
    const along = trackDeltaMeters(car.progress, state.progress);
    if (along > 2 && along < 30 && Math.abs(car.offset - state.lateral) < 6.5) {
      car.flee = Math.sign(car.offset - state.lateral) || (car.offset >= 0 ? 1 : -1);
      if (car.flee === 0) car.flee = 1;
      if (Math.random() < 0.35 && car.honkBack <= 0) car.honkBack = 0.25 + Math.random()*0.3;
    }
  });
}

function updateAudio() {
  if(!audioContext||!engineOsc||!engineGain) return;
  const now = audioContext.currentTime;
  const moving = state.running && !state.paused;
  const rpm = state.rpm || 850;
  engineOsc.frequency.setTargetAtTime(40 + rpm * 0.012, now, .06);
  if (engineOsc2) engineOsc2.frequency.setTargetAtTime(80 + rpm * 0.006, now, .06);
  if (engineFilter) engineFilter.frequency.setTargetAtTime(220 + Math.min(1800, Math.abs(state.speed)*28), now, .1);
  engineGain.gain.setTargetAtTime(moving ? 0.028 + Math.min(0.04, Math.abs(state.speed)*0.0007) : 0.0001, now, .1);
  if (windGain) windGain.gain.setTargetAtTime(moving ? Math.min(0.045, Math.abs(state.speed)*0.0007) : 0.0001, now, .15);
  if (squealGain) squealGain.gain.setTargetAtTime(moving && state.skid > 0.35 ? Math.min(0.05, state.skid*0.04) : 0.0001, now, .08);
}

function cameraLabel(){return ["Погоня","Кабина","Капот","Сверху"][state.camera]||"Погоня";}
function updateCameraButton(){
  const label=cameraLabel(),button=$("cameraBtn");
  if(!button) return;
  const bl=button.querySelector(".btn-label");
  if(bl) bl.textContent=label;
  button.setAttribute("aria-label","Камера: "+label);
  button.title="Камера: "+label+" · нажми для переключения вида";
}
function setCameraMode(){
  state.camera=state.camera===1?0:1;
  updateCameraButton();
  syncViewClasses();
  setMessage(state.camera===1?"Вид водителя · настоящий салон и приборная панель":"Вид снаружи · камера преследования");
}
function cycleCameraMode(){
  state.camera=(state.camera+1)%4;
  updateCameraButton();
  syncViewClasses();
  setMessage("Камера: "+cameraLabel());
}

function addPlayerHeadlights(){
  const lights=[];
  if (state.qualityLevel !== "low") {
    for(const x of [-.72,.72]){
      const light=new THREE.SpotLight(0xffe8cb,76,88,Math.PI/7,.52,1.45);
      light.position.set(x,.95,-2.12);
      const target=new THREE.Object3D();
      target.position.set(x,-.18,-55);
      light.target=target;light.visible=state.time==="night";light.castShadow=false;
      player.add(light);player.add(target);lights.push(light);
    }
  }
  player.userData.headlights=lights;
}

function trackDeltaMeters(a, b) {
  let d = ((a - b + 1) % 1);
  if (d > 0.5) d -= 1;
  return d * trackLength;
}

function applyDamage(amount, worldPos) {
  const add = Math.max(0, amount);
  if (add < 0.8) return;
  state.damage = clamp(state.damage + add, 0, 100);
  state.shake = Math.min(2.8, state.shake + Math.min(1.6, add * 0.08));
  state.collisionCount += 1;
  state.combo = 1;
  state.comboTimer = 0;
  if (worldPos) spawnSparks(worldPos, Math.min(14, 5 + Math.round(add/3)));
  playImpactSound(add);
  updateHudMeta();
  const crack = $("crackOverlay");
  if (crack) crack.style.opacity = String(clamp(state.damage / 140, 0, 0.72));
}

function awardScore(points, reason) {
  const gained = Math.round(points * state.combo);
  state.score += gained;
  if (reason) setMessage(reason+" · +"+gained, 1.8);
  updateHudMeta();
  try {
    const best = Number(localStorage.getItem("driveHorizonBestScore") || 0);
    if (state.score > best) localStorage.setItem("driveHorizonBestScore", String(state.score));
  } catch (e) { /* ignore */ }
}

function registerNearMiss() {
  if (state.nearMissCool > 0) return;
  state.nearMissCool = 0.7;
  state.combo = Math.min(8, state.combo + 1);
  state.comboTimer = 3.2;
  awardScore(40 * state.combo, "Близкий разъезд! Комбо x"+state.combo);
}

function updateHudMeta() {
  const scoreEl = $("score"); if (scoreEl) scoreEl.textContent = String(Math.round(state.score));
  const comboEl = $("combo"); if (comboEl) comboEl.textContent = "x"+state.combo;
  const dmgEl = $("damageLabel"); if (dmgEl) dmgEl.textContent = Math.round(state.damage)+"%";
  const cond = document.querySelector(".condition");
  if (cond) {
    const label = state.damage<20?"Отличное":state.damage<45?"Царапины":state.damage<75?"Повреждён":"Аварийное";
    cond.lastChild ? cond.innerHTML = '<span class="condition-dot"></span> '+label : (cond.textContent = label);
    cond.style.color = state.damage<20?"#7ee0c2":state.damage<45?"#e2c17b":state.damage<75?"#f0a06a":"#fb7c61";
  }
  const recMeters = Number(localStorage.getItem("driveHorizonRecord")||0);
  const pd=$("pauseDistance"); if(pd) pd.textContent=((state.distance||0)/1000).toFixed(2)+" км";
  const pr=$("pauseRecord"); if(pr) pr.textContent=(recMeters/1000).toFixed(2)+" км";
}

function updateBrakeLights() {
  const braking = (controls.brake || hardware.brake > .08 || controls.handbrake || hardware.handbrake);
  const intensity = braking ? 3.8 : (state.time==="night" ? 1.15 : 0.35);
  const apply = (root) => {
    const mats = root?.userData?.tailMats;
    if (mats) mats.forEach(m => { m.emissiveIntensity = intensity; });
  };
  apply(playerFallback);
  traffic.forEach(car => apply(car.visual));
}

function collideWorld(dt) {
  const rail = 10.55;
  if (Math.abs(state.lateral) > rail) {
    const over = Math.abs(state.lateral) - rail;
    state.lateral = Math.sign(state.lateral) * rail;
    const impact = Math.abs(state.speed) * Math.min(1.4, 0.35 + over);
    if (impact > 1.2 && state.hitCooldown <= 0) {
      const smash = impact > 4;
      state.speed *= smash ? 0.38 : 0.72;
      applyDamage((smash?6:2) + impact * 0.9, player.position.clone().add(new THREE.Vector3(0,0.6,0)));
      setMessage(smash ? "Отбойник!" : "Скрежет по ограждению", 1.6);
      state.hitCooldown = smash ? 0.35 : 0.2;
    } else {
      state.speed *= 0.9;
    }
  }

  const halfLen = 2.15, halfW = 1.85;
  traffic.forEach(car => {
    if(car.ghost) return;
    const along = trackDeltaMeters(state.progress, car.progress);
    const across = state.lateral - car.offset;
    if (Math.abs(along) < halfLen && Math.abs(across) < halfW) {
      if (Math.abs(along)/halfLen >= Math.abs(across)/halfW) {
        const push = (halfLen - Math.abs(along) + 0.05) / trackLength * Math.sign(along || 1);
        state.progress = (state.progress - push + 1) % 1;
        const closing = Math.abs(state.speed - car.speed);
        if (state.hitCooldown <= 0) {
          state.speed = state.speed * 0.42 + car.speed * 0.15;
          car.speed = Math.max(8, car.speed * 0.55 + Math.abs(state.speed) * 0.2);
          applyDamage(8 + closing * 0.7, car.visual.position.clone().add(new THREE.Vector3(0,0.7,0)));
          setMessage("Контакт с трафиком!", 2);
          state.hitCooldown = 0.4;
        }
      } else {
        state.lateral += Math.sign(across || 1) * (halfW - Math.abs(across) + 0.05);
        car.offset -= Math.sign(across || 1) * 0.35;
        if (state.hitCooldown <= 0) {
          state.speed *= 0.7;
          applyDamage(5 + Math.abs(state.speed)*0.25, car.visual.position.clone());
          state.hitCooldown = 0.3;
          setMessage("Боковое касание", 1.5);
        }
      }
      car.hitTimer = 0.8;
    } else if (state.nearMissCool <= 0 && Math.abs(along) < 5.5 && Math.abs(across) > 2.05 && Math.abs(across) < 3.7 && Math.abs(state.speed) > 14) {
      registerNearMiss();
    }
  });

  if (player && treeColliders.length) {
    const px = player.position.x, pz = player.position.z;
    for (let i=0;i<treeColliders.length;i++) {
      const t = treeColliders[i];
      const dx = px - t.x, dz = pz - t.z;
      const min = t.r + 1.05;
      const d2 = dx*dx + dz*dz;
      if (d2 < min*min) {
        if (state.hitCooldown <= 0) {
          state.speed *= 0.28;
          applyDamage(12 + Math.abs(state.speed)*0.4, new THREE.Vector3(t.x, 1, t.z));
          setMessage("Дерево!", 1.6);
          state.hitCooldown = 0.45;
        }
        state.lateral += (state.lateral>=0?1:-1)*0.35;
        break;
      }
    }
  }
}

function updateDrivetrain(dt) {
  const spec = carSpec();
  const throttle=Math.max(controls.gas?1:0,hardware.throttle);
  const brake=Math.max(controls.brake?1:0,hardware.brake);
  state.steerInput=clamp((controls.right?1:0)-(controls.left?1:0)+hardware.steer+state.tiltSteer,-1,1);
  state.steer=lerp(state.steer,state.steerInput,Math.min(1,dt*5.2));
  const hand=(controls.handbrake||hardware.handbrake)?1:0;
  const gasPower=throttle>.025?throttle:0, brakePower=brake>.025?brake:0;
  const top = spec.top * (state.damage > 80 ? 0.62 : state.damage > 55 ? 0.8 : 1);
  const accel = (spec.accel || 20) * (1 - state.damage*0.003);
  if(gasPower>brakePower){
    if(spec.drag!=null){
      const v=Math.max(0,state.speed);
      const fall=spec.powerFalloff||1.6;
      const pull=accel*(gasPower-brakePower)*Math.max(.12,1-Math.pow(Math.min(1,v/Math.max(1,top)),fall));
      const aero=spec.drag*v*v+.35;
      state.speed=Math.min(top,state.speed+(pull-aero)*dt);
    }else{
      state.speed=Math.min(top,state.speed+(accel+state.speed*.08)*dt*(gasPower-brakePower));
    }
  }
  else if(brakePower>gasPower) state.speed=Math.max(-7,state.speed-31*dt*(brakePower-gasPower));
  else if(state.speed>0) state.speed=Math.max(0,state.speed-.62*dt);
  else if(state.speed<0) state.speed=Math.min(0,state.speed+.8*dt);
  if(hand) state.speed = state.speed>0 ? Math.max(0,state.speed-11*dt) : Math.min(0,state.speed+11*dt);

  const steeringPower=spec.drag!=null
    ? (.92/(1+Math.abs(state.speed)*.042))/(spec.grip||1)
    : (.85+Math.abs(state.speed)*.075) / (spec.grip||1);
  state.lateral+=state.steer*steeringPower*dt*(hand?1.55:1);
  state.lateral=clamp(state.lateral,-11.6,11.6);
  state.offroad = Math.abs(state.lateral)>9.25;
  if(state.offroad){
    state.speed=Math.max(state.speed>0?0:state.speed, state.speed-(4.5+Math.abs(state.speed)*.11)*dt);
    if(Math.abs(state.lateral)>10.8&&state.messageTimer<=0) setMessage("Осторожнее: съезд с асфальта!",2);
    if (Math.abs(state.speed)>5 && Math.random()<0.4) spawnDust(player.position);
  }
  const slip = Math.abs(state.steer)*Math.abs(state.speed)*(hand?1.8:0.45) + ((brakePower>0.4 && Math.abs(state.speed)>12)?10:0);
  state.skid = clamp(slip/28, 0, 1);
  if (state.skid > 0.42 && !state.offroad) {
    dropSkid();
    if (Math.random() < state.skid) spawnSmoke(player.position.clone().add(new THREE.Vector3((Math.random()-.5)*1.2,0.15,1.1)), 1);
  }
  if(hand&&Math.abs(state.steer)>.2&&state.speed>10&&state.messageTimer<=0) setMessage("Красивый занос!",1.5);

  const maxStep=spec.drag!=null?.5:1.15;
  const steps = Math.max(1, Math.ceil(Math.abs(state.speed)*dt/maxStep));
  const sdt = dt/steps;
  for (let i=0;i<steps;i++) {
    state.progress=(state.progress+(state.speed*sdt/trackLength)+1)%1;
    collideWorld(sdt);
  }
  state.distance+=Math.abs(state.speed)*dt;
  state.totalDistance+=Math.abs(state.speed)*dt;

  const gearCount=spec.gears||6;
  const redline=spec.redline||7500;
  if (state.speed < -0.5) { state.gear = "R"; state.gearIndex = 0; }
  else if (Math.abs(state.speed) < 1) { state.gear = "N"; state.gearIndex = 0; }
  else if (spec.shiftAt) {
    const abs=Math.abs(state.speed);
    let idx=1;
    spec.shiftAt.forEach((t,i)=>{ if(abs>=t) idx=i+2; });
    idx=clamp(idx,1,gearCount);
    if (idx !== state.gearIndex && abs > 1) state.rpm *= 0.62;
    state.gearIndex = idx;
    state.gear = String(idx);
  } else {
    const idx = clamp(Math.floor(Math.abs(state.speed)/10)+1, 1, gearCount);
    if (idx !== state.gearIndex && Math.abs(state.speed) > 1) {
      state.rpm *= 0.62;
    }
    state.gearIndex = idx;
    state.gear = String(idx);
  }
  let targetRpm;
  if(spec.shiftAt && state.gearIndex>=1 && state.gear!=="N" && state.gear!=="R"){
    const abs=Math.abs(state.speed);
    const lo=state.gearIndex<=1?0:spec.shiftAt[state.gearIndex-2];
    const hi=state.gearIndex-1<spec.shiftAt.length?spec.shiftAt[state.gearIndex-1]:(spec.top||abs+1);
    const frac=clamp((abs-lo)/Math.max(.5,hi-lo),0,1);
    targetRpm=900+frac*(redline-1400)+(gasPower*380);
  }else{
    targetRpm = 850 + Math.abs(state.speed)*112 + (gasPower*400);
  }
  state.rpm = lerp(state.rpm || 850, clamp(targetRpm, 800, redline), Math.min(1, dt*4));
}

function updateCheckpoints(dt) {
  state.sectorTime += dt;
  const prev = state._lastProgress ?? state.progress;
  const curr = state.progress;
  const cp = state.checkpoint / CHECKPOINTS;
  const moved = ((curr - prev + 1) % 1);
  const toCp = ((cp - prev + 1) % 1);
  const crossed = moved > 0 && moved < 0.45 && toCp > 0 && toCp <= moved && state.distance > 20;
  state._lastProgress = curr;
  if (crossed && state.sectorTime > 0.35) {
    const bonus = Math.max(0, Math.round(50 - state.sectorTime * 3.2));
    awardScore(30 + bonus, "Чекпоинт "+((state.checkpoint%CHECKPOINTS)+1)+"/"+CHECKPOINTS);
    state.checkpoint = (state.checkpoint + 1) % CHECKPOINTS;
    state.sectorTime = 0;
  }
}

function updateTraffic(dt) {
  traffic.forEach(car=>{
    if (car.hitTimer > 0) car.hitTimer -= dt;
    if (car.honkBack > 0) {
      car.honkBack -= dt;
      if (car.honkBack <= 0) honk(true);
    }
    if (car.flee) {
      car.offset = clamp(car.offset + car.flee * 4.2 * dt, -7.2, 7.2);
      car.speed = Math.min(car.speed + 3*dt, 40);
      if (Math.abs(car.offset - car.baseOffset) > 2.2) car.flee = 0;
    } else {
      car.offset = lerp(car.offset, car.baseOffset, Math.min(1, dt*0.15));
    }
    car.progress=(car.progress+(car.speed*dt/trackLength)+1)%1;
  });
}

function dampSpringVec(current,target,velocity,smoothTime,dt){
  const st=Math.max(1e-4,smoothTime);
  const omega=2/st;
  const x=omega*dt;
  const exp=1/(1+x+0.48*x*x+0.235*x*x*x);
  const cx=current.x-target.x, cy=current.y-target.y, cz=current.z-target.z;
  const tx=(velocity.x+cx*omega)*dt;
  const ty=(velocity.y+cy*omega)*dt;
  const tz=(velocity.z+cz*omega)*dt;
  velocity.x=(velocity.x-omega*tx)*exp;
  velocity.y=(velocity.y-omega*ty)*exp;
  velocity.z=(velocity.z-omega*tz)*exp;
  current.x=target.x+(cx+tx)*exp;
  current.y=target.y+(cy+ty)*exp;
  current.z=target.z+(cz+tz)*exp;
}

function placeVehicles(dt) {
  const p=curve.getPointAt(((state.progress%1)+1)%1),tan=curve.getTangentAt(((state.progress%1)+1)%1),right=vecRight(tan);
  const yaw=Math.atan2(-tan.x,-tan.z);
  player.position.copy(p).addScaledVector(right,state.lateral);
  player.position.y+=.13; // Stable chassis: no artificial vertical bob that shakes the driver's camera.
  player.rotation.y=yaw+state.steer*.055;
  player.rotation.z=lerp(player.rotation.z,-state.steer*.065,Math.min(1,dt*5));
  if(playerFallback?.userData.wheels)playerFallback.userData.wheels.forEach((wheel,i)=>{
    wheel.rotation.x-=state.speed*dt*1.7;
    if(i<2)wheel.rotation.y=state.steer*.12;
  });
  traffic.forEach(car=>{
    const cp=curve.getPointAt(car.progress),ct=curve.getTangentAt(car.progress),cr=vecRight(ct);
    car.visual.position.copy(cp).addScaledVector(cr,car.offset);
    car.visual.position.y+=.13;
    car.visual.rotation.y=Math.atan2(-ct.x,-ct.z);
    car.visual.rotation.z=Math.sin(clock.now*.6+car.wiggle)*.008;
  });
  const chasePos=player.position.clone().addScaledVector(tan,-11.5).add(new THREE.Vector3(0,5.1,0)).addScaledVector(right,state.steer*.65);
  const eyeX=state.driverSide*.49;
  const portrait=isPortraitView();
  const eyeY=portrait?1.40:1.30;
  const eyeZ=portrait?-.08:-.05;
  const cockpitPos=player.localToWorld(new THREE.Vector3(eyeX,eyeY,eyeZ));
  const hoodPos=player.localToWorld(new THREE.Vector3(0,1.42,-2.72));
  const topPos=player.position.clone().add(new THREE.Vector3(0,21,0)).addScaledVector(tan,-1.2);
  const desired=state.camera===0?chasePos:state.camera===1?cockpitPos:state.camera===2?hoodPos:topPos;
  if(state.camera===1){camera.position.copy(desired);chaseCamReady=false;auxCamMode=-1;}
  else if(state.camera===0){
    // Speed-independent chase: spring the offset relative to the car, never the world position.
    chaseDesiredOffset.copy(chasePos).sub(player.position);
    const baseDist=chaseDesiredOffset.length()||12.58;
    if(!chaseCamReady){
      chaseCamOffset.copy(chaseDesiredOffset);
      chaseCamVel.set(0,0,0);
      chaseCamReady=true;
    }else{
      dampSpringVec(chaseCamOffset,chaseDesiredOffset,chaseCamVel,.14,dt);
    }
    const maxDist=baseDist*1.3;
    const chaseDist=chaseCamOffset.length();
    if(chaseDist>maxDist&&chaseDist>1e-4) chaseCamOffset.multiplyScalar(maxDist/chaseDist);
    camera.position.copy(player.position).add(chaseCamOffset);
    auxCamMode=-1;
  }else{
    chaseCamReady=false;
    chaseDesiredOffset.copy(desired).sub(player.position);
    if(auxCamMode!==state.camera){
      auxCamOffset.copy(chaseDesiredOffset);
      auxCamMode=state.camera;
    }else{
      auxCamOffset.lerp(chaseDesiredOffset,Math.min(1,dt*(state.camera===3?2.4:9)));
    }
    camera.position.copy(player.position).add(auxCamOffset);
  }
  const shakeMul=state.camera===1?0.35:1;
  if (state.shake > 0) {
    camera.position.x += (Math.random()-.5) * state.shake * 0.16 * shakeMul;
    camera.position.y += (Math.random()-.5) * state.shake * 0.1 * shakeMul;
    state.shake = Math.max(0, state.shake - dt * 3.6);
  }
  const speedShake = Math.min(0.05, Math.abs(state.speed) * 0.00035) * shakeMul;
  camera.position.x += (Math.random()-.5) * speedShake;
  camera.position.y += (Math.random()-.5) * speedShake;
  if(player.userData.steeringWheel&&player.userData.steeringWheelBase){
    const base=player.userData.steeringWheelBase;
    player.userData.steeringWheel.rotation.set(base.x,base.y,base.z-state.steer*.55);
  }
  if(player.userData.rollingWheels){
    const radius=player.userData.wheelRadius||.36;
    const spin=-state.speed*dt/radius;
    const axis=player.userData.wheelSpinAxis||"x";
    player.userData.rollingWheels.forEach(w=>axis==="z"?w.rotateZ(spin):w.rotateX(spin));
  }
  if(cockpitGroup)cockpitGroup.visible=state.camera===1;
  if(player.userData.loadedModel)player.userData.loadedModel.visible=state.camera!==1;
  if(player.userData.bodyShell)player.userData.bodyShell.visible=state.camera!==1;
  if(playerFallback)playerFallback.visible=state.camera!==1;
  if(steeringWheelVisual)steeringWheelVisual.rotation.z=-state.steer*.62;
  const lookY=state.camera===1?(portrait?eyeY-5.9:eyeY-1.1):1.58;
  const look=state.camera===3?player.position.clone():state.camera===1?player.localToWorld(new THREE.Vector3(eyeX*.2,lookY,-42)):state.camera===2?player.localToWorld(new THREE.Vector3(0,1.2,-30)):player.position.clone().addScaledVector(tan,5).add(new THREE.Vector3(0,.8,0));
  camera.lookAt(look);
  syncViewClasses();
  const baseFov=state.camera===1?(portrait?80:isMobile?70:66):(isMobile?69:62);
  // Convey speed with a slight FOV kick, not by pulling the chase camera farther back.
  const rawKick=state.camera===1?Math.abs(state.speed)*0.08:Math.abs(state.speed)*0.18;
  const kickCap=Math.abs(state.speed)>70?(state.camera===1?5:10):(state.camera===1?6:14);
  const speedKick=Math.min(kickCap, rawKick);
  const targetFov=baseFov+speedKick+state.fovKick;
  if(Math.abs(camera.fov-targetFov)>.1){camera.fov=lerp(camera.fov,targetFov,Math.min(1,dt*4));camera.updateProjectionMatrix();}
  state.fovKick = Math.max(0, state.fovKick - dt*8);
}

function updateGame(dt) {
  pollHardware();
  inputTelemetryTimer+=dt;
  if(inputTelemetryTimer>.12){
    inputTelemetryTimer=0;
    const pad=getPads().find(p=>p.index===state.gamepadIndex);
    const tel=$("inputTelemetry");
    if (tel) tel.textContent=pad?
      "Сигналы · руль "+hardware.steer.toFixed(2)+" · газ "+Math.round(hardware.throttle*100)+"% · тормоз "+Math.round(hardware.brake*100)+"% · ручник "+(hardware.handbrake?"ВКЛ":"выкл")+" · сигнал "+((hardware.horn||controls.horn)?"ВКЛ":"выкл"):
      "Сигналы появятся после подключения контроллера";
  }
  if(state.running&&!state.paused){
    if (state.hitCooldown > 0) state.hitCooldown -= dt;
    if (state.nearMissCool > 0) state.nearMissCool -= dt;
    if (state.comboTimer > 0) { state.comboTimer -= dt; if (state.comboTimer<=0) state.combo=1; }
    if ((controls.horn || hardware.horn) && state.hornTimer <= 0) honk(false);
    if (state.hornTimer > 0) state.hornTimer -= dt;
    updateDrivetrain(dt);
    if(debugSpeedLock!=null&&Number.isFinite(debugSpeedLock)) state.speed=debugSpeedLock;
    updateTraffic(dt);
    updateCheckpoints(dt);
    updateBrakeLights();
    updateEffects(dt);
    updateLampLights();
    if (state.damage > 50 && Math.random() < 0.15) {
      spawnSmoke(player.position.clone().add(new THREE.Vector3(0,0.9,-1.4)), 1);
    }
    updateSpeedLines();

    if(state.messageTimer>0)state.messageTimer-=dt;
    if(state.messageTimer<=0){
      const msg=$("message");
      if(msg){ msg.textContent=""; msg.classList.add("hidden"); }
    }
    if(state.distance>Number(localStorage.getItem("driveHorizonRecord")||0)){
      try { localStorage.setItem("driveHorizonRecord",String(state.distance)); } catch(e){ /* ignore */ }
      const rec=$("record"); if(rec) rec.innerHTML=(state.distance/1000).toFixed(2)+" <i>KM</i>";
    }
    const kmh=Math.round(Math.abs(state.speed)*3.6),rpmValue=Math.round(state.rpm);
    const gearValue=state.gear;
    const speedEl=$("speed"); if(speedEl) speedEl.textContent=String(kmh).padStart(3,"0");
    const rpmEl=$("rpm"); if(rpmEl) rpmEl.textContent=rpmValue+" RPM";
    const rpmBar=$("rpmBar"); if(rpmBar) rpmBar.style.width=clamp((rpmValue/7800)*100,0,100)+"%";
    const gearEl=$("gear"); if(gearEl) gearEl.textContent=gearValue;
    drawCockpitDashboard(kmh,rpmValue,gearValue);
    const distEl=$("distance"); if(distEl) distEl.innerHTML=(state.distance/1000).toFixed(2)+" <i>KM</i>";
    updateHudMeta();
    updateAudio();
  } else {
    updateAudio();
  }
  if (player && curve) placeVehicles(dt);
  drawMiniMap();
}

function updateSpeedLines(){
  const lines=$("speedLines");
  if(!lines) return;
  const kmh=Math.abs(state.speed)*3.6;
  const chaseOnly=state.camera===0;
  const show=!!(state.speedLinesOn && chaseOnly && kmh>=150);
  const opacity=show?clamp((kmh-150)/90,0,.16):0;
  lines.style.opacity=String(opacity);
  lines.classList.toggle("active", show);
}

function syncSpeedLineToggles(){
  ["speedLinesToggle","speedLinesTogglePause"].forEach(id=>{
    const el=$(id); if(el) el.checked=!!state.speedLinesOn;
  });
}

function setSpeedLinesOn(on, persist=true){
  state.speedLinesOn=!!on;
  if(persist){
    try { localStorage.setItem("driveHorizonSpeedLines", state.speedLinesOn?"on":"off"); } catch(e){ /* ignore */ }
  }
  syncSpeedLineToggles();
  updateSpeedLines();
}

function resize() {
  if(!renderer||!camera)return;
  const w=window.innerWidth,h=window.innerHeight;
  camera.aspect=w/h;camera.near=.06;camera.far=Math.max(2800, 1800+Math.abs(state.speed)*10);
  camera.updateProjectionMatrix();
  renderer.setSize(w,h,false);
  if(composer)composer.setSize(w,h);
  syncCockpitMirror();
}
function toast(text) {
  const el=$("toast"); if(!el) return;
  el.textContent=text;el.classList.add("show");
  clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),1700);
}
function showPause(value) {
  if(!state.running)return;
  state.paused=value;
  $("pausePanel").classList.toggle("hidden",!value);
  if(value){Object.keys(controls).forEach(k=>controls[k]=false);const m=$("message"); if(m) m.textContent="На паузе";}
  else setMessage("Снова на дороге. Удачной поездки!");
}
function startGame() {
  if(!state.worldReady){ toast("Сцена ещё загружается…"); return; }
  if(state.running&&!state.paused)return;
  state.running=true;state.paused=false;
  $("startOverlay").classList.add("hidden");$("pausePanel").classList.add("hidden");$("hud").classList.add("visible");
  document.body.classList.add("playing");
  try { unlockAudio(); } catch(e){ console.warn(e); }
  lastFrame=performance.now();setMessage("Поехали! Сигнал — H, ручник — Shift.");
}
function restartGame() {
  state.progress=0;state.lateral=0;state.speed=0;state.distance=0;state.steer=0;
  state.damage=0;state.score=0;state.combo=1;state.checkpoint=0;state.sectorTime=0;
  state.collisionCount=0;state.shake=0;state.rpm=850;
  traffic.forEach((car,i)=>{ car.progress=(.06+i*(0.92/Math.max(1,traffic.length)))%1; car.offset=car.baseOffset; car.flee=0; });
  const crack=$("crackOverlay"); if(crack) crack.style.opacity="0";
  const dist=$("distance"); if(dist) dist.innerHTML="0.00 <i>KM</i>";
  updateHudMeta();
  showPause(false);
  if(!state.running){state.running=true;$("hud").classList.add("visible");$("startOverlay").classList.add("hidden");document.body.classList.add("playing");}
  state.paused=false;$("pausePanel").classList.add("hidden");setMessage("Новый заезд. Дорога свободна!");
}

function saveInputConfig() {
  try{localStorage.setItem("driveHorizonInput",JSON.stringify(inputConfig));}catch(e){console.warn("Input preferences unavailable",e);}
}
function loadInputConfig() {
  try{
    const saved=JSON.parse(localStorage.getItem("driveHorizonInput")||"{}");
    Object.assign(inputConfig,saved);
  }catch(e){console.warn("Invalid input preferences",e);}
  const assign = (id, value) => { const el=$(id); if(el) el.value=value; };
  assign("steerSource", inputConfig.steer); assign("gasSource", inputConfig.gas);
  assign("brakeSource", inputConfig.brake); assign("handbrakeSource", inputConfig.handbrake);
  const chk=(id,v)=>{ const el=$(id); if(el) el.checked=!!v; };
  chk("invertSteer",inputConfig.invertSteer);chk("invertGas",inputConfig.invertGas);chk("invertBrake",inputConfig.invertBrake);chk("pedalsPositive",inputConfig.pedalsPositive);
  const sens=$("steerSensitivity"); if(sens) sens.value=inputConfig.sensitivity;
  const sv=$("sensitivityValue"); if(sv) sv.textContent=Number(inputConfig.sensitivity).toFixed(1)+"×";
}
function getPads() {
  try{return Array.from(navigator.getGamepads?navigator.getGamepads():[]).filter(p=>p&&p.connected);}
  catch(e){return [];}
}
function refreshDevicePanel() {
  const pads=getPads(),select=$("deviceSelect"),previous=state.gamepadIndex;
  if(!select) return;
  select.innerHTML="";
  if(!pads.length){
    const option=document.createElement("option");option.value="";option.textContent="Устройство пока не обнаружено";select.appendChild(option);
    state.gamepadIndex=null;
    const st=$("deviceStatus"); if(st) st.textContent="Нет подключённого контроллера. Подключи USB/Bluetooth-устройство и нажми кнопку на нём.";
    const meta=$("deviceMeta"); if(meta) meta.textContent="Ожидание геймпада или руля…";
  }else{
    pads.forEach(p=>{
      const option=document.createElement("option");option.value=String(p.index);
      option.textContent=(p.id||"Контроллер")+" · "+p.axes.length+" осей / "+p.buttons.length+" кнопок";
      select.appendChild(option);
    });
    const chosen=pads.find(p=>p.index===previous)||pads[0];state.gamepadIndex=chosen.index;select.value=String(chosen.index);
    const st=$("deviceStatus"); if(st) st.textContent="Подключено: "+(chosen.id||"контроллер");
    const meta=$("deviceMeta"); if(meta) meta.textContent="Индекс "+chosen.index+" · "+(chosen.mapping==="standard"?"стандартная раскладка":"нестандартная раскладка")+
      " · "+chosen.axes.length+" осей · "+chosen.buttons.length+" кнопок";
    populateInputSources(chosen);
  }
  if(!pads.length)populateInputSources(null);
}
function populateInputSources(pad) {
  const axes=pad?pad.axes.length:8,buttons=pad?pad.buttons.length:32;
  const defs=[["steerSource","steer"],["gasSource","gas"],["brakeSource","brake"],["handbrakeSource","handbrake"]];
  defs.forEach(([id,key])=>{
    const el=$(id); if(!el) return;
    const old=inputConfig[key];el.innerHTML="";
    for(let i=0;i<axes;i++){const o=document.createElement("option");o.value="axis"+i;o.textContent="Ось "+i;el.appendChild(o);}
    for(let i=0;i<buttons;i++){const o=document.createElement("option");o.value="button"+i;o.textContent="Кнопка "+i;el.appendChild(o);}
    if(!el.querySelector('option[value="'+old+'"]')){
      const saved=document.createElement("option");saved.value=old;saved.textContent="Сохранённое назначение: "+old;el.appendChild(saved);
    }
    el.value=old;
  });
}
function readBinding(pad,binding,kind,invert=false) {
  if(!pad||!binding)return 0;
  let value=0;
  if(binding.startsWith("axis")){
    const axisIndex=Number(binding.slice(4));
    if(axisIndex<0||axisIndex>=pad.axes.length)return 0;
    const raw=pad.axes[axisIndex];
    if(kind==="steer"){
      const dead=.07;value=Math.abs(raw)<=dead?0:Math.sign(raw)*(Math.abs(raw)-dead)/(1-dead);
    }else value=clamp(inputConfig.pedalsPositive?raw:(raw+1)/2,0,1);
  }else if(binding.startsWith("button")){
    const buttonIndex=Number(binding.slice(6)),b=pad.buttons[buttonIndex];
    if(!b)return 0;
    value=Number(b.value??(b.pressed?1:0));
    if(kind==="steer")value=b.pressed?1:0;
  }
  if(invert)value=kind==="steer"?-value:1-value;
  if(kind==="steer")return clamp(value*Number(inputConfig.sensitivity||1),-1,1);
  return clamp(value,0,1);
}
function pollHardware() {
  const pads=getPads();
  let pad=pads.find(p=>p.index===state.gamepadIndex);
  if(!pad&&pads.length){pad=pads[0];state.gamepadIndex=pad.index;}
  if(!pad){hardware.steer=hardware.throttle=hardware.brake=0;hardware.handbrake=false;hardware.horn=false;return;}
  hardware.steer=readBinding(pad,inputConfig.steer,"steer",inputConfig.invertSteer);
  hardware.throttle=readBinding(pad,inputConfig.gas,"pedal",inputConfig.invertGas);
  hardware.brake=readBinding(pad,inputConfig.brake,"pedal",inputConfig.invertBrake);
  hardware.handbrake=readBinding(pad,inputConfig.handbrake,"pedal",false)>.55;
  const b2 = pad.buttons[2]?.pressed, b3 = pad.buttons[3]?.pressed, b5 = pad.buttons[5]?.pressed;
  hardware.horn = !!(b2 || b3 || b5);
}

function applyQuality(level, fromUser=false) {
  if (!QUALITY_PRESETS[level]) return;
  state.qualityLevel = level;
  state.quality = level !== "low";
  if (fromUser) {
    state.autoQuality = false;
    try { localStorage.setItem("driveHorizonQuality", level); } catch(e){ /* ignore */ }
  }
  const q = qcfg();
  if (renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, q.dprCap));
    renderer.shadowMap.enabled = q.shadows;
    if (directionalLight) directionalLight.castShadow = q.shadows;
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    if (composer) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(window.innerWidth, window.innerHeight);
    }
    if (bloomPass) bloomPass.strength = q.bloom;
  }
  if (player) buildCockpit();
  const qb = $("qualityBtn");
  if (qb) {
    const lab = qb.querySelector(".btn-label");
    if (lab) lab.textContent = "Графика: "+QUALITY_LABELS[level];
  }
}

function cycleQuality() {
  const order = ["high","medium","low"];
  const next = order[(order.indexOf(state.qualityLevel)+1)%order.length];
  applyQuality(next, true);
  toast("Графика: "+QUALITY_LABELS[next]);
}

function toggleHud(){
  document.body.classList.toggle("hud-hidden");
  toast(document.body.classList.contains("hud-hidden")?"HUD скрыт · U чтобы вернуть":"HUD включён");
}

function bindControls() {
  const keyMap={w:"gas",arrowup:"gas",s:"brake",arrowdown:"brake"," ":"brake",a:"left",arrowleft:"left",d:"right",arrowright:"right",shift:"handbrake"};
  window.addEventListener("keydown",e=>{
    if (e.repeat && (e.key.toLowerCase()==="h")) return;
    const k=e.key.toLowerCase();
    state.lastInputAt = performance.now();
    if(keyMap[k]){controls[keyMap[k]]=true;e.preventDefault();}
    if(k==="h"){controls.horn=true; if(state.hornTimer<=0) honk(false); e.preventDefault();}
    if(k==="c")cycleCameraMode();
    if(k==="u")toggleHud();
    if(k==="r")restartGame();
    if(k==="f1"){e.preventDefault();$("devicePanel").classList.toggle("hidden");refreshDevicePanel();}
    if(k==="escape"&&!$("devicePanel").classList.contains("hidden"))$("devicePanel").classList.add("hidden");
    else if(k==="p"||k==="escape")showPause(!state.paused);
    if(k==="enter"&&!state.running)startGame();
  });
  window.addEventListener("keyup",e=>{
    const k=e.key.toLowerCase();
    if(keyMap[k]){controls[keyMap[k]]=false;e.preventDefault();}
    if(k==="h") controls.horn=false;
  });
  document.querySelectorAll("[data-control]").forEach(btn=>{
    const key=btn.dataset.control;
    const down=e=>{
      e.preventDefault();
      state.lastInputAt = performance.now();
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      controls[key]=true; btn.classList.add("pressed");
      if (key==="horn" && state.hornTimer<=0) honk(false);
      unlockAudio();
    };
    const up=e=>{
      e.preventDefault();
      controls[key]=false; btn.classList.remove("pressed");
    };
    btn.addEventListener("pointerdown",down);
    btn.addEventListener("pointerup",up);
    btn.addEventListener("pointercancel",up);
    btn.addEventListener("contextmenu",e=>e.preventDefault());
  });
  window.addEventListener("blur",()=>{
    Object.keys(controls).forEach(k=>controls[k]=false);
    if(state.running&&!state.paused&&!isMobile&&(performance.now()-state.lastInputAt>500)) showPause(true);
  });
  document.addEventListener("visibilitychange",()=>{if(document.hidden&&state.running&&!state.paused)showPause(true);});
  window.addEventListener("gamepadconnected",e=>{state.gamepadIndex=e.gamepad.index;refreshDevicePanel();toast("Подключено: "+e.gamepad.id);});
  window.addEventListener("gamepaddisconnected",e=>{if(state.gamepadIndex===e.gamepad.index)state.gamepadIndex=null;hardware.steer=hardware.throttle=hardware.brake=0;hardware.handbrake=false;hardware.horn=false;refreshDevicePanel();toast("Контроллер отключён");});
  document.addEventListener("touchmove", e => {
    if (!e.target.closest(".start-card, .device-panel, .pause-panel, .overlay")) e.preventDefault();
  }, {passive:false});
  document.addEventListener("gesturestart", e => e.preventDefault());
  window.addEventListener("pointerdown", unlockAudio, {passive:true});
}

function bindUI() {
  $("startBtn").addEventListener("click", () => { unlockAudio(); startGame(); });
  $("startBtn").addEventListener("pointerup", e => {
    if (e.pointerType === "touch") { unlockAudio(); startGame(); }
  });
  $("resumeBtn").addEventListener("click",()=>showPause(false));
  $("restartBtn").addEventListener("click",restartGame);
  $("menuBtn").addEventListener("click",()=>{
    state.running=false;state.paused=false;state.speed=0;
    document.body.classList.remove("playing");
    $("hud").classList.remove("visible");$("pausePanel").classList.add("hidden");$("startOverlay").classList.remove("hidden");
  });
  $("moreBtn").addEventListener("click",()=>{
    const panel=$("topActions");
    const open=panel.classList.toggle("open");
    $("moreBtn").setAttribute("aria-expanded", String(open));
  });
  $("hudToggleBtn").addEventListener("click", toggleHud);
  ["speedLinesToggle","speedLinesTogglePause"].forEach(id=>{
    const el=$(id);
    if(el) el.addEventListener("change", e => setSpeedLinesOn(e.target.checked, true));
  });
  syncSpeedLineToggles();
  $("cameraBtn").addEventListener("click",setCameraMode);
  $("devicesBtn").addEventListener("click",()=>{$("devicePanel").classList.remove("hidden");refreshDevicePanel();});
  $("deviceClose").addEventListener("click",()=>$("devicePanel").classList.add("hidden"));
  $("deviceCloseBottom").addEventListener("click",()=>$("devicePanel").classList.add("hidden"));
  $("refreshDevicesBtn").addEventListener("click",refreshDevicePanel);
  $("deviceSelect").addEventListener("change",e=>{state.gamepadIndex=e.target.value===""?null:Number(e.target.value);refreshDevicePanel();});
  ["steerSource","gasSource","brakeSource","handbrakeSource"].forEach(id=>$(id).addEventListener("change",e=>{const key={steerSource:"steer",gasSource:"gas",brakeSource:"brake",handbrakeSource:"handbrake"}[id];inputConfig[key]=e.target.value;saveInputConfig();}));
  [["invertSteer","invertSteer"],["invertGas","invertGas"],["invertBrake","invertBrake"],["pedalsPositive","pedalsPositive"]].forEach(([id,key])=>$(id).addEventListener("change",e=>{inputConfig[key]=e.target.checked;saveInputConfig();}));
  $("steerSensitivity").addEventListener("input",e=>{inputConfig.sensitivity=Number(e.target.value);$("sensitivityValue").textContent=inputConfig.sensitivity.toFixed(1)+"×";saveInputConfig();});
  $("timeBtn").addEventListener("click",()=>{const modes=["sunset","day","night"];applyTime(modes[(modes.indexOf(state.time)+1)%modes.length]);toast("Время суток: "+(state.time==="day"?"день":state.time==="night"?"ночь":"закат"));});
  $("qualityBtn").addEventListener("click", cycleQuality);
  $("soundBtn").addEventListener("click",()=>{
    state.soundOn=!state.soundOn;$("soundBtn").textContent=state.soundOn?"♫":"♪";
    $("soundBtn").title=state.soundOn?"Звук включён":"Звук выключен";
    if(!state.soundOn&&engineGain&&audioContext)engineGain.gain.setTargetAtTime(.0001,audioContext.currentTime,.05);
    else if(state.soundOn){initAudio();if(audioContext&&audioContext.state==="suspended")audioContext.resume();}
  });
  $("fullscreenBtn").addEventListener("click",()=>{
    try {
      if(!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(()=>{});
      else document.exitFullscreen?.().catch(()=>{});
    } catch(e) { toast("Полный экран недоступен"); }
  });
  document.querySelectorAll(".mode-btn").forEach(btn=>btn.addEventListener("click",()=>applyTime(btn.dataset.mode)));
  document.querySelectorAll("[data-car]").forEach(btn=>btn.addEventListener("click",()=>selectCar(btn.dataset.car)));
  document.querySelectorAll(".paint").forEach(btn=>btn.addEventListener("click",()=>{
    state.paint=btn.dataset.paint;document.querySelectorAll(".paint").forEach(b=>b.classList.toggle("active",b===btn));updateCarPaint();
  }));
  const mm=$("minimap"); if(mm) minimapContext=mm.getContext("2d");
}

function loop(now) {
  requestAnimationFrame(loop);
  const rawDt=(now-lastFrame)/1000||0;
  const dt=Math.min(.033,rawDt);lastFrame=now;clock.now=now/1000;
  try {
    updateGame(dt);
    try { renderRearMirror(); } catch (e) { console.warn(e); }
    if(composer && qcfg().post && qcfg().bloom > 0) composer.render();
    else if (renderer && scene && camera) renderer.render(scene,camera);
  } catch (e) {
    console.error(e);
  }
  if (rawDt < 0.35) { frameCount++; fpsTime += rawDt; }
  if(fpsTime>2.5){
    const fps = frameCount/fpsTime;
    const btn=$("startBtn"); if(btn) btn.dataset.fps=String(Math.round(fps));
    if (state.autoQuality && clock.now > 8 && fps < 22 && state.qualityLevel !== "low") {
      lowFpsStreak += 1;
      if (lowFpsStreak >= 3) {
        const next = state.qualityLevel === "high" ? "medium" : "low";
        applyQuality(next, false);
        toast("Автокачество: "+QUALITY_LABELS[next]);
        lowFpsStreak = 0;
      }
    } else lowFpsStreak = 0;
    frameCount=0;fpsTime=0;
  }
}

function attachContextHandlers(canvas) {
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    try { localStorage.setItem("driveHorizonQuality", "low"); } catch(e){ /* ignore */ }
    showError("Графический контекст потерян. Обнови страницу — игра включит низкое качество.");
    setLoadStatus("Контекст WebGL потерян.");
  });
  canvas.addEventListener("webglcontextrestored", () => {
    try { location.reload(); } catch(e){ /* ignore */ }
  });
}

function createRendererSafe() {
  const attempts = [
    { antialias: qcfg().antialias, powerPreference: isMobile ? "default" : "high-performance" },
    { antialias: false, powerPreference: "default" },
    { antialias: false, powerPreference: "low-power", failIfMajorPerformanceCaveat: false }
  ];
  let lastError;
  for (const extra of attempts) {
    try {
      const r = new THREE.WebGLRenderer({ alpha:false, failIfMajorPerformanceCaveat:false, ...extra });
      return r;
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error("WebGL unavailable");
}

function init() {
  try{
    setLoadStatus("Создаём графический движок…");
    renderer=createRendererSafe();
    applyQuality(state.qualityLevel, false);
    renderer.setSize(window.innerWidth,window.innerHeight,false);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
    renderer.shadowMap.enabled=qcfg().shadows;renderer.shadowMap.type=THREE.PCFShadowMap;
    sceneHost.appendChild(renderer.domElement);
    attachContextHandlers(renderer.domElement);
    scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0xc88e79,.00085);
    camera=new THREE.PerspectiveCamera(62,window.innerWidth/window.innerHeight,.1,2800);
    ambientLight=new THREE.HemisphereLight(0xc5e0ec,0x5d654f,.8);scene.add(ambientLight);
    directionalLight=new THREE.DirectionalLight(0xffe2c1,2.1);directionalLight.position.set(-120,180,-80);
    directionalLight.castShadow=qcfg().shadows;directionalLight.shadow.mapSize.set(qcfg().shadowSize,qcfg().shadowSize);
    directionalLight.shadow.camera.left=-250;directionalLight.shadow.camera.right=250;
    directionalLight.shadow.camera.top=250;directionalLight.shadow.camera.bottom=-250;
    directionalLight.shadow.camera.near=1;directionalLight.shadow.camera.far=600;
    directionalLight.shadow.bias=-.0002;scene.add(directionalLight);scene.add(directionalLight.target);
    setLoadStatus("Строим трассу и окружение…");
    makeSky();buildWorld();initEffects();
    if (qcfg().post) {
      try {
        composer=new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene,camera));
        bloomPass=new UnrealBloomPass(new THREE.Vector2(window.innerWidth,window.innerHeight),qcfg().bloom,.38,.88);
        composer.addPass(bloomPass);composer.addPass(new OutputPass());
      } catch (e) {
        console.warn("Post-processing unavailable", e);
        composer=null; bloomPass=null;
      }
    }
    const savedCar=localStorage.getItem("driveHorizonCarV2");
    if(CAR_OPTIONS[savedCar])state.car=savedCar;
    player=new THREE.Group();playerFallback=makeCar(state.paint);player.add(playerFallback);scene.add(player);addPlayerHeadlights();
    createTraffic();buildCockpit();updateCameraButton();drawMiniMap();bindControls();bindUI();window.addEventListener("resize",resize);
    loadInputConfig();refreshDevicePanel();updateCarSelectionUI();
    loadCar(state.car);
    state.worldReady = true;
    window.__DRIVE_HORIZON_READY = true;
    window.__DRIVE_HORIZON = {
      getState() {
        return {
          speed: state.speed, running: state.running, paused: state.paused,
          damage: state.damage, score: state.score, collisions: state.collisionCount,
          quality: state.qualityLevel, horn: state.hornTimer > 0, ready: true,
          lateral: state.lateral, gas: !!controls.gas
        };
      },
      start: startGame, honk: () => honk(false), applyTime, restart: restartGame,
      setControl(key, value) { if (key in controls) controls[key] = !!value; },
      setSpeedLines: setSpeedLinesOn,
      setMessage,
      prepSpeedRun(){
        state.lateral=0;state.damage=0;state.steer=0;state.steerInput=0;
        traffic.forEach(car=>{car.ghost=true;car.offset=24;car.baseOffset=24;});
      },
      setSpeed(mps){
        debugSpeedLock=(mps==null||mps===false)?null:Number(mps);
        if(debugSpeedLock!=null&&Number.isFinite(debugSpeedLock)) state.speed=debugSpeedLock;
        else debugSpeedLock=null;
      },
      setCamera(mode){
        if(mode==null) return state.camera;
        state.camera=((Number(mode)%4)+4)%4;
        chaseCamReady=false;
        auxCamMode=-1;
        updateCameraButton();
        syncViewClasses();
        return state.camera;
      },
      getChaseMetrics(){
        if(!player||!camera) return null;
        const pts=[[-1.05,.35,-2.3],[1.05,.35,-2.3],[-1.05,1.15,2.3],[1.05,1.15,2.3],[0,.6,0]];
        let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
        for(const [x,y,z] of pts){
          const p=player.localToWorld(new THREE.Vector3(x,y,z)).project(camera);
          minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x);
          minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y);
        }
        const w=renderer?.domElement?.width||1;
        const h=renderer?.domElement?.height||1;
        return {
          dist:camera.position.distanceTo(player.position),
          spanPx:(maxX-minX)*0.5*w,
          spanHpx:(maxY-minY)*0.5*h,
          fov:camera.fov,
          speedKmh:Math.abs(state.speed)*3.6,
          camera:state.camera
        };
      },
      tick(seconds) {
        const steps = Math.max(1, Math.ceil((seconds||0.033)/0.033));
        for (let i=0;i<steps;i++) updateGame(0.033);
      },
      crash() {
        state.speed = Math.max(state.speed, 26);
        state.lateral = 10.8;
        const pos = player.position.clone().add(new THREE.Vector3(0,0.7,0));
        collideWorld(0.02);
        applyDamage(16, pos);
        spawnSparks(pos, 16);
        spawnSmoke(pos, 4);
      }
    };
    const startBtn = $("startBtn");
    if (startBtn) {
      startBtn.disabled = false;
      const label = startBtn.querySelector("span");
      if (label && label.textContent.includes("ЗАГРУЗКА")) label.textContent = "ЗАВЕСТИ ДВИГАТЕЛЬ";
    }
    setLoadStatus("Трасса готова. Загружается "+CAR_OPTIONS[state.car].name+"…");
    const rec=$("record"); if(rec) rec.innerHTML=(Number(localStorage.getItem("driveHorizonRecord")||0)/1000).toFixed(2)+" <i>KM</i>";
    setMessage("Держи полосу и наслаждайся дорогой");
    updateHudMeta();
    requestAnimationFrame(loop);
  }catch(error){
    console.error(error);
    showError("Не удалось запустить 3D-сцену: "+(error && error.message ? error.message : "ошибка WebGL")+". Обнови страницу или попробуй другое устройство.");
    setLoadStatus("Не удалось запустить 3D-сцену.");
  }
}
init();
