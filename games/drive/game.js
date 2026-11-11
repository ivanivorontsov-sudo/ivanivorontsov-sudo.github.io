import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/postprocessing/OutputPass.js";

const $ = (id) => document.getElementById(id);
const sceneHost = $("scene");
const isMobile = matchMedia("(max-width: 700px)").matches || ("ontouchstart" in window);
const state = {
  time: "sunset", paint: "#e5e8eb", quality: true, camera: 0,
  running: false, paused: false, speed: 0, distance: 0, progress: 0,
  lateral: 0, steer: 0, steerInput: 0, totalDistance: 0, hitCooldown: 0,
  messageTimer: 0, soundOn: true, gamepadIndex: null

};
const controls = { gas:false, brake:false, left:false, right:false, handbrake:false };
let renderer, composer, bloomPass, scene, camera, curve, trackLength, player, playerFallback, carPaintMaterial;
let cockpitGroup, steeringWheelVisual, cockpitPaintMaterial, cockpitGaugeContext, cockpitGaugeTexture, cockpitGaugeLast=0, inputTelemetryTimer=0;
const hardware = { steer:0, throttle:0, brake:0, handbrake:false };
const inputConfig = { steer:"axis0", gas:"button7", brake:"button6", handbrake:"button0", invertSteer:false, invertGas:false, invertBrake:false, pedalsPositive:false, sensitivity:1.25 };
let skyTexture, skyCanvas, skyContext, sun, directionalLight, ambientLight, stars;
let roadTexture, grassTexture, minimapContext, audioContext, engineOsc, engineGain;
let traffic = [], lastFrame = performance.now(), frameCount = 0, fpsTime = 0;
const clock = { now: 0 };
const TRACK_POINTS = [
  new THREE.Vector3(0,.8,-155), new THREE.Vector3(78,1.15,-143),
  new THREE.Vector3(145,.75,-72), new THREE.Vector3(153,1.35,34),
  new THREE.Vector3(88,1.1,135), new THREE.Vector3(-8,.8,164),
  new THREE.Vector3(-112,.95,112), new THREE.Vector3(-168,1.3,18),
  new THREE.Vector3(-119,.8,-107)
];
const PALETTES = {
  sunset: { top:"#214366", middle:"#e28c74", horizon:"#ffd4a1", fog:0xc88e79, ambient:.74, direct:2.15 },
  day:    { top:"#4288ad", middle:"#9ccbd0", horizon:"#e2e8cf", fog:0xa5c6c2, ambient:1.08, direct:2.75 },
  night:  { top:"#071326", middle:"#172e4a", horizon:"#34465c", fog:0x1b2b40, ambient:.35, direct:.22 }
};

function seeded(seed) {
  let value = seed >>> 0;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
}
const rand = seeded(20261111);
const vecRight = (tangent) => new THREE.Vector3(-tangent.z,0,tangent.x).normalize();
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

function canvasTexture(kind, size=512) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (kind === "road") {
    ctx.fillStyle = "#30353a"; ctx.fillRect(0,0,size,size);
    for (let i=0;i<4600;i++) {
      const v = Math.floor(65 + rand()*75);
      ctx.fillStyle = "rgba("+v+","+v+","+v+","+(0.07+rand()*0.23)+")";
      const x=rand()*size,y=rand()*size,r=rand()*1.65+0.25;
      ctx.fillRect(x,y,r,r);
    }
    for(let i=0;i<42;i++){
      ctx.strokeStyle="rgba(8,12,16,.11)";ctx.lineWidth=rand()*2+0.5;
      ctx.beginPath();ctx.moveTo(rand()*size,rand()*size);ctx.lineTo(rand()*size,rand()*size);ctx.stroke();
    }
  } else {
    ctx.fillStyle="#63865b";ctx.fillRect(0,0,size,size);
    for(let i=0;i<8500;i++){
      const g=Math.floor(78+rand()*75),r=Math.floor(45+rand()*35),b=Math.floor(38+rand()*25);
      ctx.fillStyle="rgba("+r+","+g+","+b+","+(0.08+rand()*0.2)+")";
      const x=rand()*size,y=rand()*size,s=rand()*3+0.5;ctx.fillRect(x,y,s,s);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
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
  const halo = new THREE.Mesh(new THREE.SphereGeometry(15,24,16),new THREE.MeshBasicMaterial({color:0xffc58b,transparent:true,opacity:.16,depthWrite:false}));
  halo.position.copy(sun.position); scene.add(halo);
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
  scene.fog.color.setHex(p.fog);
  ambientLight.intensity=p.ambient;
  directionalLight.intensity=p.direct;
  directionalLight.color.set(mode==="night"?0x9bb8e4:0xffe2c1);
  sun.visible=mode!=="night";stars.visible=mode==="night";
  const lights=player?.userData.headlights||playerFallback?.userData.headlights;
  if(lights)lights.forEach(l=>l.visible=mode==="night");
  const label = mode==="day"?"День":mode==="night"?"Ночь":"Закат";
  $("timeBtn").querySelector("#timeIcon").textContent=mode==="day"?"☀️":mode==="night"?"🌙":"🌇";
  $("timeBtn").querySelector(".btn-label").textContent=label;
  document.querySelectorAll(".mode-btn").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));
}

