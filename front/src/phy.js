export function applyGravity(pos, indexes, vertices, force = 0, mass = 0) {
  if (!pos || !indexes || !vertices || !force || !mass) return null;

  const acc = force / mass,
    maxVel = 0.1;

  let vel = 0;

  return (refresh) => {
    let inMotion = false;
    // acc will automatically become less if the force of gravity is less than other,
    vel += acc;

    // create a new Float32Array for updated positions
    const result = new Float32Array(vertices.length * 3);
    for (let i = 0; i < vertices.length; i++) {
      const currentZ = pos.getZ(i);
      /** rules of gravity
       * all the Z should not be less than 0.
       * 0 is the imaginary plane.
       */
      if (currentZ <= 0) continue;

      inMotion = true;
      const deltaZ = Math.min(maxVel, vel); //Math.max(0, currentZ - vel);

      result[i * 3] = 0;
      result[i * 3 + 1] = 0;
      result[i * 3 + 2] = -deltaZ; //nextZ - original[i * 3 + 2];
    }

    if (!inMotion) {
      vel = 0;
    }

    return result;
  };
}

export function applyLeftPush(pos, indexes, vertices, force = 0, mass = 0) {
  if (!pos || !indexes || !vertices || !force || !mass) return null;

  const acc = force / mass,
    maxVel = 0.05;

  let vel = 0;

  return (refresh) => {
    // acc will automatically become less if the force of gravity is less than other,
    vel += acc;

    // create a new Float32Array for updated positions
    const result = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      /** rules of a page
       * Z cannot go below 0.
       * Active page XYZ cannot be below any other page's XYZ, if it's on top.
       *
       * 0 is the imaginary plane.
       */

      if (!indexes.includes(i)) continue;

      const deltaX = maxVel;
      const deltaZ = maxVel / 2;

      result[i * 3] = -deltaX;
      result[i * 3 + 1] = 0;
      result[i * 3 + 2] = deltaZ;
    }

    return result;
  };
}

export function applyAntiGravity(geometry, force = 0, mass = 0, ceilingZ = 10) {
  if (!geometry || !force || !mass) return null;

  const maxVel = 0.1,
    acc = force / mass;

  let original = geometry.userData.original,
    pos = geometry.attributes.position,
    vel = 0;

  return (refresh) => {
    let inMotion = false;
    vel += acc;

    if (refresh) {
      original = geometry.userData.original;
      pos = geometry.attributes.position;
    }

    const result = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const currentZ = pos.getZ(i);
      if (currentZ >= ceilingZ) continue;

      inMotion = true;
      const deltaZ = Math.min(maxVel, vel); //Math.min(ceilingZ, currentZ + vel);

      result[i * 3] = 0;
      result[i * 3 + 1] = 0;
      result[i * 3 + 2] = deltaZ; //nextZ - original[i * 3 + 2];
    }

    if (!inMotion) {
      vel = 0;
    }

    return result;
  };
}

export function applyForce(geometry, delta, inMotion = false) {
  if (!geometry || !delta) return 0;

  const pos = geometry.attributes.position;
  const original = geometry.userData.original;

  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + delta[i * 3],
      pos.getY(i) + delta[i * 3 + 1],
      pos.getZ(i) + delta[i * 3 + 2]
    );
  }

  pos.needsUpdate = true;
  if (!inMotion) {
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    return 0;
  }

  return 1;
}
