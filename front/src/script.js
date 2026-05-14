import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { Book, Page, PageGeo, CoverGeo } from '/src/classes.js';
import {
  applyForce,
  applyGravity,
  applyLeftPush,
  applyRightPush,
  applyPageSpringForces,
  applyMouseDrag,
  applyWrapperFollow,
  applyCoverHinge,
  applyCoverAngularDrag,
} from '/src/phy.js';
import { randomId } from '/src/utils.js';

// ─── Canvas / renderer ────────────────────────────────────────────────────────
const canvas = document.querySelector('#canvas');
canvas.width = innerWidth;
canvas.height = innerHeight;

const APPLY_FORCES = [];
const GRAVITY = 0.001;
const WRAPPER_GRAB_RADIUS = 0.75;

const scene = new THREE.Scene();
const light = new THREE.DirectionalLight('white', 1);
const ambientLight = new THREE.AmbientLight(0xffffff, 1);
const camera = new THREE.PerspectiveCamera(
  5,
  innerWidth / innerHeight,
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
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
controls.target.set(0, 0, 0);

// ─── Book setup ───────────────────────────────────────────────────────────────
const book1 = new Book(randomId());
let frontCover = null;
let backCover = null;

function initBook() {
  // ── Pages ──────────────────────────────────────────────────────────────────
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
    value.geometry.translate(0, 0, z);
    value.plane.castShadow = true;
    value.plane.receiveShadow = true;
    scene.add(value.plane);

    value.wrapperGeometry.translate(0, 0, z);
    scene.add(value.wrapperMesh);

    // Refresh originals after z-translate so rest pose is accurate
    value.geometry.userData.original = new Float32Array(
      value.geometry.attributes.position.array
    );
    value.wrapperGeometry.userData.original = new Float32Array(
      value.wrapperGeometry.attributes.position.array
    );

    z -= 0.01;
  });

  // ── Front cover — sits on top of all pages (closed = angle 0, flat face-up)
  frontCover = new CoverGeo(randomId(), 2, 4, 0x8b4513, false);
  frontCover.pivot.position.set(0, 0, 0.07); // just above the page stack
  scene.add(frontCover.pivot);

  // ── Back cover — sits below all pages (closed = angle 0, flat face-down)
  // pivot.rotation.y = 0 means it lies flat just like the front cover;
  // opening it swings it to angle -π (under the book).
  backCover = new CoverGeo(randomId(), 2, 4, 0x8b4513, true);
  backCover.pivot.position.set(0, 0, -0.07); // just below the page stack
  backCover.pivot.rotation.z = Math.PI; // flip so it extends right (not left) at angle=π
  scene.add(backCover.pivot);

  // Cover hinge tickers — run every frame, mutate pivot.rotation.y directly
  APPLY_FORCES.push({
    applyOnce: false,
    isCover: true,
    cover: frontCover,
    apply: applyCoverHinge(frontCover, 0.2),
  });
  APPLY_FORCES.push({
    applyOnce: false,
    isCover: true,
    cover: backCover,
    apply: applyCoverHinge(backCover, 0.2),
  });

  // ── Spine ──────────────────────────────────────────────────────────────────
  // const spineGeo = new THREE.CylinderGeometry(0.05, 0.05, 4, 16);
  // const spineMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  // scene.add(new THREE.Mesh(spineGeo, spineMat));
}

scene.add(ambientLight);
scene.add(light);
scene.add(light.target);
scene.add(camera);

function renderFun() {
  renderer.render(scene, camera);
}

initBook();
controls.update();

// ─── Interaction state ────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const grab = new THREE.Vector3();
const prevMouseWorld = new THREE.Vector3();
let grabWorldZ = 0;

let grabbedIndexes = [];
let grabbedVertices = new Map();

let isDragging = false;
let selectedPageGeo = null; // set when a page wrapper is being dragged
let selectedCover = null; // set when a cover is being dragged

function updateMousePosition(event) {
  mouse.x = (event.clientX / innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / innerHeight) * 2 + 1;
}

function mouseToWorld(z) {
  const vec = new THREE.Vector3(mouse.x, mouse.y, 0.5);
  vec.unproject(camera);
  const dir = vec.sub(camera.position).normalize();
  const dist = (z - camera.position.z) / dir.z;
  return camera.position.clone().add(dir.multiplyScalar(dist));
}

