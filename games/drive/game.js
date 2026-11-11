import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/utils/BufferGeometryUtils.js";
import { EffectComposer } from "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/postprocessing/OutputPass.js";
import { RGBELoader } from "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/loaders/RGBELoader.js";

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
let debugViewLock=null;
let mirrorRT, mirrorCam, mirrorMesh, mirrorFrame, mirrorFallback;
const hardware = { steer:0, throttle:0, brake:0, handbrake:false, horn:false };
const inputConfig = { steer:"axis0", gas:"button7", brake:"button6", handbrake:"button0", invertSteer:false, invertGas:false, invertBrake:false, pedalsPositive:false, sensitivity:1.25 };
let skyTexture, skyCanvas, skyContext, sun, directionalLight, ambientLight, stars, moon;
let roadTexture, grassTexture, minimapContext, audioContext, masterGain;
let roadAsphaltMat=null, barrierConcreteMat=null, envIsHdr=false;
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
  sunset: { top:"#214366", middle:"#e28c74", horizon:"#ffd4a1", fog:0xc88e79, ambient:.74, direct:2.15, env:.95, envHdr:.32 },
  day:    { top:"#4a90c6", middle:"#7eb4d8", horizon:"#c8d8e6", fog:0x8fadc0, ambient:1.02, direct:2.25, env:1.05, envHdr:.36 },
  night:  { top:"#071326", middle:"#172e4a", horizon:"#34465c", fog:0x1b2b40, ambient:.32, direct:.18, env:.42, envHdr:.18 }
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
      const n=mode==="day"?58:36;
      for(let i=0;i<n;i++){
        const x=rand()*skyCanvas.width,y=mode==="day"?(36+rand()*210):(95+rand()*230);
        const rx=52+rand()*150,ry=11+rand()*30;
        skyContext.save();skyContext.translate(x,y);skyContext.scale(1,ry/rx);
        const cloud=skyContext.createRadialGradient(0,0,2,0,0,rx);
        cloud.addColorStop(0,mode==="sunset"?"rgba(255,226,205,.28)":"rgba(255,255,255,.42)");
        cloud.addColorStop(.55,mode==="sunset"?"rgba(255,220,198,.13)":"rgba(248,252,255,.18)");
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
  if (scene) scene.environmentIntensity = envIsHdr ? (p.envHdr ?? p.env * 0.34) : p.env;
  if (bloomPass) bloomPass.strength = (mode==="night" ? 0.55 : 0.78) * qcfg().bloom;
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
  barrierConcreteMat=new THREE.MeshStandardMaterial({color:0xb9b4aa,roughness:.9,metalness:.04});
  barrierConcreteMat.userData.tint=0xc4bfb4;
  const barrierStep=state.qualityLevel==="low"?7.2:4.2;
  const barrierCount=Math.ceil(trackLength/barrierStep)*2+4;
  const barriers=new THREE.InstancedMesh(new THREE.BoxGeometry(.48,.76,3.5),barrierConcreteMat,barrierCount);
  const bDummy=new THREE.Object3D();let bi=0;
  for(let t=0;t<1;t+=barrierStep/trackLength){
    const p=curve.getPointAt(t),tan=curve.getTangentAt(t),right=vecRight(tan);
    const quat=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),tan);
    for(const side of [-1,1]){
      bDummy.position.copy(p).addScaledVector(right,side*10.52);
      bDummy.position.y+=.42;
      bDummy.quaternion.copy(quat);
      bDummy.scale.set(1,1,1);
      bDummy.updateMatrix();
      if(bi<barrierCount) barriers.setMatrixAt(bi++,bDummy.matrix);
    }
  }
  barriers.count=bi;barriers.instanceMatrix.needsUpdate=true;barriers.receiveShadow=true;scene.add(barriers);
  roadAsphaltMat=asphalt;
  roadAsphaltMat.userData.tint=0x6a6f74;
  loadWorldLooks();
}

function loadWorldLooks(){
  const texLoader=new THREE.TextureLoader();
  const apply=(mat,url,repeatX,repeatY)=>{
    if(!mat) return;
    texLoader.load(url,(t)=>{
      t.colorSpace=THREE.SRGBColorSpace;
      t.wrapS=t.wrapT=THREE.RepeatWrapping;
      t.repeat.set(repeatX,repeatY);
      t.anisotropy=qcfg().anisotropy;
      mat.map=t;
      mat.color.setHex(mat.userData.tint || 0xffffff);
      mat.needsUpdate=true;
    },undefined,()=>{});
  };
  apply(roadAsphaltMat,"assets/tex/asphalt031_color.webp",2.4,56);
  apply(barrierConcreteMat,"assets/tex/concrete034_color.webp",1.1,6);
  if(state.qualityLevel==="low"||!scene) return;
  new RGBELoader().load("assets/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr",(tex)=>{
    tex.mapping=THREE.EquirectangularReflectionMapping;
    scene.environment=tex;
    envIsHdr=true;
    const p=PALETTES[state.time]||PALETTES.sunset;
    scene.environmentIntensity=p.envHdr ?? p.env*0.34;
  },undefined,()=>{});
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

function xformGeo(geo,x=0,y=0,z=0,rx=0,ry=0,rz=0,sx=1,sy=1,sz=1){
  const g=geo.clone();
  if(sx!==1||sy!==1||sz!==1)g.scale(sx,sy,sz);
  if(rx)g.rotateX(rx);if(ry)g.rotateY(ry);if(rz)g.rotateZ(rz);
  if(x||y||z)g.translate(x,y,z);
  return g;
}

function mixKey(a,b,t){
  const e=t*t*(3-2*t);
  const out={};
  for(const k of Object.keys(a)) out[k]=a[k]+((b[k]??a[k])-a[k])*e;
  out.z=a.z+(b.z-a.z)*t;
  return out;
}

function sampleKeys(keys,count){
  const out=[],n=keys.length-1;
  for(let i=0;i<count;i++){
    const u=i/(count-1)*n,i0=Math.min(n-1,Math.floor(u));
    out.push(mixKey(keys[i0],keys[i0+1],u-i0));
  }
  return out;
}

function sectionRing(st,segs){
  const pts=[];
  for(let i=0;i<segs;i++){
    const th=-Math.PI/2+(i/segs)*Math.PI*2;
    const c=Math.cos(th),s=Math.sin(th);
    const top=Math.max(0,s),bot=Math.max(0,-s);
    const expX=s>0?.68:.38,expY=s>0?.82:.42;
    const px=Math.sign(c)*Math.pow(Math.abs(c),expX);
    const py=Math.sign(s)*Math.pow(Math.abs(s),expY);
    const width=st.roof+(st.halfW-st.roof)*(1-top*top);
    const tucked=width*(1-(st.tuck||0)*bot*.42);
    const spine=(st.spine||0)*Math.pow(top,2.2);
    pts.push([tucked*px, st.y0+st.height*.5+(st.height*.5)*py+spine]);
  }
  return pts;
}

function loftHull(keys,segs,samples){
  const stations=sampleKeys(keys,samples).map(st=>({...st,pts:sectionRing(st,segs)}));
  const positions=[],normals=[],uvs=[],indices=[];
  const ns=stations.length;
  for(let i=0;i<ns;i++){
    for(let j=0;j<segs;j++){
      const [x,y]=stations[i].pts[j];
      positions.push(x,y,stations[i].z);
      uvs.push(j/segs,i/(ns-1));
    }
  }
  for(let i=0;i<ns-1;i++){
    for(let j=0;j<segs;j++){
      const a=i*segs+j,b=i*segs+((j+1)%segs);
      const c=(i+1)*segs+j,d=(i+1)*segs+((j+1)%segs);
      indices.push(a,c,b,b,c,d);
    }
  }
  const addCap=(stIndex,zDir)=>{
    const st=stations[stIndex];
    let cx=0,cy=0;
    for(const p of st.pts){cx+=p[0];cy+=p[1];}
    cx/=segs;cy/=segs;
    const base=positions.length/3;
    positions.push(cx,cy,st.z);uvs.push(.5,.5);
    for(let j=0;j<segs;j++){
      positions.push(st.pts[j][0],st.pts[j][1],st.z);
      uvs.push(.5+st.pts[j][0]*.4,.5+st.pts[j][1]*.4);
    }
    for(let j=0;j<segs;j++){
      const a=base,b=base+1+j,c=base+1+((j+1)%segs);
      if(zDir<0)indices.push(a,b,c);else indices.push(a,c,b);
    }
  };
  addCap(0,-1);addCap(ns-1,1);
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const pos=geo.attributes.position,nrm=geo.attributes.normal;
  let dot=0;
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i),y=pos.getY(i)-.55;
    dot+=nrm.getX(i)*x+nrm.getY(i)*y;
  }
  if(dot<0){
    const idx=geo.index.array;
    for(let i=0;i<idx.length;i+=3){const t=idx[i];idx[i]=idx[i+1];idx[i+1]=t;}
    geo.computeVertexNormals();
  }
  return geo;
}

