import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { Book, Page, PageGeo } from '/src/classes.js';
import {
  applyForce,
  applyGravity,
  applyLeftPush,
  applyDistanceConstraints,
} from '/src/phy.js';
import { randomId } from '/src/utils.js';

// canvas
const canvas = document.querySelector('#canvas');
canvas.width = innerWidth;
canvas.height = innerHeight;

const MOUSE_MASS = 10; // basically infinite, cause mouse is the GOD xD
const APPLY_FORCES = [];
const GRAVITY = 0.01;

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
newPageGeo.geometry.translate(0, 0, 5);
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
  // console.log('r');
  renderer.render(scene, camera);
}

// initBook();
controls.update();

// utils

// ray casting =================================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const grabStartWorld = new THREE.Vector3();
const grab = new THREE.Vector3(); // grabStart
const grabRadius = 0.3;

const dragPlane = new THREE.Plane();
const dragWorld = new THREE.Vector3();
const dragLocal = new THREE.Vector3();

let grabbedIndexes = [];
let grabbedVertices = new Map();

let isDragging = false;
let selectedObject = null;
const minW = 0.3;

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

  const geometry = selectedObject.geometry;
  const pos = geometry.attributes.position;
  console.log(pos, pos.getX(0), geometry.index, 'pos');

  // local grab point: the point that the mouse clicked on. Local: the point on the geometry
  /**
   * intersects[0].point = world hit position
   worldToLocal() = convert to object space
   local space = where vertex positions live
   clone to avoid mutation bugs
   */
  const localPoint = selectedObject.worldToLocal(intersects[0].point.clone());
  grab.copy(localPoint);
  // world grab point
  grabStartWorld.copy(intersects[0].point);
  console.log(grabStartWorld, 'wg');
  console.log(grab, 'lg');

  // drag plane faces camera
  dragPlane.setFromNormalAndCoplanarPoint(
    camera.getWorldDirection(new THREE.Vector3()).negate(),
    grabStartWorld
  );

  grabbedIndexes.length = 0;
  grabbedVertices.clear();

  // select vertices within radius// sqrt((x2 - x1)^2 + (y2 - y1)^2)
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - grab.x;
    const dy = pos.getY(i) - grab.y;
    const dz = pos.getZ(i) - grab.z;

    // const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // const t = Math.min(dist / grabRadius, 1);
    // const weight = minW + (0.4 - minW) * (0.4 - t);

    // const t = dist / grabRadius;
    // const clamped = Math.min(Math.max(t, 0), 1);
    // const weight = 1 - clamped;
    // const weight = 1 - clamped * clamped * (3 - 2 * clamped);

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

  updateMousePosition(event);
  raycaster.setFromCamera(mouse, camera);

  // intersect mouse ray with drag plane
  if (!raycaster.ray.intersectPlane(dragPlane, dragWorld)) return;

  // compute world delta
  dragWorld.sub(grabStartWorld);

  // convert to local space
  dragLocal.copy(dragWorld);
  selectedObject.worldToLocal(dragLocal);

  const pos = selectedObject.geometry.attributes.position;

  // apply to original positions
  for (const i of grabbedIndexes) {
    const o = grabbedVertices.get(i);
    pos.setXYZ(
      i,
      o.x + dragLocal.x,
      o.y + dragLocal.y,
      o.z + dragLocal.z
      // o.x + dragLocal.x * o.weight,
      // o.y + dragLocal.y * o.weight,
      // o.z + dragLocal.z * o.weight
    );
  }

  pos.needsUpdate = true;
  selectedObject.geometry.computeVertexNormals();
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

let renderAnimationId;
function renderAnimation() {
  if (APPLY_FORCES.length) {
    let toApply = new Float32Array(
      newPageGeo.geometry.attributes.position.count * 3
    );

    for (let i = APPLY_FORCES.length - 1; i >= 0; i--) {
      const z = APPLY_FORCES[i];

      const f = z.apply(true);
      if (!f) continue;
      console.log(f, 'f');

      for (let i = 0; i < toApply.length; i++) {
        toApply[i] += f[i];
      }

      if (z.applyOnce) {
        console.log('z');
        APPLY_FORCES.splice(i, 1);
      }
    }

    console.log(toApply, APPLY_FORCES[0], 'toApply');

    toApply && applyForce(newPageGeo.geometry, toApply);
  }

  renderFun();

  renderAnimationId = requestAnimationFrame(renderAnimation);
}
renderAnimation();

window.addEventListener('keydown', (e) => {
  // console.log(e.key);
  if (e.key == 'Escape') {
    console.log(1);
    cancelAnimationFrame(renderAnimationId);
  }
  console.log(e.key);
  if (e.key == 'b') {
    // newPageGeo.geometry.translate(0, 0, 5);
    APPLY_FORCES.push({
      applyOnce: false,
      apply: applyDistanceConstraints(
        newPageGeo.geometry,
        newPageGeo.geometry.attributes.position,
        newPageGeo.geometry.index.array,
        newPageGeo.geometry.attributes.position.array,
        1,
        newPageGeo.geometry.userData.mass,
        new Set(grabbedIndexes),
        10
      ),
    });
  }
  if (e.key == 'g') {
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

    // APPLY_FORCES.push({
    //   applyOnce: false,
    //   apply: applyAntiGravity(
    //     newPageGeo.geometry,
    //     0.0001,
    //     newPageGeo.geometry.userData.mass
    //   ),
    // });

    console.log(APPLY_FORCES);
    // animationManager();
  }
  if (e.key == 'ArrowLeft') {
    console.log(grabbedVertices, grabbedIndexes);
    APPLY_FORCES.push({
      applyOnce: true,
      apply: applyLeftPush(
        newPageGeo.geometry.attributes.position,
        grabbedIndexes,
        grabbedVertices,
        0.01,
        newPageGeo.geometry.userData.mass
      ),
    });
  }
});