function addRibbon(offset, width, material, yOffset=0.035) {
  const segments=1200, positions=[], uvs=[], indices=[];
  for(let i=0;i<=segments;i++){
    const t=i/segments,p=curve.getPointAt(t),tan=curve.getTangentAt(t),right=vecRight(tan);
    const center=p.clone().addScaledVector(right,offset);
    const a=center.clone().addScaledVector(right,-width/2);const b=center.clone().addScaledVector(right,width/2);
    a.y+=yOffset;b.y+=yOffset;
    positions.push(a.x,a.y,a.z,b.x,b.y,b.z);
    uvs.push(0,t*50,1,t*50);
    if(i<segments){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();
  const mesh=new THREE.Mesh(g,material);mesh.receiveShadow=true;scene.add(mesh);return mesh;
}

function buildTrack() {
  curve = new THREE.CatmullRomCurve3(TRACK_POINTS,true,"catmullrom",0.42);
  trackLength=curve.getLength();
  roadTexture=canvasTexture("road",1024);
  roadTexture.repeat.set(1.4,1);
  const asphalt=new THREE.MeshStandardMaterial({map:roadTexture,color:0xffffff,roughness:.93,metalness:.03});
  const shoulder=new THREE.MeshStandardMaterial({color:0x555a5c,roughness:1});
  const lineMat=new THREE.MeshStandardMaterial({color:0xe7e7dc,roughness:.75});
  addRibbon(0,20,asphalt,.04);
  addRibbon(-10.45,1.05,shoulder,.035);addRibbon(10.45,1.05,shoulder,.035);
  addRibbon(-9.48,.16,lineMat,.075);addRibbon(9.48,.16,lineMat,.075);
  const dashGeo=new THREE.BoxGeometry(.14,.035,6.2);
  const dashMat=new THREE.MeshStandardMaterial({color:0xf4f1dc,roughness:.8,emissive:0x151410});
  const dashCount=Math.ceil(trackLength/16)*2+2;
  const dashes=new THREE.InstancedMesh(dashGeo,dashMat,dashCount);
  const dummy=new THREE.Object3D();let k=0;
  for(let t=0;t<1;t+=16/trackLength){
    const p=curve.getPointAt(t),tan=curve.getTangentAt(t),right=vecRight(tan);
    const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),tan);
    for(const lane of [-3.28,3.28]){
      dummy.position.copy(p).addScaledVector(right,lane);dummy.position.y+=.085;
      dummy.quaternion.copy(q);dummy.scale.set(1,1,1);dummy.updateMatrix();dashes.setMatrixAt(k++,dummy.matrix);
    }
  }
  dashes.count=k;dashes.instanceMatrix.needsUpdate=true;scene.add(dashes);
  const railMat=new THREE.MeshStandardMaterial({color:0x9aa4a8,metalness:.72,roughness:.35});
  for(const side of [-1,1]){
    const pts=[];
    for(let i=0;i<=600;i++){
      const t=i/600,p=curve.getPointAt(t),tan=curve.getTangentAt(t),r=vecRight(tan);
      pts.push(p.addScaledVector(r,side*10.8).add(new THREE.Vector3(0,1.05,0)));
    }
    const railCurve=new THREE.CatmullRomCurve3(pts,true,"catmullrom",.15);
    const rail=new THREE.Mesh(new THREE.TubeGeometry(railCurve,1200,.095,7,true),railMat);
    rail.castShadow=true;scene.add(rail);
    for(let t=.012;t<1;t+=.035){
      const p=curve.getPointAt(t),tan=curve.getTangentAt(t),r=vecRight(tan);
      const post=new THREE.Mesh(new THREE.BoxGeometry(.11,1.05,.12),railMat);
      post.position.copy(p).addScaledVector(r,side*10.8);post.position.y+=.52;scene.add(post);
    }
  }
}

function addMountains() {
  const rockMat=new THREE.MeshStandardMaterial({color:0x718488,roughness:.96,metalness:.02});
  const snowMat=new THREE.MeshStandardMaterial({color:0xe3e8e4,roughness:.9});
  for(let i=0;i<34;i++){
    const a=rand()*Math.PI*2,d=260+rand()*180,h=48+rand()*100,w=32+rand()*58;
    const x=Math.cos(a)*d,z=Math.sin(a)*d;
    const m=new THREE.Mesh(new THREE.ConeGeometry(w,h,32,8),rockMat);
    m.position.set(x,h/2-8,z);m.rotation.y=rand()*Math.PI;m.rotation.z=(rand()-.5)*.12;m.castShadow=true;scene.add(m);
    if(h>90){
      const cap=new THREE.Mesh(new THREE.ConeGeometry(w*.31,h*.22,24,3),snowMat);
      cap.position.set(x,h*.88-8,z);cap.rotation.y=m.rotation.y;scene.add(cap);
    }
  }
}

function addForest() {
  const trunkGeo=new THREE.CylinderGeometry(.12,.22,2.6,6);
  const crownGeo=new THREE.ConeGeometry(1.55,4.4,16,3);
  const trunkMat=new THREE.MeshStandardMaterial({color:0x604a38,roughness:1});
  const leafMats=[
    new THREE.MeshStandardMaterial({color:0x315b4a,roughness:.94}),
    new THREE.MeshStandardMaterial({color:0x416c53,roughness:.94}),
    new THREE.MeshStandardMaterial({color:0x547d5b,roughness:.94})
  ];
  const count=520;
  const trunks=new THREE.InstancedMesh(trunkGeo,trunkMat,count);
  const crowns=leafMats.map(mat=>new THREE.InstancedMesh(crownGeo,mat,count));
  const dummy=new THREE.Object3D();
  for(let i=0;i<count;i++){
    const t=rand(),p=curve.getPointAt(t),tan=curve.getTangentAt(t),r=vecRight(tan);
    const side=rand()>.5?1:-1,dist=14+rand()*88;
    const x=p.x+r.x*side*dist,z=p.z+r.z*side*dist;
    const s=.62+rand()*.82;
    dummy.position.set(x,-.15+1.3*s,z);dummy.rotation.y=rand()*Math.PI*2;dummy.scale.set(s,s,s);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
    const q=Math.floor(rand()*3);dummy.position.set(x,1.5+3*s,z);dummy.scale.set(s,s,s);dummy.rotation.y=rand()*Math.PI*2;dummy.updateMatrix();crowns[q].setMatrixAt(i,dummy.matrix);
  }
  trunks.instanceMatrix.needsUpdate=true;trunks.castShadow=false;scene.add(trunks);
  crowns.forEach(mesh=>{mesh.instanceMatrix.needsUpdate=true;mesh.castShadow=false;scene.add(mesh);});
  const bushGeo=new THREE.DodecahedronGeometry(1,0);
  const bushMat=new THREE.MeshStandardMaterial({color:0x55785a,roughness:1,flatShading:true});
  const bushes=new THREE.InstancedMesh(bushGeo,bushMat,260);
  for(let i=0;i<260;i++){
    const t=rand(),p=curve.getPointAt(t),tan=curve.getTangentAt(t),r=vecRight(tan),side=rand()>.5?1:-1;
    dummy.position.set(p.x+r.x*side*(11+rand()*18),-.35,p.z+r.z*side*(11+rand()*18));
    const s=.45+rand()*1.25;dummy.scale.set(s,s*.55,s);dummy.rotation.set(rand(),rand(),rand());dummy.updateMatrix();bushes.setMatrixAt(i,dummy.matrix);
  }
  bushes.instanceMatrix.needsUpdate=true;scene.add(bushes);
}

