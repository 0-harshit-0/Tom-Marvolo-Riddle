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
const ambientLight = new THREE.AmbientLight(0x404040, 1);
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
// // if bigger size
// light.shadow.mapSize.width = 2048;
// light.shadow.mapSize.height = 2048;

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
// function initBook() {
//   const oldPages = [];
//   for (let i = 0; i < 10; i++) {
//     const newPage = new Page(randomId(), i);
//     oldPages.push(newPage);

//     if (oldPages.length == 2) {
//       const newPageGeo = new PageGeo(randomId(), 2, 4);

//       const pos = newPageGeo.geometry.attributes.position;

//       newPageGeo.addMetas(oldPages);
//       newPageGeo.geometry.userData.original = new Float32Array(pos.array);
//       newPageGeo.geometry.userData.angle ??= 0;
//       newPageGeo.geometry.userData.hingeX = Math.min(
//         ...newPageGeo.geometry.userData.original.filter((_, i) => i % 3 === 0)
//       );
//       newPageGeo.geometry.userData.maxX = Math.max(
//         ...newPageGeo.geometry.userData.original.filter((_, i) => i % 3 === 0)
//       );

//       console.log(newPageGeo.vertices().count, 'ver');

//       book1.addPageGeo(newPageGeo.id, newPageGeo);
//       oldPages.length = 0;
//     }

//     book1.addPage(newPage.id, newPage);
//   }

//   let z = 0.05;
//   book1.pagesGeo.forEach((value, key, map) => {
//     value.plane.position.set(0, 0, z);
//     scene.add(value.plane);
//     value.plane.castShadow = true; // Plane casts shadow
//     value.plane.receiveShadow = true; // Plane receives shadow
//     z -= 0.01;
//   });

//   // book clip
//   const geometry = new THREE.CylinderGeometry(0.05, 0.05, 4, 16);
//   const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
//   const ball = new THREE.Mesh(geometry, material);
//   ball.position.set(0, 2, 0.05); // top-left-up all positive
//   scene.add(ball);

//   // const iterator = book1.pagesGeo.keys();
//   // book1.addActivePageGeo(iterator.next().value);
//   // book1.addActivePageGeo(iterator.next().value);
//   // console.log(book1.info(), oldPages);
// }

// book clip
const ballgeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.1, 16);
const ballmaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
const ball = new THREE.Mesh(ballgeometry, ballmaterial);
ball.position.set(0, 0, 0); // top-left-up all positive
scene.add(ball);

const newPageGeo = new PageGeo(randomId(), 2, 4);
newPageGeo.geometry.translate(0, 0, 1);
// newPageGeo.plane.position.set(0, 0, 5);
scene.add(newPageGeo.plane);

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

// initBook();
controls.update();

// ray casting =================================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const grab = new THREE.Vector3(); // grabStart
const grabRadius = 0.3;

let grabbedIndexes = [];
let grabbedVertices = new Map();

let isDragging = false;
let selectedObject = null;

// Convert mouse position to normalized device coordinates
function updateMousePosition(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

canvas.addEventListener('mousedown', (event) => {
  updateMousePosition(event);
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObject(newPageGeo.plane);
  if (!intersects.length) return;

  isDragging = true;
  selectedObject = intersects[0].object;

  const pos = selectedObject.geometry.attributes.position;
  console.log(pos, pos.getX(0), selectedObject.geometry.index, 'pos');

  grabbedIndexes.length = 0;
  grabbedVertices.clear();

  const localPoint = selectedObject.worldToLocal(intersects[0].point.clone());
  grab.copy(localPoint);

  // select vertices within radius// sqrt((x2 - x1)^2 + (y2 - y1)^2)
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
        // weight:
        //   dx * dx + dy * dy + dz * dz <= grabRadius * grabRadius ? weight : 0,
      });
    }
  }

  controls.enabled = false;
});

canvas.addEventListener('mousemove', (event) => {
  if (!isDragging || !selectedObject) return;
  console.log(selectedObject);

  renderFun();
});

canvas.addEventListener('mouseup', () => {
  // renderAnimation();
  isDragging = false;
  selectedObject = null;
  // grabbedIndexes.length = 0;
  // grabbedVertices.clear();
  controls.enabled = true;
});

// animation frame ================================

let renderAnimationId,
  toUpdate = false;
let isLooping = false,
  lastActivityTime = Date.now();
const IDLE_TIMEOUT = 6000; // 3 seconds

function renderAnimation() {
  let physicsStillMoving = false;

  if (APPLY_FORCES.length) {
    toUpdate = false;
    let toApply = new Float32Array(
      newPageGeo.geometry.attributes.position.count * 3
    );

    for (let i = APPLY_FORCES.length - 1; i >= 0; i--) {
      const z = APPLY_FORCES[i];

      const f = z.apply(true);
      if (z.applyOnce) {
        APPLY_FORCES.splice(i, 1);
      }

      if (!f || !f.updated) continue;

      toUpdate = true;
      physicsStillMoving = true;

      for (let i = 0; i < toApply.length; i++) {
        toApply[i] += f.result[i];
      }
    }

    if (toApply && toUpdate) {
      applyForce(newPageGeo.geometry, toApply);
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
  // console.log(e.key);
  if (e.key == 'Escape') {
    console.log(1);
    cancelAnimationFrame(renderAnimationId);
  }
  if (e.key == 'b') {
    wakeUp();

    // newPageGeo.geometry.translate(0, 0, 5);
    APPLY_FORCES.push({
      applyOnce: false,

      apply: applyPageSpringForces(
        newPageGeo.geometry,
        newPageGeo.geometry.attributes.position,
        newPageGeo.geometry.index.array,
        newPageGeo.geometry.attributes.position.array,
        1, // force unused here
        newPageGeo.geometry.userData.mass,
        new Set(), // dynamic pinned set, can be replaced/updated
        2, // iterations (spring accumulation)
        100, // stiffness
        5, // bendStiffness
        0.8, // damping
        1 / 60,
        5
      ),
    });
    //
    // APPLY_FORCES.push({
    //   applyOnce: false,
    //   apply: applyDistanceConstraints(
    //     newPageGeo.geometry,
    //     newPageGeo.geometry.attributes.position,
    //     newPageGeo.geometry.index.array,
    //     newPageGeo.geometry.attributes.position.array,
    //     1,
    //     newPageGeo.geometry.userData.mass
    //   ),
    // });
  }
  if (e.key == 'g') {
    wakeUp();

    // apply gravity on each render
    APPLY_FORCES.push({
      applyOnce: false,
      apply: applyGravity(
        newPageGeo.geometry.attributes.position,
        newPageGeo.geometry.index.array,
        newPageGeo.geometry.attributes.position.array,
        GRAVITY,
        newPageGeo.geometry.userData.mass
      ),
    });
    console.log(APPLY_FORCES);
  }
  if (e.key == 'ArrowLeft') {
    wakeUp();

    console.log(grabbedVertices, grabbedIndexes);
    APPLY_FORCES.push({
      applyOnce: true,
      apply: applyLeftPush(
        newPageGeo.geometry,
        grabbedIndexes,
        0.3,
        newPageGeo.geometry.userData.mass
      ),
    });
  } else if (e.key == 'ArrowRight') {
    wakeUp();

    APPLY_FORCES.push({
      applyOnce: true,
      apply: applyRightPush(
        newPageGeo.geometry.attributes.position,
        grabbedIndexes,
        grabbedVertices,
        0.1,
        newPageGeo.geometry.userData.mass
      ),
    });
  }
});
