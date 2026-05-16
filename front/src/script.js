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
import {
  activateWriter,
  deactivateWriter,
  writerHandleKey,
  tickWriter,
  isWriterActive,
} from '/src/page_writer.js';

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

// scene.background = new THREE.Color('black');
const textureLoader = new THREE.TextureLoader();
textureLoader.load('assets/bg.png', (texture) => {
  // 2. Adjust these values to zoom in
  const zoomLevel = 0.9; // Example: zoom in by 50%
  texture.repeat.set(zoomLevel, zoomLevel);

  // 3. Center the zoomed texture on the screen
  texture.offset.set((1 - zoomLevel) / 2, (1 - zoomLevel) / 2 + 0.05);

  scene.background = texture;
});

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
const bookGroup = new THREE.Group();

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
    value.geometry.translate(0, 0, z);
    value.plane.castShadow = true;
    value.plane.receiveShadow = true;
    bookGroup.add(value.plane);

    value.wrapperGeometry.translate(0, 0, z);
    bookGroup.add(value.wrapperMesh);

    value.geometry.userData.original = new Float32Array(
      value.geometry.attributes.position.array
    );
    value.wrapperGeometry.userData.original = new Float32Array(
      value.wrapperGeometry.attributes.position.array
    );

    z -= 0.01;
  });

  frontCover = new CoverGeo(randomId(), 2, 4, 0x8b4513, false);
  frontCover.pivot.position.set(0, 0, 0.07);
  bookGroup.add(frontCover.pivot);

  backCover = new CoverGeo(randomId(), 2, 4, 0x8b4513, true);
  backCover.pivot.position.set(0, 0, -0.07);
  backCover.pivot.rotation.z = Math.PI;
  bookGroup.add(backCover.pivot);

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
}

function renderFun() {
  renderer.render(scene, camera);
}

scene.add(bookGroup);
scene.add(ambientLight);
scene.add(light);
scene.add(light.target);
scene.add(camera);

initBook();
controls.update();

bookGroup.rotation.x = -0.3;
bookGroup.position.y = -0.3;
bookGroup.rotation.z = -0.03;
bookGroup.position.y = 1.5;

// ─── Interaction state ────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const grab = new THREE.Vector3();
const prevMouseWorld = new THREE.Vector3();
let grabWorldZ = 0;

let grabbedIndexes = [];
let grabbedVertices = new Map();

let isDragging = false;
let selectedPageGeo = null;
let selectedCover = null;

// ─── Double-click timing (detect on canvas) ───────────────────────────────────
let _lastClickTime = 0;
let _lastClickTarget = null;
const DBL_CLICK_MS = 350;

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

// ─── Raycast helpers ──────────────────────────────────────────────────────────
function getPageGeoHit() {
  const wrapperMeshes = [...book1.pagesGeo.values()].map(
    (pg) => pg.wrapperMesh
  );
  const hits = raycaster.intersectObjects(wrapperMeshes);
  if (!hits.length) return null;
  const hit = hits[0];
  const pg = [...book1.pagesGeo.values()].find(
    (p) => p.wrapperMesh === hit.object
  );
  return pg || null;
}

// ─── Mouse down ───────────────────────────────────────────────────────────────
canvas.addEventListener('mousedown', (event) => {
  controls.enabled = false;

  wakeUp();
  updateMousePosition(event);
  raycaster.setFromCamera(mouse, camera);

  // ── Double-click detection ──────────────────────────────────────────────────
  const now = performance.now();
  const hitPg = getPageGeoHit();

  if (
    hitPg &&
    now - _lastClickTime < DBL_CLICK_MS &&
    _lastClickTarget === hitPg
  ) {
    // Double-click on a page — open the writer
    activateWriter(hitPg, bookGroup);
    controls.enabled = true;
    _lastClickTime = 0; // reset so triple-click doesn't re-trigger
    return;
  }

  // Single click — if writer is open and user clicked elsewhere, close it
  if (isWriterActive()) {
    deactivateWriter();
  }

  _lastClickTime = now;
  _lastClickTarget = hitPg;

  // ── Normal drag logic ───────────────────────────────────────────────────────
  const wrapperMeshes = [...book1.pagesGeo.values()].map(
    (pg) => pg.wrapperMesh
  );
  const allTargets = [frontCover.plane, backCover.plane, ...wrapperMeshes];
  const allHits = raycaster.intersectObjects(allTargets);

  if (!allHits.length) {
    controls.enabled = true;
    return;
  }

  const firstPageHit = allHits.find((h) => wrapperMeshes.includes(h.object));
  const firstCoverHit = allHits.find(
    (h) => h.object === frontCover.plane || h.object === backCover.plane
  );

  const frontClosed = Math.abs(frontCover.angle - 0) < 0.1;
  const backClosed = Math.abs(backCover.angle - Math.PI) < 0.1;

  let useCover = false;
  if (firstCoverHit) {
    const coverObj = firstCoverHit.object;
    const isClosed = coverObj === frontCover.plane ? frontClosed : backClosed;
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

  if (!selectedPageGeo.geometry.userData.wrapperFollowBuilt) {
    selectedPageGeo.geometry.userData.wrapperFollowBuilt = true;
    APPLY_FORCES.push({
      applyOnce: false,
      geometry: selectedPageGeo.geometry,
      apply: applyWrapperFollow(
        selectedPageGeo.geometry,
        wGeo,
        null,
        150,
        0.88,
        1 / 120,
        50
      ),
    });
  }

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

// ─── Keyboard — route to writer when active, else book controls ───────────────
window.addEventListener('keydown', (e) => {
  // Writer eats all keys while active (except Escape which also closes it)
  if (isWriterActive()) {
    writerHandleKey(e);
    if (e.key !== 'Escape') e.preventDefault(); // stop browser shortcuts (backspace nav etc)
    wakeUp();
    return;
  }

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

// ─── Render loop ──────────────────────────────────────────────────────────────
let renderAnimationId,
  springEnabled = false;
let isLooping = false,
  lastActivityTime = Date.now();
const IDLE_TIMEOUT = 6000;
const byGeo = new Map();

let _lastFrameTime = performance.now();

function renderAnimation() {
  const now = performance.now();
  const delta = now - _lastFrameTime;
  _lastFrameTime = now;

  // ── Tick the page-writer animations ────────────────────────────────────────
  tickWriter(delta);

  if (APPLY_FORCES.length) {
    byGeo.clear();

    for (let i = APPLY_FORCES.length - 1; i >= 0; i--) {
      const entry = APPLY_FORCES[i];
      const f = entry.apply(true);
      if (entry.applyOnce) APPLY_FORCES.splice(i, 1);
      if (!f?.updated) continue;

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

  // Keep loop alive while writer is animating
  if (isWriterActive()) lastActivityTime = Date.now();

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
    _lastFrameTime = performance.now();
    renderAnimation();
    console.log('Loop started');
  }
}

wakeUp();