function addStreetFurniture() {
  const postMat=new THREE.MeshStandardMaterial({color:0x42535b,metalness:.45,roughness:.6});
  const lampMat=new THREE.MeshStandardMaterial({color:0xffe0aa,emissive:0xffbc73,emissiveIntensity:1.6});
  for(let t=.025;t<1;t+=.075){
    const p=curve.getPointAt(t),tan=curve.getTangentAt(t),r=vecRight(tan);
    const g=new THREE.Group();g.position.copy(p).addScaledVector(r,13.5);g.position.y+=.15;
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.07,.12,7.2,8),postMat);pole.position.y=3.6;g.add(pole);
    const arm=new THREE.Mesh(new THREE.BoxGeometry(.11,.12,2.2),postMat);arm.position.set(-.9,7.05,0);g.add(arm);
    const lamp=new THREE.Mesh(new THREE.BoxGeometry(.58,.18,.42),lampMat);lamp.position.set(-1.85,6.95,0);g.add(lamp);
    scene.add(g);
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

function buildWorld() {
  grassTexture=canvasTexture("grass",1024);
  grassTexture.repeat.set(90,90);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(1800,1800),new THREE.MeshStandardMaterial({map:grassTexture,color:0xffffff,roughness:1}));
  ground.rotation.x=-Math.PI/2;ground.position.y=0;ground.receiveShadow=true;scene.add(ground);
  const distantGround=new THREE.Mesh(new THREE.PlaneGeometry(4000,4000),new THREE.MeshStandardMaterial({color:0x5d785d,roughness:1}));
  distantGround.rotation.x=-Math.PI/2;distantGround.position.y=-2.1;scene.add(distantGround);
  buildTrack();addMountains();addForest();addStreetFurniture();addPitStop();
}

function makeCar(color) {
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
  for(const x of [-.72,.72]){
    const light=new THREE.SpotLight(0xf3e5c3,32,58,Math.PI/7,.4,1.2);
    light.position.set(x,.88,-1.8);light.target.position.set(x,0,-24);g.add(light);g.add(light.target);headlights.push(light);
  }
  g.userData={wheels,headlights,bodyMat};
  return g;
}

function updateCarPaint(){
  if(playerFallback?.userData.bodyMat)playerFallback.userData.bodyMat.color.set(state.paint);
  if(player?.userData.loadedModel)player.userData.loadedModel.traverse(obj=>{
    if(!obj.isMesh)return;
    const mats=Array.isArray(obj.material)?obj.material:[obj.material];
    mats.forEach(m=>{
      const n=(m.name||"").toLowerCase();
      if(n.includes("colormap")||n.includes("paint")||n.includes("body paint"))m.color.set(state.paint);
    });
  });
}

function loadDefaultCar(){
  const loader=new GLTFLoader();
  const url="https://raw.githubusercontent.com/ivanivorontsov-sudo/car-simulator/main/assets/models/cars/suv.glb";
  loader.load(url,(gltf)=>{
    if(!player)return;
    const model=gltf.scene;
    // У обычного Kenney SUV перед направлен вдоль +Z; разворачиваем к дороге (-Z).
    model.rotation.y=Math.PI;
    model.updateMatrixWorld(true);
    const originalBounds=new THREE.Box3().setFromObject(model);
    const originalSize=originalBounds.getSize(new THREE.Vector3());
    const fitScale=4.35/(Math.max(originalSize.x,originalSize.z)||2.7);
    model.scale.setScalar(fitScale);
    model.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(model);
    model.position.y-=bounds.min.y;
    const rollingWheels=[];
    model.traverse(obj=>{
      if(!obj.isMesh)return;
      obj.castShadow=true;obj.receiveShadow=true;
      if(Array.isArray(obj.material))obj.material=obj.material.map(m=>m.clone());
      else if(obj.material)obj.material=obj.material.clone();
      const mats=Array.isArray(obj.material)?obj.material:[obj.material];
      mats.forEach(m=>{if((m.name||"").toLowerCase().includes("colormap"))m.color.set(state.paint);});
      // В GLB ось X проходит через ступицу; геометрия колеса лежит в плоскости YZ.
      if(/^wheel-(front|back)-(left|right)$/i.test(obj.name))rollingWheels.push(obj);
    });
    // Fallback — отдельная дочерняя группа, поэтому заменяем только её.
    if(playerFallback){player.remove(playerFallback);playerFallback=null;}
    player.add(model);
    player.userData.loadedModel=model;
    player.userData.rollingWheels=rollingWheels;
    player.userData.wheelRadius=.30*fitScale;
    player.updateMatrixWorld(true);
    $("loadStatus").textContent="Обычный дорожный SUV готов. Можно выезжать.";
    updateCarPaint();
    createPlayerDashboard();
    if(state.camera===1)setMessage("Вид водителя · салон обычного автомобиля",3);
  },undefined,(error)=>{
    console.warn("Default SUV unavailable; keeping fallback car",error);
    $("loadStatus").textContent="Модель SUV не загрузилась · используется резервный автомобиль.";
  });
}