function mergeMats(geos,mat,group,cast=true){
  if(!geos.length)return null;
  geos.forEach(g=>{if(!g.attributes.normal)g.computeVertexNormals();});
  const merged=mergeGeometries(geos,false);
  geos.forEach(g=>g.dispose());
  if(!merged)return null;
  if(!merged.attributes.normal)merged.computeVertexNormals();
  const mesh=new THREE.Mesh(merged,mat);
  mesh.castShadow=cast;mesh.receiveShadow=true;
  group.add(mesh);
  return mesh;
}

function makeHypercar(color){
  const g=new THREE.Group();
  const rich=state.qualityLevel!=="low";
  const segs=rich?28:16;
  const samples=rich?26:16;
  const spokeN=rich?7:5;
  const finN=rich?7:5;

  const bodyMat=rich
    ? new THREE.MeshPhysicalMaterial({color,metalness:.58,roughness:.24,clearcoat:1,clearcoatRoughness:.06,envMapIntensity:1.15})
    : new THREE.MeshStandardMaterial({color,metalness:.55,roughness:.28});
  bodyMat.name="paint";
  const carbon=new THREE.MeshStandardMaterial({color:0x111418,metalness:.42,roughness:.46});
  const glass=rich
    ? new THREE.MeshPhysicalMaterial({color:0x081018,metalness:.12,roughness:.045,transparent:true,opacity:.46,clearcoat:1,clearcoatRoughness:.04,side:THREE.DoubleSide,depthWrite:true,envMapIntensity:1.2})
    : new THREE.MeshStandardMaterial({color:0x0a141c,metalness:.2,roughness:.08,transparent:true,opacity:.5,side:THREE.DoubleSide});
  const chrome=new THREE.MeshStandardMaterial({color:0xc5ccd2,metalness:1,roughness:.18});
  const rubber=new THREE.MeshStandardMaterial({color:0x121417,roughness:.92,metalness:.06});
  const rimMat=new THREE.MeshStandardMaterial({color:0x8e979f,metalness:.92,roughness:.22});
  const discMat=new THREE.MeshStandardMaterial({color:0x4c5056,metalness:.72,roughness:.38});
  const caliperMat=new THREE.MeshStandardMaterial({color:0xc4a046,metalness:.55,roughness:.4});
  const cabinMat=new THREE.MeshStandardMaterial({color:0x090b0e,roughness:.86});
  const headMat=new THREE.MeshStandardMaterial({color:0xf4f8ff,emissive:0xb9d8ff,emissiveIntensity:1.55,roughness:.22,metalness:.35});
  const tailMat=new THREE.MeshStandardMaterial({color:0xff2a32,emissive:0xff1428,emissiveIntensity:.7,roughness:.28,metalness:.2});
  const glowIn=new THREE.MeshStandardMaterial({color:0xff7a3a,emissive:0xff4a14,emissiveIntensity:.55,roughness:.4});
  carPaintMaterial=bodyMat;

  const bodyKeys=[
    {z:-2.32,halfW:.36,height:.10,y0:.08,roof:.26,tuck:.04,spine:.00},
    {z:-2.16,halfW:.70,height:.18,y0:.09,roof:.50,tuck:.08,spine:.01},
    {z:-1.96,halfW:.88,height:.28,y0:.10,roof:.62,tuck:.16,spine:.022},
    {z:-1.70,halfW:.98,height:.36,y0:.12,roof:.60,tuck:.48,spine:.03},
    {z:-1.44,halfW:1.04,height:.44,y0:.18,roof:.58,tuck:.88,spine:.034},
    {z:-1.18,halfW:1.00,height:.47,y0:.18,roof:.56,tuck:.70,spine:.028},
    {z:-.82,halfW:.94,height:.50,y0:.14,roof:.66,tuck:.22,spine:.02},
    {z:-.38,halfW:.91,height:.53,y0:.13,roof:.70,tuck:.12,spine:.016},
    {z: .22,halfW:.90,height:.54,y0:.13,roof:.72,tuck:.10,spine:.012},
    {z: .76,halfW:.95,height:.52,y0:.14,roof:.74,tuck:.18,spine:.012},
    {z:1.12,halfW:1.03,height:.50,y0:.16,roof:.72,tuck:.50,spine:.016},
    {z:1.40,halfW:1.08,height:.52,y0:.18,roof:.78,tuck:.88,spine:.02},
    {z:1.70,halfW:1.04,height:.48,y0:.15,roof:.86,tuck:.46,spine:.01},
    {z:1.96,halfW:.98,height:.43,y0:.14,roof:.88,tuck:.16,spine:.004},
    {z:2.14,halfW:.93,height:.38,y0:.16,roof:.86,tuck:.08,spine:.000}
  ];
  const glassKeys=[
    {z:-.80,halfW:.70,height:.10,y0:.59,roof:.46,tuck:0,spine:.03},
    {z:-.56,halfW:.68,height:.36,y0:.59,roof:.36,tuck:0,spine:.055},
    {z:-.18,halfW:.64,height:.50,y0:.58,roof:.30,tuck:0,spine:.075},
    {z: .26,halfW:.62,height:.52,y0:.56,roof:.28,tuck:0,spine:.08},
    {z: .64,halfW:.65,height:.40,y0:.56,roof:.34,tuck:0,spine:.045},
    {z: .92,halfW:.70,height:.20,y0:.56,roof:.50,tuck:0,spine:.02},
    {z:1.08,halfW:.74,height:.07,y0:.56,roof:.60,tuck:0,spine:.00}
  ];

  const paintGeos=[loftHull(bodyKeys,segs,samples)];
  const carbonGeos=[];
  const chromeGeos=[];
  const glassGeos=[loftHull(glassKeys,Math.max(16,segs-4),rich?16:12)];
  const headGeos=[];
  const tailGeos=[];

  // Tight wheel-arch brows instead of bulky blisters.
  const archGeo=new THREE.TorusGeometry(.40,.028,rich?8:6,rich?18:12,Math.PI);
  archGeo.rotateY(Math.PI/2);
  for(const x of [-1.00,1.00]) for(const z of [-1.36,1.36]){
    paintGeos.push(xformGeo(archGeo,x,.355,z));
  }
  archGeo.dispose();

  // Hood vents, dark canopy pillars, mirror caps, centre spine.
  for(const x of [-.26,.26]) paintGeos.push(xformGeo(new THREE.BoxGeometry(.16,.012,.28),x,.60,-1.38,.1));
  for(const s of [-1,1]){
    carbonGeos.push(xformGeo(new THREE.BoxGeometry(.045,.46,.07),s*.64,.83,-.50,.52,0,s*-.16));
    carbonGeos.push(xformGeo(new THREE.BoxGeometry(.04,.34,.07),s*.60,.78,.56,-.34,0,s*.1));
    paintGeos.push(xformGeo(new THREE.BoxGeometry(.15,.08,.20),s*1.08,.84,-.50,0,0,s*.16));
  }
  paintGeos.push(xformGeo(new THREE.BoxGeometry(.06,.025,3.55),0,.60,-.04));

  // Dark cabin volume so the glass canopy is not a see-through tunnel.
  const cabin=new THREE.Mesh(new THREE.BoxGeometry(1.05,.26,1.28),cabinMat);
  cabin.position.set(0,.68,.06);g.add(cabin);
  for(const x of [-.26,.26]){
    const rest=new THREE.Mesh(new THREE.BoxGeometry(.18,.12,.09),cabinMat);
    rest.position.set(x,.84,.18);g.add(rest);
  }

  // Front splitter, lower grille and side skirts.
  carbonGeos.push(xformGeo(new THREE.BoxGeometry(1.88,.04,.34),0,.072,-2.18));
  carbonGeos.push(xformGeo(new THREE.BoxGeometry(1.58,.045,.16),0,.09,-2.32));
  carbonGeos.push(xformGeo(new THREE.BoxGeometry(1.18,.09,.14),0,.20,-2.22));
  carbonGeos.push(xformGeo(new THREE.BoxGeometry(.50,.07,.1),0,.27,-2.24));
  for(const s of [-1,1]) carbonGeos.push(xformGeo(new THREE.BoxGeometry(.035,.07,.28),s*.92,.085,-2.20));
  for(const s of [-1,1]) carbonGeos.push(xformGeo(new THREE.BoxGeometry(.09,.07,1.92),s*.86,.14,.04));

  // Sculpted side intakes behind the doors — thin slots, not black boxes.
  for(const s of [-1,1]){
    carbonGeos.push(xformGeo(new THREE.BoxGeometry(.07,.13,.36),s*.96,.38,-.28,0,s*.22));
    paintGeos.push(xformGeo(new THREE.BoxGeometry(.04,.16,.40),s*1.00,.40,-.28,0,s*.22));
    paintGeos.push(xformGeo(new THREE.BoxGeometry(.10,.035,.38),s*.98,.47,-.27,0,s*.2));
  }

  // Rear carbon panel, diffuser and license recess.
  carbonGeos.push(xformGeo(new THREE.BoxGeometry(1.62,.22,.06),0,.32,2.155));
  carbonGeos.push(xformGeo(new THREE.BoxGeometry(.28,.12,.03),0,.33,2.185));
  carbonGeos.push(xformGeo(new THREE.BoxGeometry(1.72,.06,.38),0,.10,2.08));
  for(let i=0;i<finN;i++){
    const x=-.72+i*(1.44/Math.max(1,finN-1));
    carbonGeos.push(xformGeo(new THREE.BoxGeometry(.035,.14,.36),x,.16,2.12));
  }
  carbonGeos.push(xformGeo(new THREE.BoxGeometry(.04,.12,.36),-.86,.16,2.10));
  carbonGeos.push(xformGeo(new THREE.BoxGeometry(.04,.12,.36),.86,.16,2.10));

  // Quad exhausts: two pairs of chrome tips with glowing inners.
  for(const x of [-.22,.22,-.42,.42]){
    chromeGeos.push(xformGeo(new THREE.CylinderGeometry(.045,.045,.07,rich?14:10),x,.305,2.20,Math.PI/2,0,0));
    chromeGeos.push(xformGeo(new THREE.CylinderGeometry(.032,.032,.02,rich?12:8),x,.305,2.235,Math.PI/2,0,0));
  }

  // Slim LED headlights with a slight outer hook.
  for(const s of [-1,1]){
    headGeos.push(xformGeo(new THREE.BoxGeometry(.50,.034,.045),s*.56,.385,-2.20,0,s*.18));
    headGeos.push(xformGeo(new THREE.BoxGeometry(.08,.09,.04),s*.84,.355,-2.16));
    headGeos.push(xformGeo(new THREE.CylinderGeometry(.035,.035,.04,12),s*.38,.385,-2.21,Math.PI/2,0,0));
  }
  // Full-width rear LED bar that wraps the corners.
  tailGeos.push(xformGeo(new THREE.BoxGeometry(1.68,.048,.055),0,.50,2.175));
  tailGeos.push(xformGeo(new THREE.BoxGeometry(1.52,.018,.03),0,.53,2.185));
  for(const s of [-1,1]){
    tailGeos.push(xformGeo(new THREE.CylinderGeometry(.024,.024,.05,10),s*.84,.50,2.175,0,0,Math.PI/2));
    tailGeos.push(xformGeo(new THREE.BoxGeometry(.045,.034,.20),s*.90,.50,2.08));
  }
  tailGeos.push(xformGeo(new THREE.BoxGeometry(.72,.016,.03),0,.78,1.07));

  // Mirror stalks and glasses.
  for(const s of [-1,1]){
    carbonGeos.push(xformGeo(new THREE.BoxGeometry(.18,.03,.04),s*1.00,.84,-.50,0,0,s*.2));
    glassGeos.push(xformGeo(new THREE.BoxGeometry(.12,.06,.015),s*1.12,.86,-.42,0,s*.15));
  }

  mergeMats(paintGeos,bodyMat,g);
  mergeMats(carbonGeos,carbon,g);
  mergeMats(chromeGeos,chrome,g);
  mergeMats(glassGeos,glass,g);
  mergeMats(headGeos,headMat,g,false);
  const tailMesh=mergeMats(tailGeos,tailMat,g,false);
  const exhaustGlow=[];
  for(const x of [-.22,.22,-.42,.42]){
    const inner=new THREE.Mesh(new THREE.CircleGeometry(.028,10),glowIn);
    inner.position.set(x,.305,2.242);g.add(inner);exhaustGlow.push(inner);
  }

  // Active rear wing: plane, gurney flap and endplates.
  const wing=new THREE.Group();
  wing.position.set(0,1.16,2.02);
  wing.rotation.x=.12;
  const wingShape=new THREE.Shape();
  wingShape.moveTo(-.98,-.15);wingShape.lineTo(.98,-.15);wingShape.lineTo(.90,.16);wingShape.lineTo(-.90,.16);wingShape.closePath();
  const wingGeo=new THREE.ExtrudeGeometry(wingShape,{depth:.055,bevelEnabled:rich,bevelThickness:.01,bevelSize:.016,bevelSegments:2});
  wingGeo.rotateX(Math.PI/2);wingGeo.translate(0,0,-.028);
  const wingMesh=new THREE.Mesh(wingGeo,carbon);
  wingMesh.castShadow=true;wing.add(wingMesh);
  const gurney=new THREE.Mesh(new THREE.BoxGeometry(1.80,.045,.012),carbon);
  gurney.position.set(0,.04,.15);wing.add(gurney);
  const wingLed=new THREE.Mesh(new THREE.BoxGeometry(1.55,.012,.018),tailMat);
  wingLed.position.set(0,-.02,.16);wing.add(wingLed);
  for(const s of [-1,1]){
    const plate=new THREE.Mesh(new THREE.BoxGeometry(.035,.30,.38),carbon);
    plate.position.set(s*.98,.02,.0);plate.castShadow=true;wing.add(plate);
  }
  g.add(wing);
  for(const s of [-1,1]){
    const stalk=new THREE.Mesh(new THREE.BoxGeometry(.045,.38,.09),carbon);
    stalk.position.set(s*.32,.92,1.82);stalk.rotation.x=.28;stalk.castShadow=true;g.add(stalk);
  }

  // Detailed wheels: spinning rims + fixed calipers, fronts steer.
  const wheelR=.355;
  const tirePts=[
    new THREE.Vector2(.208,-.152),new THREE.Vector2(.278,-.156),new THREE.Vector2(.330,-.136),
    new THREE.Vector2(.350,-.068),new THREE.Vector2(.358,0),new THREE.Vector2(.350,.068),
    new THREE.Vector2(.330,.136),new THREE.Vector2(.278,.156),new THREE.Vector2(.208,.152)
  ];
  const tireGeo=new THREE.LatheGeometry(tirePts,rich?26:16);
  tireGeo.rotateZ(Math.PI/2);
  const rimPts=[
    new THREE.Vector2(.205,-.118),new THREE.Vector2(.332,-.118),new THREE.Vector2(.340,-.102),
    new THREE.Vector2(.318,-.092),new THREE.Vector2(.236,-.078),new THREE.Vector2(.198,-.02),
    new THREE.Vector2(.198,.02),new THREE.Vector2(.236,.078),new THREE.Vector2(.318,.092),
    new THREE.Vector2(.340,.102),new THREE.Vector2(.332,.118),new THREE.Vector2(.205,.118)
  ];
  const rimShell=new THREE.LatheGeometry(rimPts,rich?28:16);
  rimShell.rotateZ(Math.PI/2);
  const spokeGeos=[rimShell];
  for(let i=0;i<spokeN;i++){
    const a=(i/spokeN)*Math.PI*2;
    const spoke=new THREE.BoxGeometry(.028,.214,.046);
    spoke.translate(0,.132,0);spoke.rotateX(a);
    spokeGeos.push(spoke);
  }
  spokeGeos.push(xformGeo(new THREE.CylinderGeometry(.078,.078,.05,rich?16:10),.0,0,0,0,0,Math.PI/2));
  spokeGeos.push(xformGeo(new THREE.CylinderGeometry(.03,.03,.06,12),.0,0,0,0,0,Math.PI/2));
  spokeGeos.forEach(sg=>{if(!sg.attributes.normal)sg.computeVertexNormals();});
  const rimGeo=mergeGeometries(spokeGeos,false);
  spokeGeos.forEach(sg=>sg.dispose());
  const discGeo=new THREE.CylinderGeometry(.198,.198,.022,rich?24:14);
  discGeo.rotateZ(Math.PI/2);

  const spinWheels=[],steerHubs=[];
  for(const x of [-.90,.90]) for(const z of [-1.36,1.36]){
    const hub=new THREE.Group();
    hub.position.set(x,wheelR,z);
    const spinner=new THREE.Group();
    const tire=new THREE.Mesh(tireGeo,rubber);tire.castShadow=true;spinner.add(tire);
    const rim=new THREE.Mesh(rimGeo,rimMat);rim.castShadow=true;spinner.add(rim);
    const disc=new THREE.Mesh(discGeo,discMat);spinner.add(disc);
    hub.add(spinner);
    const cal=new THREE.Group();
    const c1=new THREE.Mesh(new THREE.BoxGeometry(.06,.11,.16),caliperMat);
    c1.position.set(x<0?-.04:.04,.12,-.02);cal.add(c1);
    const c2=new THREE.Mesh(new THREE.BoxGeometry(.05,.07,.10),caliperMat);
    c2.position.set(x<0?-.04:.04,.12,.07);cal.add(c2);
    hub.add(cal);
    g.add(hub);
    spinWheels.push(spinner);
    if(z<0)steerHubs.push(hub);
  }

  g.userData={
    bodyMat,headMats:[headMat],tailMats:[tailMat],
    spinWheels,steerHubs,rearWing:wing,wheelRadius:wheelR,
    headlights:[]
  };
  return g;
}


