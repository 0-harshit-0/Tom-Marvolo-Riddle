import * as THREE from 'three';

/**
 * Builds a per-vertex bilinear binding from the paper geometry onto the
 * (coarser) wrapper geometry.  For every paper vertex we store which four
 * wrapper quad-corners surround it (in the original rest-pose UV space) and
 * the four bilinear weights that reconstruct its position.
 *
 * @param {THREE.BufferGeometry} paperGeo
 * @param {THREE.BufferGeometry} wrapperGeo
 * @param {number} wSegs  wrapper widthSegments
 * @param {number} hSegs  wrapper heightSegments
 * @returns {Array<{indices: number[], weights: number[]}>}
 */
function buildPageToWrapperMap(paperGeo, wrapperGeo, wSegs, hSegs) {
  const orig = paperGeo.userData.original;
  const wOrig = wrapperGeo.userData.original;
  const wCount = wrapperGeo.attributes.position.count;
  const rowSize = wSegs + 1;
  const count = paperGeo.attributes.position.count;

  // Tight bounds from wrapper rest positions
  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity;
  for (let i = 0; i < wCount; i++) {
    const x = wOrig[i * 3],
      y = wOrig[i * 3 + 1];
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }

  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const map = new Array(count);

  for (let i = 0; i < count; i++) {
    const px = orig[i * 3];
    const py = orig[i * 3 + 1];

    // Normalised position inside the wrapper [0, 1]
    const u = Math.max(0, Math.min(1, (px - xMin) / xRange));
    const v = Math.max(0, Math.min(1, (py - yMin) / yRange));

    // Which wrapper cell does this vertex fall in?
    const cx = Math.min(Math.floor(u * wSegs), wSegs - 1);
    const cy = Math.min(Math.floor(v * hSegs), hSegs - 1);

    // Local [0,1] coords inside the cell
    const lu = u * wSegs - cx;
    const lv = v * hSegs - cy;

    // Four corners of the wrapper quad (row-major, bottom = lower cy)
    const i00 = cy * rowSize + cx;
    const i10 = cy * rowSize + (cx + 1);
    const i01 = (cy + 1) * rowSize + cx;
    const i11 = (cy + 1) * rowSize + (cx + 1);

    map[i] = {
      indices: [i00, i10, i01, i11],
      weights: [
        (1 - lu) * (1 - lv), // i00
        lu * (1 - lv), // i10
        (1 - lu) * lv, // i01
        lu * lv, // i11
      ],
    };
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────

class Book {
  constructor(
    id,
    name = 'Fliptionary',
    desc = 'santa claus',
    pages = new Map(),
    pagesGeo = new Map()
  ) {
    this.id = id;

    this.name = name;
    this.desc = desc;
    this.pages = pages;
    this.pagesGeo = pagesGeo;

    this.activePagesGeo = [];
  }
  addPage(id, page) {
    if (!id || !page) return;
    this.pages.set(id, page);
  }
  addPageGeo(id, pageGeo) {
    if (!id || !pageGeo) return;
    this.pagesGeo.set(id, pageGeo);
  }
  addActivePageGeo(id) {
    if (!id || this.activePagesGeo.length > 2) return;
    let removed = null;
    if (this.activePagesGeo.length == 2) removed = this.activePagesGeo.shift();
    this.activePagesGeo.push(id);
    return removed;
  }
  info() {
    return this;
  }
}

class Page {
  constructor(id, pageNumber) {
    this.id = id;
    this.pn = pageNumber;
    this.content = 'avada-kedavra';
  }
  info() {
    return this;
  }
}

class PageGeo {
  constructor(id, width, height, color = 0xfafafa, wire = false) {
    this.id = id;
    this.mass = 1;

    // ── Visible paper mesh (fine, 10×20 segments) ──────────────────────────
    this.geometry = new THREE.PlaneGeometry(width, height, 10, 20);
    this.geometry.translate(width / 1.9, 0, 0);

    this.geometry.userData.original = new Float32Array(
      this.geometry.attributes.position.array
    );
    this.geometry.userData.mass = this.mass;

    const pos = this.geometry.attributes.position;
    const xs = [];
    for (let i = 0; i < pos.count; i++) xs.push(pos.getX(i));
    this.geometry.userData.hingeX = Math.min(...xs);
    this.geometry.userData.maxX = Math.max(...xs);

    const texture = new THREE.TextureLoader().load('paper.jpg');
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    this.material = new THREE.MeshLambertMaterial({
      map: texture,
      side: THREE.DoubleSide,
      wireframe: wire,
      flatShading: false,
      emissive: 0x111111,
    });
    this.material.shadowSide = THREE.BackSide;

    this.plane = new THREE.Mesh(this.geometry, this.material);

    // ── Invisible wrapper mesh (coarse, 3×6 segments) ──────────────────────
    // This is the control cage the mouse actually interacts with.
    // The paper mesh is driven to follow it each frame via bilinear springs.
    const WRAPPER_W_SEGS = 3;
    const WRAPPER_H_SEGS = 6;

    this.wrapperGeometry = new THREE.PlaneGeometry(
      width,
      height,
      WRAPPER_W_SEGS,
      WRAPPER_H_SEGS
    );
    this.wrapperGeometry.translate(width / 1.9, 0, 0);

    // Mirror the same userData that phy.js functions expect
    this.wrapperGeometry.userData.original = new Float32Array(
      this.wrapperGeometry.attributes.position.array
    );
    this.wrapperGeometry.userData.mass = this.mass;

    const wPos = this.wrapperGeometry.attributes.position;
    const wXs = [];
    for (let i = 0; i < wPos.count; i++) wXs.push(wPos.getX(i));
    this.wrapperGeometry.userData.hingeX = Math.min(...wXs);
    this.wrapperGeometry.userData.maxX = Math.max(...wXs);

    // Pre-initialise velocities so applyMouseDrag works on the very first drag
    this.wrapperGeometry.userData.springVelocities = new Float32Array(
      wPos.count * 3
    );

    this.wrapperMesh = new THREE.Mesh(
      this.wrapperGeometry,
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0, // fully invisible — raycast target only
        side: THREE.DoubleSide,
        depthWrite: false, // don't occlude the paper behind it
      })
    );

    // ── Bilinear UV map: paper vertex → wrapper quad ────────────────────────
    this.wrapperUVMap = buildPageToWrapperMap(
      this.geometry,
      this.wrapperGeometry,
      WRAPPER_W_SEGS,
      WRAPPER_H_SEGS
    );

    // ──
    this.pagesMeta = [];
  }

  addMetas(metas) {
    metas.forEach((z) => {
      this.pagesMeta.push(z);
    });
  }
  info() {
    return this;
  }
}

export { Book, Page, PageGeo };