function createTraffic() {
  const palette=["#f2f0e9","#2585b9","#d0a04e","#5e7782","#c84a3b","#303844"];
  for(let i=0;i<8;i++){
    const color=palette[i%palette.length],visual=makeCar(color);
    visual.scale.setScalar(.88);scene.add(visual);
    traffic.push({visual,progress:(.06+i*.117)%1,offset:[-5.7,0,5.7][i%3],speed:23+rand()*12,wiggle:rand()*Math.PI*2,hit:false});
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
  const here=map(curve.getPointAt(state.progress));
  c.beginPath();c.arc(here.x,here.y,6,0,Math.PI*2);c.fillStyle="#72e1d7";c.shadowColor="#72e1d7";c.shadowBlur=12;c.fill();c.shadowBlur=0;
  c.beginPath();c.arc(90,90,75,0,Math.PI*2);c.strokeStyle="rgba(255,255,255,.07)";c.lineWidth=1;c.stroke();
}

function setMessage(text,duration=2.3) {
  $("message").textContent=text;state.messageTimer=duration;
}
function initAudio() {
  if(!state.soundOn || audioContext)return;
  try{
    audioContext=new (window.AudioContext||window.webkitAudioContext)();
    engineOsc=audioContext.createOscillator();engineOsc.type="sawtooth";engineOsc.frequency.value=42;
    const filter=audioContext.createBiquadFilter();filter.type="lowpass";filter.frequency.value=240;
    engineGain=audioContext.createGain();engineGain.gain.value=.0001;
    engineOsc.connect(filter);filter.connect(engineGain);engineGain.connect(audioContext.destination);engineOsc.start();
  }catch(e){console.warn("Audio unavailable",e);}
}
function updateAudio() {
  if(!audioContext||!engineOsc||!engineGain)return;
  const now=audioContext.currentTime;
  engineOsc.frequency.setTargetAtTime(42+Math.max(0,state.speed)*1.8,now,.08);
  engineGain.gain.setTargetAtTime(state.running&&!state.paused?0.035:0.0001,now,.12);
}
function cameraLabel(){return ["Погоня","Кабина","Капот","Сверху"][state.camera]||"Погоня";}
function updateCameraButton(){
  const label=cameraLabel(),button=$("cameraBtn");
  button.querySelector(".btn-label").textContent=label;
  button.setAttribute("aria-label","Камера: "+label);
  button.title="Камера: "+label+" · нажми для переключения вида";
}
function setCameraMode(){
  // Сенсорная кнопка всегда переключает только между видом снаружи и салоном.
  state.camera=state.camera===1?0:1;
  updateCameraButton();
  setMessage(state.camera===1?"Вид водителя · настоящий салон и приборная панель":"Вид снаружи · камера преследования");
}
function cycleCameraMode(){
  state.camera=(state.camera+1)%4;
  updateCameraButton();
  setMessage("Камера: "+cameraLabel());
}

function buildCockpit(){
  // Procedural cabin pieces are attached to the car root, not to the camera.
  cockpitGroup=new THREE.Group();
  player.add(cockpitGroup);
  cockpitGroup.visible=false;
  const dashMat=new THREE.MeshStandardMaterial({color:0x151c22,roughness:.62,metalness:.12});
  const softMat=new THREE.MeshStandardMaterial({color:0x090d12,roughness:.86});
  const trimMat=new THREE.MeshStandardMaterial({color:0x56616a,roughness:.38,metalness:.55});
  const seatMat=new THREE.MeshStandardMaterial({color:0x252a30,roughness:.92});
  const box=(w,h,d,mat,x,y,z,rx=0,ry=0,rz=0)=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
    mesh.position.set(x,y,z);mesh.rotation.set(rx,ry,rz);mesh.castShadow=true;cockpitGroup.add(mesh);return mesh;
  };
  // A conventional, restrained dashboard and center console.
  box(2.12,.26,.72,dashMat,0,1.17,-.78);
  box(2.04,.09,.38,softMat,0,1.34,-.86);
  box(.52,.48,.82,dashMat,0,.88,-.12,0,0,0);
  box(.48,.04,.46,trimMat,0,1.12,-.29);
  // Two simple but shaped seats, positioned behind the dash.
  for(const x of [-.48,.48]){
    box(.64,.20,.72,seatMat,x,.49,.42);
    box(.64,.82,.20,seatMat,x,.91,.78,-.12);
    box(.34,.25,.16,softMat,x,1.39,.78);
  }
  // Inner door cards provide a visible cabin boundary.
  for(const x of [-1.02,1.02]){
    box(.13,.62,1.18,softMat,x,.91,.05,0,0,x<0?-.06:.06);
    box(.035,.055,.68,trimMat,x<0?-.94:.94,.99,.02);
  }
  // Steering wheel sits on the driver side and rotates with steering input.
  steeringWheelVisual=new THREE.Group();
  steeringWheelVisual.position.set(-.48,1.03,-.34);
  cockpitGroup.add(steeringWheelVisual);
  const wheelMat=new THREE.MeshStandardMaterial({color:0x090d11,roughness:.55});
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.30,.035,14,52),wheelMat);
  steeringWheelVisual.add(ring);
  const hub=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.07,24),trimMat);
  hub.rotation.x=Math.PI/2;hub.position.z=.025;steeringWheelVisual.add(hub);
  for(const [x,y,angle] of [[0,.15,0],[-.13,-.08,-.7],[.13,-.08,.7]]){
    const spoke=new THREE.Mesh(new THREE.BoxGeometry(.045,.22,.045),trimMat);
    spoke.position.set(x,y,.015);spoke.rotation.z=angle;steeringWheelVisual.add(spoke);
  }
  // Dynamic digital display faces the driver.
  const canvas=document.createElement("canvas");canvas.width=512;canvas.height=256;
  cockpitGaugeContext=canvas.getContext("2d");
  cockpitGaugeTexture=new THREE.CanvasTexture(canvas);
  cockpitGaugeTexture.colorSpace=THREE.SRGBColorSpace;
  const screen=new THREE.Mesh(
    new THREE.PlaneGeometry(.40,.20),
    new THREE.MeshBasicMaterial({map:cockpitGaugeTexture,side:THREE.DoubleSide,toneMapped:false})
  );
  screen.position.set(-.48,1.39,-1.13);screen.renderOrder=10;cockpitGroup.add(screen);
  cockpitGaugeLast=0;
  drawCockpitDashboard(0,850,"N",true);
}