const CAR_OPTIONS = {
  spectral: {
    id:"spectral", name:"Spectral GT RS", type:"Спортивное купе",
    builder:"hypercar",
    driverSide:1, spinAxis:"x", wheelRadius:.36,
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
  if(player?.userData.loadedModel?.userData.bodyMat)player.userData.loadedModel.userData.bodyMat.color.set(state.paint);
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
  player.userData.rollingWheels=[];
  player.userData.wheelSpinAxis=config.spinAxis;
  player.userData.wheelRadius=config.wheelRadius;
  player.userData.steeringWheel=null;
  player.userData.steeringWheelBase=null;
  player.userData.steerHubs=null;
  player.userData.rearWing=null;

  if(config.builder==="hypercar"){
    const model=makeHypercar(state.paint);
    player.add(model);
    player.userData.loadedModel=model;
    player.userData.rollingWheels=model.userData.spinWheels||[];
    player.userData.steerHubs=model.userData.steerHubs||[];
    player.userData.rearWing=model.userData.rearWing||null;
    player.userData.wheelRadius=config.wheelRadius||model.userData.wheelRadius||.36;
    player.userData.bodyShell=null;
    carPaintMaterial=model.userData.bodyMat||null;
    buildCockpit();
    model.visible=state.camera!==1;
    updateCarPaint();
    createPlayerDashboard();
    setLoadStatus(config.name+" · готов");
    if(state.camera===1)setMessage("Вид водителя · "+config.name,3);
    return;
  }

  playerFallback=makeCar(state.paint);
  player.add(playerFallback);
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
  const x=isPortraitView()?state.driverSide*.32:0;
  const y=1.68, z=-.915;
  if(mirrorFrame) mirrorFrame.position.set(x,y,z);
  if(mirrorMesh) mirrorMesh.position.set(x,y,z+.011);
  if(mirrorFallback) mirrorFallback.position.set(x,y,z+.011);
  if(cockpitGroup?.userData.mirrorStem) cockpitGroup.userData.mirrorStem.position.set(x,1.775,-.888);
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

function makeWheelLogoTexture(){
  const c=document.createElement("canvas");c.width=c.height=128;
  const g=c.getContext("2d");
  const rg=g.createRadialGradient(46,42,8,64,64,62);
  rg.addColorStop(0,"#3c444c");rg.addColorStop(1,"#0c1014");
  g.fillStyle=rg;g.beginPath();g.arc(64,64,62,0,Math.PI*2);g.fill();
  g.strokeStyle="#9aa3aa";g.lineWidth=4;g.beginPath();g.arc(64,64,56,0,Math.PI*2);g.stroke();
  g.fillStyle="#e8eef2";g.font="900 40px Manrope, system-ui, sans-serif";
  g.textAlign="center";g.textBaseline="middle";g.fillText("DH",64,68);
  const tex=new THREE.CanvasTexture(c);
  tex.colorSpace=THREE.SRGBColorSpace;tex.generateMipmaps=false;
  tex.minFilter=THREE.LinearFilter;tex.magFilter=THREE.LinearFilter;
  return tex;
}

function drawAnalogHud(speed){
  const canvas=$("analogHud");
  if(!canvas) return;
  const show=state.camera===1 && (state.running||state.paused);
  canvas.classList.toggle("is-on",show);
  canvas.setAttribute("aria-hidden", show?"false":"true");
  if(!show) return;
  const ctx=canvas.getContext("2d");
  const w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);
  const max=Math.max(260, carSpec().speedoMax||260);
  const step=max>400?50:10, major=max>400?100:20;
  drawAnalogGauge(ctx,w/2,h/2+8,Math.min(w,h)*0.36,Math.min(max,speed),max,{step,major,label:"SPEED",unit:"KM/H"});
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

  const dashMat=new THREE.MeshStandardMaterial({color:0x3b434b,roughness:.7,metalness:.1});
  const softMat=new THREE.MeshStandardMaterial({color:0x333a42,roughness:.88,metalness:.05});
  const headlinerMat=new THREE.MeshStandardMaterial({color:0x6e767e,roughness:.96,metalness:0});
  const pillarMat=new THREE.MeshStandardMaterial({color:0x3f464e,roughness:.8,metalness:.06});
  const doorMat=new THREE.MeshStandardMaterial({color:0x394149,roughness:.84,metalness:.05});
  const trimMat=new THREE.MeshStandardMaterial({color:digital?0x9aa3aa:0xc5ced2,roughness:digital?.38:.28,metalness:digital?.55:.78});
  const seatMat=new THREE.MeshStandardMaterial({color:0x4a5159,roughness:.92,metalness:.04});
  const carpetMat=new THREE.MeshStandardMaterial({color:0x2c3136,roughness:.97,metalness:0});
  const screenFrameMat=new THREE.MeshStandardMaterial({color:0x1b2228,roughness:.42,metalness:.18});
  const glowMat=new THREE.MeshStandardMaterial({color:0x1b3a40,emissive:digital?0x24c2c8:0x1a6a68,emissiveIntensity:rich?(digital?.45:.25):.12,roughness:.45});
  const glassMat=new THREE.MeshPhysicalMaterial({color:0xb7d4e0,roughness:.08,metalness:0,transparent:true,opacity:.035,side:THREE.DoubleSide,depthWrite:false});

  const dashGeos=[], headGeos=[], pillarGeos=[], doorGeos=[], trimGeos=[], carpetGeos=[], seatGeos=[];
  const boxGeo=(w,h,d,x,y,z,rx=0,ry=0,rz=0)=>{
    const g=new THREE.BoxGeometry(w,h,d);
    if(rx) g.rotateX(rx);
    if(ry) g.rotateY(ry);
    if(rz) g.rotateZ(rz);
    g.translate(x,y,z);
    return g;
  };
  const columnGeo=(w,d,ax,ay,az,bx,by,bz,extra=.08)=>{
    const a=new THREE.Vector3(ax,ay,az), b=new THREE.Vector3(bx,by,bz);
    const dir=b.clone().sub(a).normalize();
    a.addScaledVector(dir,-extra);b.addScaledVector(dir,extra);
    const g=new THREE.BoxGeometry(w,a.distanceTo(b),d);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),dir));
    g.translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);
    return g;
  };
  const meshFrom=(geos,mat)=>{
    if(!geos.length) return null;
    const prepared=geos.map(g=>{
      const ng=g.index?g.toNonIndexed():g;
      for(const key of Object.keys(ng.attributes)){
        if(key!=="position"&&key!=="normal"&&key!=="uv") ng.deleteAttribute(key);
      }
      if(ng.clearGroups) ng.clearGroups();
      return ng;
    });
    const merged=mergeGeometries(prepared,false);
    prepared.forEach(g=>g.dispose());
    if(!merged){
      geos.forEach(g=>{
        const mesh=new THREE.Mesh(g,mat);
        mesh.castShadow=true;mesh.receiveShadow=true;
        cockpitGroup.add(mesh);
      });
      return null;
    }
    merged.computeVertexNormals();
    const mesh=new THREE.Mesh(merged,mat);
    mesh.castShadow=true;mesh.receiveShadow=true;
    cockpitGroup.add(mesh);
    return mesh;
  };

  // One extruded dashboard spanning the full cabin width.
  const dashShape=new THREE.Shape();
  dashShape.moveTo(.52,.58);
  dashShape.lineTo(.58,.50);
  dashShape.lineTo(1.00,.52);
  dashShape.lineTo(1.06,.70);
  dashShape.quadraticCurveTo(1.075,.88,1.04,1.02);
  dashShape.lineTo(.96,1.04);
  dashShape.lineTo(.86,.99);
  dashShape.quadraticCurveTo(.74,.93,.58,.89);
  dashShape.lineTo(.48,.72);
  dashShape.closePath();
  const dashBody=new THREE.ExtrudeGeometry(dashShape,{
    depth:2.28,bevelEnabled:true,bevelThickness:.016,bevelSize:.014,bevelSegments:2,curveSegments:10
  });
  dashBody.rotateY(Math.PI/2);
  dashBody.translate(-1.14,0,0);
  dashBody.computeVertexNormals();
  const dashMesh=new THREE.Mesh(dashBody,dashMat);
  dashMesh.castShadow=true;dashMesh.receiveShadow=true;
  cockpitGroup.add(dashMesh);
  dashGeos.push(boxGeo(.38,.20,.36,0,.74,-.50,-.08));
  dashGeos.push(boxGeo(.32,.09,.90,0,.55,.04));
  dashGeos.push(boxGeo(.48,.26,.04,0,.95,-.73,.18));
  if(digital){
    dashGeos.push(boxGeo(.54,.024,.08,driverX,1.23,-.79,.42));
    dashGeos.push(boxGeo(.03,.15,.10,driverX-.255,1.145,-.84,.16));
    dashGeos.push(boxGeo(.03,.15,.10,driverX+.255,1.145,-.84,.16));
    dashGeos.push(boxGeo(.52,.16,.03,driverX,1.145,-.905,.14));
  }else{
    dashGeos.push(boxGeo(.76,.04,.16,driverX,1.16,-.90,.12));
    dashGeos.push(boxGeo(.74,.28,.04,driverX,1.02,-.975));
  }

  // Continuous headliner: ceiling, header rail and side window rails as one material.
  headGeos.push(boxGeo(2.32,.11,2.04,0,1.865,.18));
  headGeos.push(boxGeo(2.24,.12,.22,0,1.80,-.88));
  headGeos.push(boxGeo(.14,.12,1.92,-1.15,1.785,.10));
  headGeos.push(boxGeo(.14,.12,1.92,1.15,1.785,.10));
  headGeos.push(boxGeo(.42,.014,.16,-.48,1.795,-.70,.04));
  headGeos.push(boxGeo(.42,.014,.16,.48,1.795,-.70,.04));

  // A-pillars run from the dash outer corners into the header; B-pillars close the rear.
  for(const s of [-1,1]){
    pillarGeos.push(columnGeo(.14,.18,s*1.08,1.05,-1.02,s*1.14,1.82,-.84));
    pillarGeos.push(boxGeo(.13,.78,.16,s*1.15,1.44,.94));
    doorGeos.push(boxGeo(.11,.68,1.76,s*1.18,.76,.12));
    doorGeos.push(boxGeo(.13,.055,1.64,s*1.15,1.105,.08));
    doorGeos.push(boxGeo(.12,.07,.52,s*1.12,.90,.05));
  }

  carpetGeos.push(boxGeo(2.28,.06,2.18,0,.42,.14));
  carpetGeos.push(boxGeo(2.34,1.42,.14,0,1.10,1.24));
  for(const x of [-.49,.49]){
    seatGeos.push(boxGeo(.54,.13,.58,x,.52,.84));
    seatGeos.push(boxGeo(.54,.60,.15,x,.84,1.07,-.1));
    seatGeos.push(boxGeo(.32,.12,.12,x,1.12,1.12));
  }

  trimGeos.push(boxGeo(2.02,.007,.02,0,1.045,-.93,-.16));
  trimGeos.push(boxGeo(.08,.01,.18,0,1.795,-.70));
  for(const x of [-.44,.44,-.16,.16]){
    trimGeos.push(boxGeo(.15,.038,.028,x,.975,-.77,.12));
  }
  if(digital&&rich){
    trimGeos.push(boxGeo(1.4,.005,.01,0,.99,-.80));
  }

  meshFrom(dashGeos,dashMat);
  meshFrom(headGeos,headlinerMat);
  meshFrom(pillarGeos,pillarMat);
  meshFrom(doorGeos,doorMat);
  meshFrom(trimGeos,trimMat);
  meshFrom(carpetGeos,carpetMat);
  meshFrom(seatGeos,seatMat);

  // Soft-touch vent slats sit in the trim frames.
  for(const x of [-.44,.44,-.16,.16]){
    for(let i=-2;i<=2;i++){
      const slat=new THREE.Mesh(new THREE.BoxGeometry(.13,.003,.02),softMat);
      slat.position.set(x,.975+i*.006,-.755);
      slat.rotation.x=.12;
      cockpitGroup.add(slat);
    }
  }
  if(digital&&rich){
    const glow=new THREE.Mesh(new THREE.BoxGeometry(1.36,.004,.008),glowMat);
    glow.position.set(0,.992,-.795);
    cockpitGroup.add(glow);
  }

  const windshield=new THREE.Mesh(new THREE.PlaneGeometry(2.02,.78),glassMat);
  windshield.position.set(0,1.42,-.98);
  windshield.rotation.x=.18;
  windshield.renderOrder=2;
  cockpitGroup.add(windshield);

  const fill=new THREE.PointLight(0xffe6d2, rich?.62:.42, 4.4, 1.15);
  fill.position.set(0,1.52,-.05);
  cockpitGroup.add(fill);
  if(rich){
    const wash=new THREE.PointLight(0xcfe0ea,.28,3.2,1.3);
    wash.position.set(0,1.48,-.85);
    cockpitGroup.add(wash);
  }

  // Full round modern wheel with a center logo.
  steeringWheelVisual=new THREE.Group();
  steeringWheelVisual.position.set(driverX,1.01,-.54);
  steeringWheelVisual.rotation.x=.1;
  cockpitGroup.add(steeringWheelVisual);
  const wheelMat=new THREE.MeshStandardMaterial({color:0x2a3036,roughness:.5,metalness:.16});
  const carbon=new THREE.MeshStandardMaterial({color:0x3a424a,roughness:.36,metalness:.5});
  steeringWheelVisual.add(new THREE.Mesh(new THREE.TorusGeometry(.158,.02,16,72),wheelMat));
  steeringWheelVisual.add(new THREE.Mesh(new THREE.TorusGeometry(.141,.004,8,56),carbon));
  const hub=new THREE.Mesh(new THREE.CylinderGeometry(.036,.04,.028,28),carbon);
  hub.rotation.x=Math.PI/2;hub.position.z=.012;steeringWheelVisual.add(hub);
  for(const [x,y,a] of [[0,.07,0],[-.06,-.036,-.95],[.06,-.036,.95]]){
    const spoke=new THREE.Mesh(new THREE.BoxGeometry(.018,.112,.016),carbon);
    spoke.position.set(x,y,.01);spoke.rotation.z=a;steeringWheelVisual.add(spoke);
  }
  const logo=new THREE.Mesh(new THREE.CircleGeometry(.028,28),new THREE.MeshBasicMaterial({map:makeWheelLogoTexture(),toneMapped:false}));
  logo.position.z=.027;steeringWheelVisual.add(logo);
  if(rich){
    const btn=new THREE.MeshStandardMaterial({color:0x1a2026,emissive:0x1ad0c8,emissiveIntensity:.3});
    for(const x of [-.028,.028]){
      const b=new THREE.Mesh(new THREE.BoxGeometry(.015,.011,.01),btn);
      b.position.set(x,.01,.028);steeringWheelVisual.add(b);
    }
  }

  const clusterCanvas=document.createElement("canvas");clusterCanvas.width=1024;clusterCanvas.height=512;
  cockpitGaugeContext=clusterCanvas.getContext("2d");
  cockpitGaugeTexture=new THREE.CanvasTexture(clusterCanvas);cockpitGaugeTexture.colorSpace=THREE.SRGBColorSpace;
  cockpitGaugeTexture.anisotropy=8;cockpitGaugeTexture.generateMipmaps=false;
  cockpitGaugeTexture.minFilter=THREE.LinearFilter;cockpitGaugeTexture.magFilter=THREE.LinearFilter;
  const clusterScreen=new THREE.Mesh(
    digital?new THREE.PlaneGeometry(.50,.16):new THREE.PlaneGeometry(.68,.24),
    new THREE.MeshBasicMaterial({map:cockpitGaugeTexture,side:THREE.DoubleSide,toneMapped:false})
  );
  if(digital){clusterScreen.position.set(driverX,1.155,-.81);clusterScreen.rotation.x=.18;}
  else {clusterScreen.position.set(driverX,1.02,-.92);clusterScreen.rotation.x=.08;}
  clusterScreen.renderOrder=10;cockpitGroup.add(clusterScreen);

  const centerCanvas=document.createElement("canvas");centerCanvas.width=768;centerCanvas.height=480;
  cockpitCenterContext=centerCanvas.getContext("2d");
  cockpitCenterTexture=new THREE.CanvasTexture(centerCanvas);cockpitCenterTexture.colorSpace=THREE.SRGBColorSpace;
  cockpitCenterTexture.generateMipmaps=false;cockpitCenterTexture.minFilter=THREE.LinearFilter;cockpitCenterTexture.magFilter=THREE.LinearFilter;
  const centerScreen=new THREE.Mesh(
    digital?new THREE.PlaneGeometry(.42,.24):new THREE.PlaneGeometry(.38,.22),
    new THREE.MeshBasicMaterial({map:cockpitCenterTexture,side:THREE.DoubleSide,toneMapped:false})
  );
  if(digital){centerScreen.position.set(0,.95,-.70);centerScreen.rotation.x=.18;}
  else {centerScreen.position.set(0,.96,-.72);centerScreen.rotation.x=.25;}
  centerScreen.renderOrder=10;cockpitGroup.add(centerScreen);

  const stem=new THREE.Mesh(new THREE.CylinderGeometry(.008,.011,.07,10),trimMat);
  stem.position.set(0,1.775,-.888);
  stem.rotation.x=.15;
  cockpitGroup.add(stem);
  cockpitGroup.userData.mirrorStem=stem;

  mirrorFrame=new THREE.Mesh(new THREE.BoxGeometry(.32,.1,.018),trimMat);
  mirrorFrame.position.set(0,1.68,-.915);
  cockpitGroup.add(mirrorFrame);
  mirrorFallback=null;
  if(state.qualityLevel!=="low"){
    mirrorRT=new THREE.WebGLRenderTarget(384,160,{colorSpace:THREE.SRGBColorSpace});
    mirrorCam=new THREE.PerspectiveCamera(58,384/160,.15,280);
    mirrorMesh=new THREE.Mesh(
      new THREE.PlaneGeometry(.285,.088),
      new THREE.MeshBasicMaterial({map:mirrorRT.texture,toneMapped:false})
    );
    mirrorMesh.position.set(0,1.68,-.904);mirrorMesh.renderOrder=11;cockpitGroup.add(mirrorMesh);
  }else{
    mirrorFallback=new THREE.Mesh(new THREE.BoxGeometry(.285,.088,.01),new THREE.MeshStandardMaterial({color:0x5a6a74,roughness:.12,metalness:.4}));
    mirrorFallback.position.set(0,1.68,-.904);
    cockpitGroup.add(mirrorFallback);
  }

  for(const s of [-1,1]){
    const housing=new THREE.Mesh(new THREE.BoxGeometry(.05,.04,.12),dashMat);
    housing.position.set(s*1.36,1.17,-.68);
    housing.rotation.set(.08,s*.34,0);
    cockpitGroup.add(housing);
    const glass=new THREE.Mesh(new THREE.PlaneGeometry(.11,.065),new THREE.MeshStandardMaterial({color:0x7e96a4,roughness:.08,metalness:.35}));
    glass.position.set(s*1.40,1.17,-.62);
    glass.rotation.y=s*-.4;
    cockpitGroup.add(glass);
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
  const cap=carSpec().speedoMax||800;
  const redline=carSpec().redline||8500;
  const bg=c.createLinearGradient(0,0,0,512);
  bg.addColorStop(0,"#24303a");bg.addColorStop(1,"#10161c");
  c.fillStyle=bg;c.fillRect(0,0,1024,512);
  c.fillStyle="#1ad8c8";c.fillRect(0,0,1024,4);
  c.fillStyle="rgba(255,255,255,.1)";c.fillRect(72,32,880,12);
  const t=clamp(rpm/redline,0,1);
  const grd=c.createLinearGradient(72,0,952,0);
  grd.addColorStop(0,"#2cf0d6");grd.addColorStop(.72,"#f0d08a");grd.addColorStop(1,"#ff4a38");
  c.fillStyle=grd;c.fillRect(72,32,880*t,12);
  c.fillStyle="rgba(220,230,236,.55)";c.font="700 16px Manrope, sans-serif";c.textAlign="center";
  c.fillText("RPM  "+Math.round(rpm).toLocaleString("en-US"),512,68);
  c.fillStyle="#dce4ea";c.font="800 120px Manrope, sans-serif";
  c.fillText(String(Math.min(cap,Math.round(Math.abs(speed)))).padStart(3,"0"),430,248);
  c.fillStyle="#8fa3ad";c.font="800 22px Manrope, sans-serif";c.fillText("KM/H",430,292);
  c.fillStyle="#12181e";
  if(c.roundRect){c.beginPath();c.roundRect(700,152,176,156,16);c.fill();}
  else c.fillRect(700,152,176,156);
  c.fillStyle="#7fdad4";c.font="800 16px Manrope, sans-serif";c.fillText("GEAR",788,190);
  c.fillStyle="#f5c58a";c.font="900 72px Manrope, sans-serif";c.fillText(String(gear),788,272);
  c.fillStyle="#5ee0c8";c.font="800 13px Manrope, sans-serif";c.fillText("RACE",788,298);
  const fuel=clamp(1-(state.totalDistance||0)/180000,.14,1);
  const temp=clamp(.32+Math.abs(rpm)/9000*.5,.3,.95);
  const bar=(x,y,label,ratio,ok)=>{
    c.fillStyle="#8fa3ad";c.font="700 12px Manrope, sans-serif";c.textAlign="left";c.fillText(label,x,y);
    c.fillStyle="rgba(255,255,255,.1)";c.fillRect(x+58,y-10,160,7);
    c.fillStyle=ok?"#6fd9d6":"#fb6b55";c.fillRect(x+58,y-10,160*ratio,7);
  };
  bar(48,430,"FUEL",fuel,fuel>.2);
  bar(758,430,"TEMP",temp,temp<.82);
  const lamps=[
    ["L", Math.abs(state.steer)>.55 && (clock.now%0.7)<0.35 && state.steer<0, "#59e08a"],
    ["R", Math.abs(state.steer)>.55 && (clock.now%0.7)<0.35 && state.steer>0, "#59e08a"],
    ["LED", state.time==="night", "#f0d08a"],
    ["P", !!(controls.handbrake||hardware.handbrake), "#fb6b55"],
    ["!", state.damage>45, "#fb6b55"]
  ];
  lamps.forEach((lamp,i)=>{
    const x=300+i*90,y=468;
    c.fillStyle=lamp[1]?lamp[2]:"#22292e";
    c.beginPath();c.arc(x,y,10,0,Math.PI*2);c.fill();
    c.fillStyle=lamp[1]?"#081014":"#667176";
    c.font="800 11px Manrope, sans-serif";c.textAlign="center";c.fillText(lamp[0],x,y+4);
  });
  c.fillStyle="#8fa3ad";c.font="700 13px Manrope, sans-serif";c.textAlign="center";
  c.fillText("ODO  "+((state.distance||0)/1000).toFixed(1)+" km    TRIP  "+((state.totalDistance||0)/1000).toFixed(2)+" km",512,500);
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
    drawAnalogHud(speed);
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
  drawAnalogHud(speed);
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
  updateSpeedLines();
  setMessage(state.camera===1?"Вид водителя · настоящий салон и приборная панель":"Вид снаружи · камера преследования");
}
function cycleCameraMode(){
  state.camera=(state.camera+1)%4;
  updateCameraButton();
  syncViewClasses();
  updateSpeedLines();
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
  if (crack) {
    const o = state.damage>1 ? clamp(state.damage / 140, 0, 0.72) : 0;
    crack.style.opacity = String(o);
    crack.classList.toggle("is-on", o>0.02);
    crack.setAttribute("aria-hidden", o>0.02?"false":"true");
  }
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
  apply(player?.userData.loadedModel);
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

function applyDebugViewLock(){
  if(!debugViewLock||!player||!camera)return;
  const views={
    side:{p:[5.8,1.15,.2],l:[0,.58,.12]},
    front:{p:[1.15,1.02,-6.5],l:[0,.52,.25]},
    rear:{p:[0,1.35,6.6],l:[0,.58,0]},
    threeq:{p:[3.7,1.4,5.3],l:[0,.52,0]},
    hood3q:{p:[3.3,1.45,-4.9],l:[0,.48,0]}
  };
  const v=views[debugViewLock];
  if(!v)return;
  camera.position.copy(player.localToWorld(new THREE.Vector3(v.p[0],v.p[1],v.p[2])));
  camera.lookAt(player.localToWorld(new THREE.Vector3(v.l[0],v.l[1],v.l[2])));
  if(Math.abs(camera.fov-42)>.2){camera.fov=42;camera.updateProjectionMatrix();}
}

function cockpitCameraRig(){
  const eyeX=state.driverSide*.49;
  const x=eyeX;
  if(isPortraitView()) return {x,y:1.32,z:.34,lookX:x*.12,lookY:1.22,lookZ:-40,fov:60};
  if(isMobile) return {x,y:1.30,z:.48,lookX:x*.10,lookY:1.24,lookZ:-42,fov:58};
  return {x,y:1.30,z:.42,lookX:x*.08,lookY:1.24,lookZ:-44,fov:54};
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
  if(player.userData.steerHubs)player.userData.steerHubs.forEach(h=>{h.rotation.y=state.steer*.34;});
  if(player.userData.rearWing){
    const kmh=Math.abs(state.speed)*3.6;
    const t=clamp((kmh-60)/280,0,1);
    player.userData.rearWing.rotation.x=.10+t*.30;
  }
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
  const rig=cockpitCameraRig();
  const eyeY=rig.y,eyeZ=rig.z;
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
  const lookY=state.camera===1?rig.lookY:1.58;
  const look=state.camera===3?player.position.clone():state.camera===1?player.localToWorld(new THREE.Vector3(rig.lookX,lookY,rig.lookZ)):state.camera===2?player.localToWorld(new THREE.Vector3(0,1.2,-30)):player.position.clone().addScaledVector(tan,5).add(new THREE.Vector3(0,.8,0));
  camera.lookAt(look);
  if(debugViewLock) applyDebugViewLock();
  syncViewClasses();
  const baseFov=state.camera===1?rig.fov:(isMobile?69:62);
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
  updateSpeedLines();
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
  lines.setAttribute("aria-hidden", show?"false":"true");
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
  const crack=$("crackOverlay"); if(crack){crack.style.opacity="0";crack.classList.remove("is-on");crack.setAttribute("aria-hidden","true");}
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
    camera=new THREE.PerspectiveCamera(62,window.innerWidth/window.innerHeight,.08,2800);
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
      setViewLock(kind){
        debugViewLock=kind||null;
        if(!debugViewLock){
          if(camera&&Math.abs(camera.fov-62)>.5){camera.fov=62;camera.updateProjectionMatrix();}
        }
        return debugViewLock;
      },
      getCockpitMetrics(){
        if(!camera||!steeringWheelVisual) return null;
        const rim=0.158, ys=[];
        let minX=1,maxX=-1,minY=1,maxY=-1,off=0;
        for(let i=0;i<24;i++){
          const a=(i/24)*Math.PI*2;
          const p=steeringWheelVisual.localToWorld(new THREE.Vector3(Math.cos(a)*rim,Math.sin(a)*rim,0)).project(camera);
          minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x);
          minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y);
          ys.push(p.y);
          if(Math.abs(p.x)>1||Math.abs(p.y)>1) off++;
        }
        return {
          fov:camera.fov, aspect:camera.aspect, portrait:isPortraitView(),
          wheel:{minX,maxX,minY,maxY, heightNdc:maxY-minY, offscreen:off},
          wheelInView:off===0 && minY>-0.90 && maxY<0.98 && minX>-0.98 && maxX<0.98
        };
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
    if(player?.userData.loadedModel&&CAR_OPTIONS[state.car]?.builder==="hypercar") setLoadStatus(CAR_OPTIONS[state.car].name+" · готов");
    else setLoadStatus("Трасса готова. Загружается "+CAR_OPTIONS[state.car].name+"…");
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
