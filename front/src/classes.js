import * as THREE from 'three';

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

    //
    this.activePagesGeo = []; // the pages on the top/the pages user is reading //queue
  }
  addPage(id, page) {
    /**
     *  page- a mesh object
     */
    if (!id || !page) return;

    this.pages.set(id, page);
  }
  addPageGeo(id, pageGeo) {
    /**
     *  page- a mesh object
     */
    if (!id || !pageGeo) return;

    this.pagesGeo.set(id, pageGeo);
  }
  addActivePageGeo(id) {
    /**
     */
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
    /**
     */
    this.id = id;
    this.pn = pageNumber;
    this.content = 'avada-kedavra';
  }
  info() {
    return this;
  }
}
class PageGeo {
  constructor(id, width, height, color = 0xfafafa, wire = true) {
    /**
     */
    this.id = id;
    /**
     * force = mass * accelaration // assuming all the things have a mass of 1
     */
    this.mass = 1;

    // each page is double sided, so, from ltr perspective, one id and page number for the left, and other for the right.
    this.geometry = new THREE.PlaneGeometry(width, height, 10, 20);
    // this.geometry.translate(width / 1.9, height / 2, 0);
    this.geometry.userData.original = new Float32Array(
      this.geometry.attributes.position.array
    );
    this.geometry.userData.mass = this.mass;

    this.material = new THREE.MeshLambertMaterial({
      color: color,
      side: THREE.DoubleSide,
      wireframe: wire,
      flatShading: false,
      // map: new THREE.TextureLoader().load('data:image/png;base64,iVBORw0KG...'),
      emissive: 0x222222, // Slight glow
    });

    // this.material.frustumCulled = false;
    this.plane = new THREE.Mesh(this.geometry, this.material);

    //
    this.pagesMeta = []; // 0 - left, 1 - right
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
