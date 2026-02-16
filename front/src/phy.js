export function applyGravity(pos, indices, vertices, force = 0, mass = 0) {
  if (!pos || !indices || !vertices || !force || !mass) return null;

  const acc = force / mass,
    maxVel = 0.1;

  let vel = 0;

  return (refresh) => {
    let inMotion = false;

    // acc will automatically become less if the force of gravity is less than other,
    vel += acc;
    vel = Math.min(maxVel, vel);

    // create a new Float32Array for updated positions
    const result = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const currentZ = pos.getZ(i);
      /** rules of gravity
       * all the Z should not be less than 0.
       * 0 is the imaginary plane.
       */
      if (currentZ <= 0) continue;

      inMotion = true;
      const deltaZ = vel; //Math.max(0, currentZ - vel);

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

export function applyLeftPush(pos, indices, vertices, force = 0, mass = 0) {
  if (!pos || !indices || !vertices || !force || !mass) return null;

  const acc = force / mass,
    maxVel = 0.5;

  let vel = 0;

  return (refresh) => {
    // acc will automatically become less if the force of gravity is less than other,
    vel += acc;
    vel = Math.min(maxVel, vel);

    // create a new Float32Array for updated positions
    const result = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      /** rules of a page
       * Z cannot go below 0. (Thats the imaginary plane)
       * Active page XYZ cannot be below any other page's XYZ, if it's on top.
       *
       */

      if (!indices.includes(i)) continue;

      const deltaX = vel;
      const deltaZ = vel / 2;

      result[i * 3] = -deltaX;
      result[i * 3 + 1] = 0;
      result[i * 3 + 2] = deltaZ;
    }

    return result;
  };
}

export function applyDistanceConstraints(
  geometry,
  pos,
  indices,
  vertices,
  force = 0,
  mass = 0,
  pinned = new Set(),
  iterations = 8
) {
  if (!pos || !indices || !vertices || !force || !mass) return null;

  // Build constraints once
  if (!geometry.userData.constraints) {
    const constraints = [];
    const edges = new Set();

    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];

      const pairs = [
        [a, b],
        [b, c],
        [c, a],
      ];

      for (const [i1, i2] of pairs) {
        const key = i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`;
        if (edges.has(key)) continue;
        edges.add(key);

        const dx = pos.getX(i2) - pos.getX(i1);
        const dy = pos.getY(i2) - pos.getY(i1);
        const dz = pos.getZ(i2) - pos.getZ(i1);
        const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

        constraints.push({ i1, i2, restLength });
      }
    }

    geometry.userData.constraints = constraints;
  }

  return () => {
    const constraints = geometry.userData.constraints;

    for (let k = 0; k < iterations; k++) {
      for (const { i1, i2, restLength } of constraints) {
        if (pinned.has(i1) && pinned.has(i2)) continue;

        const x1 = pos.getX(i1);
        const y1 = pos.getY(i1);
        const z1 = pos.getZ(i1);

        const x2 = pos.getX(i2);
        const y2 = pos.getY(i2);
        const z2 = pos.getZ(i2);

        const dx = x2 - x1;
        const dy = y2 - y1;
        const dz = z2 - z1;

        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist === 0) continue;

        const diff = (dist - restLength) / dist;
        const corrX = dx * 0.5 * diff;
        const corrY = dy * 0.5 * diff;
        const corrZ = dz * 0.5 * diff;

        if (!pinned.has(i1)) {
          pos.setXYZ(i1, x1 + corrX, y1 + corrY, z1 + corrZ);
        }

        if (!pinned.has(i2)) {
          pos.setXYZ(i2, x2 - corrX, y2 - corrY, z2 - corrZ);
        }
      }
    }

    pos.needsUpdate = true;
    geometry.computeVertexNormals();
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