function addPlayerHeadlights(){
  const lights=[];
  for(const x of [-.72,.72]){
    const light=new THREE.SpotLight(0xffe8cb,76,88,Math.PI/7,.52,1.45);
    light.position.set(x,.95,-2.12);
    const target=new THREE.Object3D();
    target.position.set(x,-.18,-55);
    light.target=target;light.visible=state.time==="night";light.castShadow=false;
    player.add(light);player.add(target);lights.push(light);
  }
  player.userData.headlights=lights;
}

function createPlayerDashboard(){
  // Dashboard canvas is now part of the physical cockpit built above.
  if(!cockpitGaugeContext)buildCockpit();
  drawCockpitDashboard(0,850,"N",true);
}

function drawCockpitDashboard(speed,rpm,gear,force=false){
  if(!cockpitGaugeContext||!cockpitGaugeTexture)return;
  const now=performance.now();
  if(!force&&now-cockpitGaugeLast<80)return;
  cockpitGaugeLast=now;
  const c=cockpitGaugeContext;
  const bg=c.createLinearGradient(0,0,0,256);bg.addColorStop(0,"#10232f");bg.addColorStop(1,"#03090e");
  c.fillStyle=bg;c.fillRect(0,0,512,256);
  c.strokeStyle="#67d9d0";c.lineWidth=5;c.strokeRect(8,8,496,240);
  c.fillStyle="#82e1d8";c.font="800 20px Manrope, sans-serif";c.fillText("DRIVE HORIZON",24,38);
  c.fillStyle="#f0f7f6";c.font="900 104px Manrope, sans-serif";c.fillText(String(Math.round(speed)).padStart(3,"0"),22,156);
  c.fillStyle="#91b4be";c.font="700 20px Manrope, sans-serif";c.fillText("KM/H",28,190);
  c.fillStyle="#e7bd83";c.font="800 28px Manrope, sans-serif";c.fillText((rpm/1000).toFixed(1)+"k",354,105);
  c.fillStyle="#9db4bf";c.font="700 15px Manrope, sans-serif";c.fillText("RPM",364,130);
  c.fillStyle="#f3f8f7";c.font="900 62px Manrope, sans-serif";c.fillText(String(gear),390,206);
  c.fillStyle="rgba(255,255,255,.13)";c.fillRect(24,215,330,9);
  const bar=c.createLinearGradient(24,0,354,0);bar.addColorStop(0,"#62d8cc");bar.addColorStop(1,"#f4a16e");
  c.fillStyle=bar;c.fillRect(24,215,330*clamp(rpm/8000,0,1),9);
  cockpitGaugeTexture.needsUpdate=true;
}

function placeVehicles(dt) {
  const p=curve.getPointAt(state.progress),tan=curve.getTangentAt(state.progress),right=vecRight(tan);
  const yaw=Math.atan2(-tan.x,-tan.z);
  player.position.copy(p).addScaledVector(right,state.lateral);
  player.position.y+=.13+Math.sin(clock.now*7)*Math.min(.035,state.speed*.0008);
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
  // Глаза водителя находятся внутри импортированного салона.
  // Driver seat and steering wheel after Blender→glTF axis conversion and model yaw.
  // Eye point sits just behind the wheel and below the roof line.
  const cockpitPos=player.localToWorld(new THREE.Vector3(-.48,1.60,.10));
  // Камера вынесена за передний бампер: капот не перекрывает изображение.
  const hoodPos=player.localToWorld(new THREE.Vector3(0,1.42,-2.72));
  const topPos=player.position.clone().add(new THREE.Vector3(0,21,0)).addScaledVector(tan,-1.2);
  const desired=state.camera===0?chasePos:state.camera===1?cockpitPos:state.camera===2?hoodPos:topPos;
  camera.position.lerp(desired,Math.min(1,dt*(state.camera===3?2.4:state.camera===1?12:state.camera===2?9:4.5)));
  if(player.userData.steeringWheel&&player.userData.steeringWheelBase){
    const base=player.userData.steeringWheelBase;
    player.userData.steeringWheel.rotation.set(base.x,base.y,base.z-state.steer*.55);
  }
  if(player.userData.rollingWheels){
    const radius=player.userData.wheelRadius||.48;
    // Wheel axle is local X in the Kenney GLB. Spin around the hub, not local Z.
    player.userData.rollingWheels.forEach(w=>w.rotateX(-state.speed*dt/radius));
  }
  if(cockpitGroup)cockpitGroup.visible=state.camera===1;
  if(steeringWheelVisual)steeringWheelVisual.rotation.z=-state.steer*.62;
  const look=state.camera===3?player.position.clone():state.camera===1?player.localToWorld(new THREE.Vector3(-.48,1.48,-35)):state.camera===2?player.localToWorld(new THREE.Vector3(0,1.2,-30)):player.position.clone().addScaledVector(tan,5).add(new THREE.Vector3(0,.8,0));
  camera.lookAt(look);
  const targetFov=state.camera===1?68:(isMobile?69:62);
  if(Math.abs(camera.fov-targetFov)>.1){camera.fov=lerp(camera.fov,targetFov,Math.min(1,dt*4));camera.updateProjectionMatrix();}
}

