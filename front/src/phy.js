export function applyGravity(indexes, vertices, force = 0, mass = 0) {
  if (!indexes || !vertices || !force || !mass) return null;

  const acc = force / mass,
    maxVel = 0.1;

  let vel = 0;

  return (refresh) => {
    let inMotion = false;
    // acc will automatically become less if the force of gravity is less than other,
    vel += acc;

    // create a new Float32Array for updated positions
    const result = new Float32Array(vertices.size * 3);
    for (let i = 0; i < vertices.size; i++) {
      const currentZ = pos.getZ(i);
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

export function applyLeftPush(indexes, vertices, force = 0, mass = 0) {
  if (!geometry || !force || !mass) return null;

  const acc = force / mass,
    maxVel = 0.05;

  let vel = 0,
    pos = geometry.attributes.position;

  return (refresh) => {
    // acc will automatically become less if the force of gravity is less than other,
    vel = acc;

    if (refresh) {
      pos = geometry.attributes.position;
    }

    // create a new Float32Array for updated positions
    const result = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const deltaX = 2 * maxVel;
      const deltaZ = maxVel;

      result[i * 3] = -deltaX;
      result[i * 3 + 1] = 0;
      result[i * 3 + 2] = -deltaZ;
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
