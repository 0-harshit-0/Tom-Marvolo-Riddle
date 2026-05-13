import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { Book, Page, PageGeo } from '/src/classes.js';
import {
  applyForce,
  applyGravity,
  applyLeftPush,
  applyRightPush,
  applyDistanceConstraints,
  applyPageSpringForces,
  applyMouseDrag,
  applyWrapperFollow, // ← new
} from '/src/phy.js';
import { randomId } from '/src/utils.js';

// ─── Canvas / renderer setup ──────────────────────────────────────────────────
const canvas = document.querySelector('#canvas');
canvas.width = innerWidth;
canvas.height = innerHeight;

const MOUSE_MASS = 10;
const APPLY_FORCES = [];
const GRAVITY = 0.001;

// Grab radius used when scanning WRAPPER vertices (they are more widely spaced
// than paper vertices, so we use a larger radius here).
const WRAPPER_GRAB_RADIUS = 0.75;

const scene = new THREE.Scene();
const light = new THREE.DirectionalLight('white', 1);
const ambientLight = new THREE.AmbientLight(0xffffff, 1);
const camera = new THREE.PerspectiveCamera(
  5,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
const renderer = new THREE.WebGLRenderer({ canvas });
const controls = new OrbitControls(camera, canvas);

scene.background = new THREE.Color('black');

light.position.set(0, 30, 100);
light.target.position.set(0, 2, 0);
light.castShadow = true;
light.shadow.bias = -0.0005;
light.shadow.normalBias = 0.05;
light.shadow.mapSize.width = 2048;
light.shadow.mapSize.height = 2048;

camera.position.set(0, 0, 100);

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

controls.target.set(0, 0, 0);

// ─── Book / page setup ────────────────────────────────────────────────────────
const book1 = new Book(randomId());

function initBook() {
  const oldPages = [];
  for (let i = 0; i < 10; i++) {
    const newPage = new Page(randomId(), i);
    oldPages.push(newPage);

    if (oldPages.length == 2) {
      const newPageGeo = new PageGeo(randomId(), 2, 4);
      newPageGeo.addMetas(oldPages);

      book1.addPageGeo(newPageGeo.id, newPageGeo);
      oldPages.length = 0;
    }

    book1.addPage(newPage.id, newPage);
  }

  let z = 0.05;
  book1.pagesGeo.forEach((value) => {
    // ── Paper mesh ──────────────────────────────────────────────────────────
    value.geometry.translate(0, 0, z);
    value.plane.castShadow = true;
    value.plane.receiveShadow = true;
    scene.add(value.plane);

    // ── Wrapper mesh (placed at the same z; it's invisible so z-fighting
    //    is harmless, and depthWrite=false keeps it from occluding the paper) ─
    value.wrapperGeometry.translate(0, 0, z);
    scene.add(value.wrapperMesh);

    z -= 0.01;
  });

  // Book-spine clip cylinder
  const geometry = new THREE.CylinderGeometry(0.05, 0.05, 4, 16);
  const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const ball = new THREE.Mesh(geometry, material);
  ball.position.set(0, 0, 0);
  scene.add(ball);
}

// ─── Lights / camera / controls ──────────────────────────────────────────────
scene.add(ambientLight);
scene.add(light);
scene.add(light.target);
scene.add(camera);

function renderFun() {
  renderer.render(scene, camera);
}

initBook();
controls.update();

// ─── Raycasting & drag state ──────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const grab = new THREE.Vector3();
const prevMouseWorld = new THREE.Vector3();
let grabWorldZ = 0;

let grabbedIndexes = [];
let grabbedVertices = new Map();

let isDragging = false;
let selectedPageGeo = null; // the PageGeo whose wrapper is being dragged

function updateMousePosition(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

// ─── Mouse down ───────────────────────────────────────────────────────────────
canvas.addEventListener('mousedown', (event) => {
  wakeUp();
  updateMousePosition(event);
  raycaster.setFromCamera(mouse, camera);

  // Raycast against WRAPPER meshes only — paper is the visual, wrapper is the
  // interactive surface.
  const wrapperMeshes = [...book1.pagesGeo.values()].map(
    (pg) => pg.wrapperMesh
  );
  const intersects = raycaster.intersectObjects(wrapperMeshes);
  if (!intersects.length) return;

  isDragging = true;

  // Identify which PageGeo owns the hit wrapper
  selectedPageGeo = [...book1.pagesGeo.values()].find(
    (pg) => pg.wrapperMesh === intersects[0].object
  );
  if (!selectedPageGeo) return;

  // ── Build the grab-point from WRAPPER geometry ──────────────────────────
  const wGeo = selectedPageGeo.wrapperGeometry;
  const wPos = wGeo.attributes.position;

  const localPoint = selectedPageGeo.wrapperMesh.worldToLocal(
    intersects[0].point.clone()
  );
  grab.copy(localPoint);
  grabWorldZ = intersects[0].point.z;
  prevMouseWorld.copy(intersects[0].point);

  grabbedIndexes.length = 0;
  grabbedVertices.clear();

  for (let i = 0; i < wPos.count; i++) {
    const dx = wPos.getX(i) - grab.x;
    const dy = wPos.getY(i) - grab.y;
    const dz = wPos.getZ(i) - grab.z;
    if (
      dx * dx + dy * dy + dz * dz <=
      WRAPPER_GRAB_RADIUS * WRAPPER_GRAB_RADIUS
    ) {
      grabbedIndexes.push(i);
      grabbedVertices.set(i, {
        x: wPos.getX(i),
        y: wPos.getY(i),
        z: wPos.getZ(i),
      });
    }
  }

  controls.enabled = false;

  // ── 1. Always: set up wrapper cloth springs (once per page) ─────────────
  if (!wGeo.userData.springEdgesBuilt) {
    APPLY_FORCES.push({
      applyOnce: false,
      geometry: wGeo,
      apply: applyPageSpringForces(
        wGeo,
        wGeo.attributes.position,
        wGeo.index.array,
        wGeo.attributes.position.array,
        1,
        wGeo.userData.mass,
        new Set(),
        3, // iterations
        300, // stiffness  — wrapper is the elastic control cage
        30, // bendStiffness
        0.7, // damping
        1 / 120,
        100
      ),
    });
  }

  // ── 2. Always: set up paper→wrapper follow spring (once per page) ────────
  if (!selectedPageGeo.geometry.userData.wrapperFollowBuilt) {
    selectedPageGeo.geometry.userData.wrapperFollowBuilt = true;
    APPLY_FORCES.push({
      applyOnce: false,
      geometry: selectedPageGeo.geometry,
      apply: applyWrapperFollow(
        selectedPageGeo.geometry,
        wGeo,
        selectedPageGeo.wrapperUVMap,
        150, // stiffness — how tightly paper tracks wrapper
        0.88, // damping   — a touch of lag gives paper its own feel
        1 / 120,
        50
      ),
    });
  }

  // ── 3. Optional (press 'b' first): internal paper cloth constraints ──────
  //    These add structural resistance so the paper itself resists stretching.
  if (springEnabled && !selectedPageGeo.geometry.userData.springEdgesBuilt) {
    APPLY_FORCES.push({
      applyOnce: false,
      geometry: selectedPageGeo.geometry,
      apply: applyPageSpringForces(
        selectedPageGeo.geometry,
        selectedPageGeo.geometry.attributes.position,
        selectedPageGeo.geometry.index.array,
        selectedPageGeo.geometry.attributes.position.array,
        1,
        selectedPageGeo.geometry.userData.mass,
        new Set(),
        3,
        300,
        30,
        0.7,
        1 / 120,
        100
      ),
    });
  }
});

// ─── Mouse move ───────────────────────────────────────────────────────────────
canvas.addEventListener('mousemove', (event) => {
  if (!isDragging || !selectedPageGeo) return;

  updateMousePosition(event);

  const vec = new THREE.Vector3(mouse.x, mouse.y, 0.5);
  vec.unproject(camera);
  const dir = vec.sub(camera.position).normalize();
  const dist = (grabWorldZ - camera.position.z) / dir.z;
  const currentMouseWorld = camera.position
    .clone()
    .add(dir.multiplyScalar(dist));

  const dx = currentMouseWorld.x - prevMouseWorld.x;
  const dy = currentMouseWorld.y - prevMouseWorld.y;
  const dz = currentMouseWorld.z - prevMouseWorld.z;

  prevMouseWorld.copy(currentMouseWorld);

  // Drag the WRAPPER — paper follows it via applyWrapperFollow each frame.
  applyMouseDrag(
    selectedPageGeo.wrapperGeometry,
    grabbedIndexes,
    dx,
    dy,
    dz,
    30
  );
  wakeUp();
});

// ─── Mouse up ─────────────────────────────────────────────────────────────────
canvas.addEventListener('mouseup', () => {
  isDragging = false;
  controls.enabled = true;
});

// ─── Render / animation loop ──────────────────────────────────────────────────
let renderAnimationId,
  springEnabled = false;
let isLooping = false,
  lastActivityTime = Date.now();
const IDLE_TIMEOUT = 6000;

const byGeo = new Map();

function renderAnimation() {
  if (APPLY_FORCES.length) {
    byGeo.clear();

    for (let i = APPLY_FORCES.length - 1; i >= 0; i--) {
      const entry = APPLY_FORCES[i];
      const f = entry.apply(true);
      if (entry.applyOnce) APPLY_FORCES.splice(i, 1);
      if (!f?.updated) continue;

      const geo = entry.geometry;
      if (!byGeo.has(geo))
        byGeo.set(geo, new Float32Array(geo.attributes.position.count * 3));

      const toApply = byGeo.get(geo);
      for (let j = 0; j < toApply.length; j++) toApply[j] += f.result[j];
    }

    for (const [geo, toApply] of byGeo) {
      applyForce(geo, toApply);
    }
  }

  renderFun();

  if (Date.now() - lastActivityTime > IDLE_TIMEOUT) {
    isLooping = false;
    console.log('Loop paused to save CPU');
    cancelAnimationFrame(renderAnimationId);
    return;
  }

  renderAnimationId = requestAnimationFrame(renderAnimation);
}

function wakeUp() {
  lastActivityTime = Date.now();
  if (!isLooping) {
    isLooping = true;
    renderAnimation();
    console.log('Loop started');
  }
}

wakeUp();

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  console.log(selectedPageGeo, 'selectedPageGeo');

  if (e.key == 'Escape') {
    cancelAnimationFrame(renderAnimationId);
    return;
  }

  if (e.key == 'b') {
    // Enable internal paper cloth constraints — applied next time a page is grabbed.
    springEnabled = true;
    console.log('Internal paper cloth constraints enabled');
    return;
  }

  // All the forces below target the WRAPPER geometry so the paper follows
  // naturally through applyWrapperFollow.

  if (!selectedPageGeo) return;

  const wGeo = selectedPageGeo.wrapperGeometry;

  if (e.key == 'g') {
    wakeUp();
    APPLY_FORCES.push({
      applyOnce: false,
      geometry: wGeo,
      apply: applyGravity(
        wGeo.attributes.position,
        wGeo.index.array,
        wGeo.attributes.position.array,
        GRAVITY,
        wGeo.userData.mass
      ),
    });
  }

  if (e.key == 'ArrowLeft') {
    wakeUp();
    APPLY_FORCES.push({
      applyOnce: true,
      geometry: wGeo,
      apply: applyLeftPush(wGeo, grabbedIndexes, 0.3),
    });
  } else if (e.key == 'ArrowRight') {
    wakeUp();
    APPLY_FORCES.push({
      applyOnce: true,
      geometry: wGeo,
      apply: applyRightPush(
        wGeo.attributes.position,
        grabbedIndexes,
        grabbedVertices,
        0.1,
        wGeo.userData.mass
      ),
    });
  }
});