function updateGame(dt) {
  pollHardware();
  inputTelemetryTimer+=dt;
  if(inputTelemetryTimer>.12){
    inputTelemetryTimer=0;
    const pad=getPads().find(p=>p.index===state.gamepadIndex);
    $("inputTelemetry").textContent=pad?
      "Сигналы · руль "+hardware.steer.toFixed(2)+" · газ "+Math.round(hardware.throttle*100)+"% · тормоз "+Math.round(hardware.brake*100)+"% · ручник "+(hardware.handbrake?"ВКЛ":"выкл"):
      "Сигналы появятся после подключения контроллера";
  }
  if(state.running&&!state.paused){
    const throttle=Math.max(controls.gas?1:0,hardware.throttle),brake=Math.max(controls.brake?1:0,hardware.brake);
    state.steerInput=clamp((controls.right?1:0)-(controls.left?1:0)+hardware.steer,-1,1);
    state.steer=lerp(state.steer,state.steerInput,Math.min(1,dt*5.2));
    const hand=(controls.handbrake||hardware.handbrake)?1:0;
    const gasPower=throttle>.025?throttle:0,brakePower=brake>.025?brake:0;
    if(gasPower>brakePower)state.speed=Math.min(58,state.speed+(20.5+state.speed*.08)*dt*(gasPower-brakePower));
    else if(brakePower>gasPower)state.speed=Math.max(-7,state.speed-31*dt*(brakePower-gasPower));
    else if(state.speed>0)state.speed=Math.max(0,state.speed-.62*dt);
    else if(state.speed<0)state.speed=Math.min(0,state.speed+.8*dt);
    if(hand)state.speed=Math.max(0,state.speed-9.5*dt);
    const steeringPower=.85+Math.abs(state.speed)*.075;
    state.lateral+=state.steer*steeringPower*dt*(hand?1.55:1);
    state.lateral=clamp(state.lateral,-11.6,11.6);
    if(Math.abs(state.lateral)>9.25){
      state.speed=Math.max(0,state.speed-(4.5+Math.abs(state.speed)*.11)*dt);
      if(Math.abs(state.lateral)>10.8&&state.messageTimer<=0)setMessage("Осторожнее: съезд с асфальта!",2);
    }
    if(hand&&Math.abs(state.steer)>.2&&state.speed>10&&state.messageTimer<=0)setMessage("Красивый занос!",1.5);
    state.progress=(state.progress+(state.speed*dt/trackLength)+1)%1;
    state.distance+=Math.abs(state.speed)*dt;
    state.totalDistance+=Math.abs(state.speed)*dt;
    traffic.forEach(car=>{
      const gap=((car.progress-state.progress+1)%1)*trackLength;
      if(gap<6.2&&gap>0&&Math.abs(car.offset-state.lateral)<1.85&&!car.hit){
        car.hit=true;state.speed*=.48;state.lateral=clamp(state.lateral+(state.lateral<car.offset?-1:1)*.7,-11,11);
        setMessage("Контакт! Дистанция спасает бампер.",2.5);
        setTimeout(()=>car.hit=false,1200);
      } else if(gap>13)car.hit=false;
      car.progress=(car.progress+(car.speed*dt/trackLength))%1;
    });
    if(state.messageTimer>0)state.messageTimer-=dt;
    if(state.messageTimer<=0)$("message").textContent="Держи полосу и наслаждайся дорогой";
    if(state.distance>Number(localStorage.getItem("driveHorizonRecord")||0)){
      localStorage.setItem("driveHorizonRecord",String(state.distance));
      $("record").innerHTML=(state.distance/1000).toFixed(2)+" <i>KM</i>";
    }
    const kmh=Math.round(Math.abs(state.speed)*3.6),rpmValue=Math.round(850+Math.abs(state.speed)*112);
    const gearValue=state.speed<-.5?"R":state.speed<1?"N":String(clamp(Math.floor(state.speed/10)+1,1,6));
    $("speed").textContent=String(kmh).padStart(3,"0");
    $("rpm").textContent=rpmValue+" RPM";
    $("rpmBar").style.width=clamp((Math.abs(state.speed)/58)*100,0,100)+"%";
    $("gear").textContent=gearValue;
    drawCockpitDashboard(kmh,rpmValue,gearValue);
    $("distance").innerHTML=(state.distance/1000).toFixed(2)+" <i>KM</i>";
    updateAudio();
  }
  placeVehicles(dt);drawMiniMap();
}