// ─── Mouse down ───────────────────────────────────────────────────────────────
canvas.addEventListener('mousedown', (event) => {
  // Kill OrbitControls immediately — any drift before we finish processing
  // would rotate the camera and look like the object snapping.
  controls.enabled = false;

  wakeUp();
  updateMousePosition(event);
  raycaster.setFromCamera(mouse, camera);

  // ── Single raycast against everything, pick closest sensible target ────────
  // Rules:
  //   • A cover whose Z is ABOVE (closer to camera than) the nearest page hit
  //     wins — it's physically in front.
  //   • A closed cover that is BEHIND a page hit loses — the page is on top.
  //   • If nothing is hit at all, re-enable controls and bail.
  const wrapperMeshes = [...book1.pagesGeo.values()].map(
    (pg) => pg.wrapperMesh
  );
  const allTargets = [frontCover.plane, backCover.plane, ...wrapperMeshes];
  const allHits = raycaster.intersectObjects(allTargets);

  if (!allHits.length) {
    controls.enabled = true;
    return;
  }

  // Walk hits in distance order; pick the first cover or page.
  // A closed cover (within 0.1 rad of its rest angle) is only accepted if no
  // page hit comes before it (i.e. it is the closest thing under the cursor).
  const firstPageHit = allHits.find((h) => wrapperMeshes.includes(h.object));
  const firstCoverHit = allHits.find(
    (h) => h.object === frontCover.plane || h.object === backCover.plane
  );

  const frontClosed = Math.abs(frontCover.angle - 0) < 0.1;
  const backClosed = Math.abs(backCover.angle - Math.PI) < 0.1;

  // Decide if the closest cover hit should win over the closest page hit.
  let useCover = false;
  if (firstCoverHit) {
    const coverObj = firstCoverHit.object;
    const isClosed = coverObj === frontCover.plane ? frontClosed : backClosed;
    // Open cover always wins. Closed cover wins only if it's closer than any page.
    if (!isClosed) {
      useCover = true;
    } else if (
      !firstPageHit ||
      firstCoverHit.distance < firstPageHit.distance
    ) {
      useCover = true;
    }
  }

  if (useCover) {
    isDragging = true;
    selectedCover =
      firstCoverHit.object === frontCover.plane ? frontCover : backCover;
    grabWorldZ = firstCoverHit.point.z;
    prevMouseWorld.copy(firstCoverHit.point);
    return;
  }

  const pageHits = firstPageHit ? [firstPageHit] : [];
  if (!pageHits.length) {
    controls.enabled = true;
    return;
  }

  isDragging = true;
  selectedPageGeo = [...book1.pagesGeo.values()].find(
    (pg) => pg.wrapperMesh === firstPageHit.object
  );
  if (!selectedPageGeo) {
    controls.enabled = true;
    return;
  }

  const wGeo = selectedPageGeo.wrapperGeometry;
  const wPos = wGeo.attributes.position;

  const localPoint = selectedPageGeo.wrapperMesh.worldToLocal(
    firstPageHit.point.clone()
  );
  grab.copy(localPoint);
  grabWorldZ = firstPageHit.point.z;
  prevMouseWorld.copy(firstPageHit.point);

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

  // Wrapper cloth springs — set up once per page on first grab
  if (!wGeo.userData.springEdgesBuilt) {
    const wHingeX = wGeo.userData.hingeX;
    const wOrig = wGeo.userData.original;
    const wHingePinned = new Set();
    for (let wi = 0; wi < wPos.count; wi++) {
      if (Math.abs(wOrig[wi * 3] - wHingeX) < 0.001) wHingePinned.add(wi);
    }
    APPLY_FORCES.push({
      applyOnce: false,
      geometry: wGeo,
      apply: applyPageSpringForces(
        wGeo,
        wPos,
        wGeo.index.array,
        wPos.array,
        1,
        wGeo.userData.mass,
        wHingePinned,
        3,
        300,
        30,
        0.7,
        1 / 120,
        100
      ),
    });
  }

  // Paper → wrapper follow spring — set up once per page on first grab
  if (!selectedPageGeo.geometry.userData.wrapperFollowBuilt) {
    selectedPageGeo.geometry.userData.wrapperFollowBuilt = true;
    APPLY_FORCES.push({
      applyOnce: false,
      geometry: selectedPageGeo.geometry,
      apply: applyWrapperFollow(
        selectedPageGeo.geometry,
        wGeo,
        null, // uvMap ignored — binding built lazily from live positions
        150,
        0.88,
        1 / 120,
        50
      ),
    });
  }

  // Optional internal paper cloth constraints (press 'b' first)
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
  if (!isDragging) return;
  updateMousePosition(event);

  const currentMouseWorld = mouseToWorld(grabWorldZ);
  const dx = currentMouseWorld.x - prevMouseWorld.x;
  const dy = currentMouseWorld.y - prevMouseWorld.y;
  prevMouseWorld.copy(currentMouseWorld);

  if (selectedCover) {
    // Covers rotate as a rigid body — no vertex math, just angular velocity
    applyCoverAngularDrag(selectedCover, dx, 5);
    wakeUp();
    return;
  }

  if (selectedPageGeo) {
    applyMouseDrag(
      selectedPageGeo.wrapperGeometry,
      grabbedIndexes,
      dx,
      dy,
      0,
      30
    );
    wakeUp();
  }
});

// ─── Mouse up ─────────────────────────────────────────────────────────────────
canvas.addEventListener('mouseup', () => {
  isDragging = false;
  selectedCover = null;
  selectedPageGeo = null;
  controls.enabled = true;
});

// ─── Render loop ──────────────────────────────────────────────────────────────
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

      // Cover entries rotate pivot.rotation.y themselves — no geometry delta
      if (entry.isCover) continue;

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
    console.log('Loop paused');
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
  if (e.key === 'Escape') {
    cancelAnimationFrame(renderAnimationId);
    return;
  }

  if (e.key === 'b') {
    springEnabled = true;
    console.log('Paper cloth constraints enabled');
    return;
  }

  if (!selectedPageGeo) return;
  const wGeo = selectedPageGeo.wrapperGeometry;

  if (e.key === 'g') {
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

  if (e.key === 'ArrowLeft') {
    wakeUp();
    APPLY_FORCES.push({
      applyOnce: true,
      geometry: wGeo,
      apply: applyLeftPush(wGeo, grabbedIndexes, 0.3),
    });
  } else if (e.key === 'ArrowRight') {
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
