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
} from '/src/phy.js';
import { randomId } from '/src/utils.js';

// canvas
const canvas = document.querySelector('#canvas');
canvas.width = innerWidth;
canvas.height = innerHeight;

const MOUSE_MASS = 10; // basically infinite, cause mouse is the GOD xD
const APPLY_FORCES = [];
const GRAVITY = 0.001;

// THREE.Object3D.DefaultUp = new THREE.Vector3(0, 0, 1);
const scene = new THREE.Scene();
const light = new THREE.DirectionalLight('white', 1);
const ambientLight = new THREE.AmbientLight(0xffffff, 1);
const camera = new THREE.PerspectiveCamera(
  5, // fov
  window.innerWidth / window.innerHeight, // aspect
  0.1, // near
  1000 // far
);
const renderer = new THREE.WebGLRenderer({ canvas });
const controls = new OrbitControls(camera, canvas);

scene.background = new THREE.Color('black');

light.position.set(0, 30, 100);
light.target.position.set(0, 2, 0);
light.castShadow = true;
light.shadow.bias = -0.0005;
light.shadow.normalBias = 0.05;
// if bigger size
light.shadow.mapSize.width = 2048;
light.shadow.mapSize.height = 2048;

// light.shadow.camera.near = 1;
// light.shadow.camera.far = 500;

// light.shadow.camera.left = -100;
// light.shadow.camera.right = 100;
// light.shadow.camera.top = 100;
// light.shadow.camera.bottom = -100;

// camera.up.set(0, 0, 1);
camera.position.set(0, 0, 100);
// camera.lookAt(0, 300, 0);

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer shadows
// document.body.appendChild(renderer.domElement);

controls.target.set(0, 0, 0);

// book setup ==========================
const book1 = new Book(randomId());

// pages setup ======================
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
  book1.pagesGeo.forEach((value, key, map) => {
    // value.plane.position.set(0, 0, z);
    value.geometry.translate(0, 0, z);
    value.plane.castShadow = true; // Plane casts shadow
    value.plane.receiveShadow = true; // Plane receives shadow

    scene.add(value.plane);

    z -= 0.01;
  });

  // book clip
  const geometry = new THREE.CylinderGeometry(0.05, 0.05, 4, 16);
  const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const ball = new THREE.Mesh(geometry, material);
  ball.position.set(0, 0, 0); // top-left-up all positive
  // ball.position.set(0, 2, 0.05); // top-left-up all positive
  scene.add(ball);

  // const iterator = book1.pagesGeo.keys();
  // book1.addActivePageGeo(iterator.next().value);
  // book1.addActivePageGeo(iterator.next().value);
  // console.log(book1.info(), oldPages);
}

// const newPageGeo = new PageGeo(randomId(), 2, 4);
// newPageGeo.geometry.translate(0, 0, 1);
// // newPageGeo.plane.position.set(0, 0, 5);
// scene.add(newPageGeo.plane);

// lights, camera, controls setup ======================
scene.add(ambientLight);
scene.add(light);
scene.add(light.target);
scene.add(camera);

// controls.addEventListener('change', () => {
//   //mesh.rotateX = 180;
//   renderFun();
// });
function renderFun() {
  renderer.render(scene, camera);
}

initBook();
controls.update();

// ray casting =================================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const grab = new THREE.Vector3(); // grabStart
const grabRadius = 0.3;
const prevMouseWorld = new THREE.Vector3();
let grabWorldZ = 0;

let grabbedIndexes = [];
let grabbedVertices = new Map();

let isDragging = false;
let selectedPageGeo = null;

// Convert mouse position to normalized device coordinates
function updateMousePosition(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

canvas.addEventListener('mousedown', (event) => {
  wakeUp();
  updateMousePosition(event);
  raycaster.setFromCamera(mouse, camera);

  // collect all planes
  const planes = [...book1.pagesGeo.values()].map((pg) => pg.plane);
  const intersects = raycaster.intersectObjects(planes);
  if (!intersects.length) return;

  isDragging = true;
  selectedPageGeo = intersects[0].object; // the THREE.Mesh

  // find which PageGeo owns this mesh
  selectedPageGeo = [...book1.pagesGeo.values()].find(
    (pg) => pg.plane == selectedPageGeo
  );
  if (!selectedPageGeo) return;

  // rest stays the same, just swap newPageGeo → selectedPageGeo
  const pos = selectedPageGeo.geometry.attributes.position;
  const localPoint = selectedPageGeo.plane.worldToLocal(
    intersects[0].point.clone()
  );
  grab.copy(localPoint);
  grabWorldZ = intersects[0].point.z;
  prevMouseWorld.copy(intersects[0].point);

  grabbedIndexes.length = 0;
  grabbedVertices.clear();

  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - grab.x;
    const dy = pos.getY(i) - grab.y;
    const dz = pos.getZ(i) - grab.z;
    if (dx * dx + dy * dy + dz * dz <= grabRadius * grabRadius) {
      grabbedIndexes.push(i);
      grabbedVertices.set(i, {
        x: pos.getX(i),
        y: pos.getY(i),
        z: pos.getZ(i),
      });
    }
  }

  controls.enabled = false;

  if (
    springEnabled &&
    selectedPageGeo.geometry &&
    !selectedPageGeo.geometry.userData.springEdgesBuilt
  ) {
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
        3, // iterations (spring accumulation)
        300, // stiffness
        30, // bendStiffness
        0.7, // damping
        1 / 120,
        100
      ),
    });
  }
});
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

  applyMouseDrag(selectedPageGeo.geometry, grabbedIndexes, dx, dy, dz, 30);
  wakeUp();
});
canvas.addEventListener('mouseup', () => {
  // grabbedVertices.clear();
  // grabbedIndexes.length = 0;
  // selectedPageGeo = null;
  isDragging = false;
  controls.enabled = true;
  // renderAnimation();
});