function resize() {
  if(!renderer||!camera)return;
  const w=window.innerWidth,h=window.innerHeight;
  camera.aspect=w/h;camera.near=.06;camera.fov=state.camera===1?68:(w<650?69:62);camera.updateProjectionMatrix();
  renderer.setSize(w,h,false);
  if(composer)composer.setSize(w,h);
}
function toast(text) {
  const el=$("toast");el.textContent=text;el.classList.add("show");
  clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),1700);
}
function showPause(value) {
  if(!state.running)return;
  state.paused=value;
  $("pausePanel").classList.toggle("hidden",!value);
  if(value){Object.keys(controls).forEach(k=>controls[k]=false);$("message").textContent="На паузе";}
  else setMessage("Снова на дороге. Удачной поездки!");
}
function startGame() {
  if(state.running&&!state.paused)return;
  state.running=true;state.paused=false;
  $("startOverlay").classList.add("hidden");$("pausePanel").classList.add("hidden");$("hud").classList.add("visible");
  initAudio();if(audioContext&&audioContext.state==="suspended")audioContext.resume();
  lastFrame=performance.now();setMessage("Поехали! Хорошей дороги.");
}
function restartGame() {
  state.progress=0;state.lateral=0;state.speed=0;state.distance=0;state.steer=0;
  traffic.forEach((car,i)=>car.progress=(.06+i*.117)%1);
  $("distance").innerHTML="0.00 <i>KM</i>";showPause(false);
  if(!state.running){state.running=true;$("hud").classList.add("visible");$("startOverlay").classList.add("hidden");}
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
  $("steerSource").value=inputConfig.steer;$("gasSource").value=inputConfig.gas;
  $("brakeSource").value=inputConfig.brake;$("handbrakeSource").value=inputConfig.handbrake;
  $("invertSteer").checked=!!inputConfig.invertSteer;$("invertGas").checked=!!inputConfig.invertGas;$("invertBrake").checked=!!inputConfig.invertBrake;$("pedalsPositive").checked=!!inputConfig.pedalsPositive;
  $("steerSensitivity").value=inputConfig.sensitivity;$("sensitivityValue").textContent=Number(inputConfig.sensitivity).toFixed(1)+"×";
}
function getPads() {
  try{return Array.from(navigator.getGamepads?navigator.getGamepads():[]).filter(p=>p&&p.connected);}
  catch(e){return [];}
}
function refreshDevicePanel() {
  const pads=getPads(),select=$("deviceSelect"),previous=state.gamepadIndex;
  select.innerHTML="";
  if(!pads.length){
    const option=document.createElement("option");option.value="";option.textContent="Устройство пока не обнаружено";select.appendChild(option);
    state.gamepadIndex=null;$("deviceStatus").textContent="Нет подключённого контроллера. Подключи USB/Bluetooth-устройство и нажми кнопку на нём.";
    $("deviceMeta").textContent="Ожидание геймпада или руля…";
  }else{
    pads.forEach(p=>{
      const option=document.createElement("option");option.value=String(p.index);
      option.textContent=(p.id||"Контроллер")+" · "+p.axes.length+" осей / "+p.buttons.length+" кнопок";
      select.appendChild(option);
    });
    const chosen=pads.find(p=>p.index===previous)||pads[0];state.gamepadIndex=chosen.index;select.value=String(chosen.index);
    $("deviceStatus").textContent="Подключено: "+(chosen.id||"контроллер");
    $("deviceMeta").textContent="Индекс "+chosen.index+" · "+(chosen.mapping==="standard"?"стандартная раскладка":"нестандартная раскладка")+
      " · "+chosen.axes.length+" осей · "+chosen.buttons.length+" кнопок";
    populateInputSources(chosen);
  }
  if(!pads.length)populateInputSources(null);
}
function populateInputSources(pad) {
  const axes=pad?pad.axes.length:8,buttons=pad?pad.buttons.length:32;
  const defs=[["steerSource","steer"],["gasSource","gas"],["brakeSource","brake"],["handbrakeSource","handbrake"]];
  defs.forEach(([id,key])=>{
    const el=$(id),old=inputConfig[key];el.innerHTML="";
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
  if(!pad){hardware.steer=hardware.throttle=hardware.brake=0;hardware.handbrake=false;return;}
  hardware.steer=readBinding(pad,inputConfig.steer,"steer",inputConfig.invertSteer);
  hardware.throttle=readBinding(pad,inputConfig.gas,"pedal",inputConfig.invertGas);
  hardware.brake=readBinding(pad,inputConfig.brake,"pedal",inputConfig.invertBrake);
  hardware.handbrake=readBinding(pad,inputConfig.handbrake,"pedal",false)>.55;
}

function bindControls() {
  const keyMap={w:"gas",arrowup:"gas",s:"brake",arrowdown:"brake"," ":"brake",a:"left",arrowleft:"left",d:"right",arrowright:"right",shift:"handbrake"};
  window.addEventListener("keydown",e=>{
    const k=e.key.toLowerCase();
    if(keyMap[k]){controls[keyMap[k]]=true;e.preventDefault();}
    if(k==="c")cycleCameraMode();
    if(k==="r")restartGame();
    if(k==="f1"){e.preventDefault();$("devicePanel").classList.toggle("hidden");refreshDevicePanel();}
    if(k==="escape"&&!$("devicePanel").classList.contains("hidden"))$("devicePanel").classList.add("hidden");
    else if(k==="p"||k==="escape")showPause(!state.paused);
    if(k==="enter"&&!state.running)startGame();
  });
  window.addEventListener("keyup",e=>{const k=e.key.toLowerCase();if(keyMap[k]){controls[keyMap[k]]=false;e.preventDefault();}});
  document.querySelectorAll("[data-control]").forEach(btn=>{
    const key=btn.dataset.control;
    const down=e=>{e.preventDefault();controls[key]=true;btn.classList.add("pressed");};
    const up=e=>{e.preventDefault();controls[key]=false;btn.classList.remove("pressed");};
    btn.addEventListener("pointerdown",down);btn.addEventListener("pointerup",up);
    btn.addEventListener("pointercancel",up);btn.addEventListener("pointerleave",up);
    btn.addEventListener("contextmenu",e=>e.preventDefault());
  });
  window.addEventListener("blur",()=>{Object.keys(controls).forEach(k=>controls[k]=false);if(state.running&&!state.paused)showPause(true);});
  document.addEventListener("visibilitychange",()=>{if(document.hidden&&state.running&&!state.paused)showPause(true);});
  window.addEventListener("gamepadconnected",e=>{state.gamepadIndex=e.gamepad.index;refreshDevicePanel();toast("Подключено: "+e.gamepad.id);});
  window.addEventListener("gamepaddisconnected",e=>{if(state.gamepadIndex===e.gamepad.index)state.gamepadIndex=null;hardware.steer=hardware.throttle=hardware.brake=0;hardware.handbrake=false;refreshDevicePanel();toast("Контроллер отключён");});
}
function bindUI() {
  $("startBtn").addEventListener("click",startGame);
  $("resumeBtn").addEventListener("click",()=>showPause(false));
  $("restartBtn").addEventListener("click",restartGame);
  $("menuBtn").addEventListener("click",()=>{
    state.running=false;state.paused=false;state.speed=0;
    $("hud").classList.remove("visible");$("pausePanel").classList.add("hidden");$("startOverlay").classList.remove("hidden");
  });
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
  $("qualityBtn").addEventListener("click",()=>{
    state.quality=!state.quality;renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,state.quality?(isMobile?1.25:1.8):1));
    renderer.shadowMap.enabled=state.quality;if(bloomPass)bloomPass.strength=state.quality?(isMobile?.22:.34):.08;
    renderer.setSize(window.innerWidth,window.innerHeight,false);if(composer){composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(window.innerWidth,window.innerHeight);}
    $("qualityBtn").querySelector(".btn-label").textContent="Графика: "+(state.quality?"высокая":"быстрая");
    toast(state.quality?"Высокое качество":"Режим производительности");
  });
  $("soundBtn").addEventListener("click",()=>{
    state.soundOn=!state.soundOn;$("soundBtn").textContent=state.soundOn?"♫":"♪";
    $("soundBtn").title=state.soundOn?"Звук включён":"Звук выключен";
    if(!state.soundOn&&engineGain&&audioContext)engineGain.gain.setTargetAtTime(.0001,audioContext.currentTime,.05);
    else if(state.soundOn){initAudio();if(audioContext&&audioContext.state==="suspended")audioContext.resume();}
  });
  $("fullscreenBtn").addEventListener("click",()=>{
    if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>{});
    else document.exitFullscreen?.();
  });
  document.querySelectorAll(".mode-btn").forEach(btn=>btn.addEventListener("click",()=>applyTime(btn.dataset.mode)));
  document.querySelectorAll(".paint").forEach(btn=>btn.addEventListener("click",()=>{
    state.paint=btn.dataset.paint;document.querySelectorAll(".paint").forEach(b=>b.classList.toggle("active",b===btn));updateCarPaint();
  }));
  minimapContext=$("minimap").getContext("2d");
}
function loop(now) {
  requestAnimationFrame(loop);
  const dt=Math.min(.045,(now-lastFrame)/1000||0);lastFrame=now;clock.now=now/1000;
  updateGame(dt);if(composer)composer.render();else renderer.render(scene,camera);
  frameCount++;fpsTime+=dt;
  if(fpsTime>2){$("startBtn").dataset.fps=Math.round(frameCount/fpsTime);frameCount=0;fpsTime=0;}
}
function init() {
  try{
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:"high-performance"});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,state.quality?(isMobile?1.4:1.8):1));
    renderer.setSize(window.innerWidth,window.innerHeight,false);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
    renderer.shadowMap.enabled=state.quality;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    sceneHost.appendChild(renderer.domElement);
    composer=new EffectComposer(renderer);
    scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0xc88e79,.00145);
    camera=new THREE.PerspectiveCamera(62,window.innerWidth/window.innerHeight,.1,1200);
    ambientLight=new THREE.HemisphereLight(0xc5e0ec,0x5d654f,.8);scene.add(ambientLight);
    directionalLight=new THREE.DirectionalLight(0xffe2c1,2.1);directionalLight.position.set(-120,180,-80);
    directionalLight.castShadow=true;directionalLight.shadow.mapSize.set(isMobile?1024:2048,isMobile?1024:2048);
    directionalLight.shadow.camera.left=-250;directionalLight.shadow.camera.right=250;
    directionalLight.shadow.camera.top=250;directionalLight.shadow.camera.bottom=-250;
    directionalLight.shadow.camera.near=1;directionalLight.shadow.camera.far=600;
    directionalLight.shadow.bias=-.0002;scene.add(directionalLight);scene.add(directionalLight.target);
    makeSky();buildWorld();
    composer.addPass(new RenderPass(scene,camera));
    bloomPass=new UnrealBloomPass(new THREE.Vector2(window.innerWidth,window.innerHeight),isMobile?.16:.34,.42,.76);
    composer.addPass(bloomPass);composer.addPass(new OutputPass());
    player=new THREE.Group();playerFallback=makeCar(state.paint);player.add(playerFallback);scene.add(player);addPlayerHeadlights();
    createTraffic();buildCockpit();updateCameraButton();drawMiniMap();bindControls();bindUI();window.addEventListener("resize",resize);
    loadInputConfig();refreshDevicePanel();
    loadDefaultCar();
    $("loadStatus").textContent="Трасса готова. Загружается обычный дорожный автомобиль…";
    $("record").innerHTML=(Number(localStorage.getItem("driveHorizonRecord")||0)/1000).toFixed(2)+" <i>KM</i>";
    setMessage("Держи полосу и наслаждайся дорогой");
    requestAnimationFrame(loop);
  }catch(error){
    console.error(error);$("errorBox").classList.remove("hidden");
    $("loadStatus").textContent="Не удалось запустить 3D-сцену.";
  }
}
init();