// animation frame ================================

let renderAnimationId,
  toUpdate = false,
  springEnabled = false;
let isLooping = false,
  lastActivityTime = Date.now();
const IDLE_TIMEOUT = 6000;

const byGeo = new Map();
function renderAnimation() {
  if (APPLY_FORCES.length) {
    // group forces by geometry
    byGeo.clear();

    for (let i = APPLY_FORCES.length - 1; i >= 0; i--) {
      const entry = APPLY_FORCES[i];
      const f = entry.apply(true);
      if (entry.applyOnce) APPLY_FORCES.splice(i, 1);
      if (!f?.updated) continue;

      const geo = entry.geometry; // 👈 stored on the entry
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
  const timeSinceActivity = Date.now() - lastActivityTime;

  if (timeSinceActivity > IDLE_TIMEOUT) {
    isLooping = false;
    console.log('Loop Paused to save CPU');
    cancelAnimationFrame(renderAnimationId);
    return; // Stop the requestAnimationFrame chain
  }

  renderAnimationId = requestAnimationFrame(renderAnimation);
}
function wakeUp() {
  lastActivityTime = Date.now();
  if (!isLooping) {
    isLooping = true;
    renderAnimation();
    console.log('Loop Started');
  }
}
wakeUp();

window.addEventListener('keydown', (e) => {
  console.log(selectedPageGeo, 'selectedPageGeo');

  if (e.key == 'Escape') {
    console.log(1);
    cancelAnimationFrame(renderAnimationId);
  }

  if (e.key == 'b') {
    springEnabled = true;
    return;

    wakeUp();

    APPLY_FORCES.push({
      applyOnce: false,
      geometry:
        selectedPageGeo.geometry ?? [...book1.pagesGeo.values()][0].geometry,
      apply: applyPageSpringForces(
        selectedPageGeo.geometry,
        selectedPageGeo.geometry.attributes.position,
        selectedPageGeo.geometry.index.array,
        selectedPageGeo.geometry.attributes.position.array,
        1, // force unused here
        selectedPageGeo.geometry.userData.mass,
        new Set(), // dynamic pinned set, can be replaced/updated
        1, // iterations (spring accumulation)
        200, // stiffness
        3, // bendStiffness
        0.9, // damping
        1 / 90,
        5
      ),
    });
    //
    // APPLY_FORCES.push({
    //   applyOnce: false,
    //   apply: applyDistanceConstraints(
    //     selectedPageGeo.geometry,
    //     selectedPageGeo.geometry.attributes.position,
    //     selectedPageGeo.geometry.index.array,
    //     selectedPageGeo.geometry.attributes.position.array,
    //     1,
    //     selectedPageGeo.geometry.userData.mass
    //   ),
    // });
  }

  // Guard clause: stop here if no page is selected
  if (!selectedPageGeo) return;

  if (e.key == 'g') {
    wakeUp();

    // apply gravity on each render
    APPLY_FORCES.push({
      applyOnce: false,
      geometry: selectedPageGeo.geometry,
      apply: applyGravity(
        selectedPageGeo.geometry.attributes.position,
        selectedPageGeo.geometry.index.array,
        selectedPageGeo.geometry.attributes.position.array,
        GRAVITY,
        selectedPageGeo.geometry.userData.mass
      ),
    });
  }
  if (e.key == 'ArrowLeft') {
    wakeUp();

    APPLY_FORCES.push({
      applyOnce: true,
      geometry: selectedPageGeo.geometry,
      apply: applyLeftPush(
        selectedPageGeo.geometry,
        grabbedIndexes,
        0.3,
        selectedPageGeo.geometry.userData.mass
      ),
    });
  } else if (e.key == 'ArrowRight') {
    wakeUp();

    APPLY_FORCES.push({
      applyOnce: true,
      geometry: selectedPageGeo.geometry,
      apply: applyRightPush(
        selectedPageGeo.geometry.attributes.position,
        grabbedIndexes,
        grabbedVertices,
        0.1,
        selectedPageGeo.geometry.userData.mass
      ),
    });
  }
});
