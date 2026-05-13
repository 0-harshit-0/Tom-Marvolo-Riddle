export function applyGravity(pos, indices, vertices, force = 0, mass = 0) {
  if (!pos || !indices || !vertices || !force || !mass) return null;

  const acc = force / mass,
    maxVel = 1;

  let vel = 0;

  return (refresh) => {
    let inMotion = false;

    vel += acc;
    vel = Math.min(maxVel, vel);

    const result = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const currentZ = pos.getZ(i);
      if (currentZ <= 0) continue;

      inMotion = true;
      const deltaZ = vel;

      result[i * 3] = 0;
      result[i * 3 + 1] = 0;
      result[i * 3 + 2] = -deltaZ;
    }

    if (!inMotion) {
      vel = 0;
    }

    return { updated: inMotion, result };
  };
}

export function applyMouseDrag(
  geometry,
  grabbedIndexes,
  deltaX,
  deltaY,
  deltaZ,
  strength = 1
) {
  if (!geometry || !grabbedIndexes.length) return;
  const velocities = geometry.userData.springVelocities;
  if (!velocities) return;

  const hingeX = geometry.userData.hingeX;
  const maxX = geometry.userData.maxX;
  const pos = geometry.attributes.position;

  for (const i of grabbedIndexes) {
    const originalX = geometry.userData.original[i * 3];
    const distFromHinge = originalX - hingeX;

    const normalized = Math.abs(distFromHinge / (maxX - hingeX));
    const zFactor = normalized;

    const currentX = pos.getX(i);

    const sideMultiplier = currentX < hingeX ? 1 : -1;
    const zDelta = deltaX * sideMultiplier;

    let xAssist = 1;
    const movingAwayFromHinge =
      (deltaX > 0 && currentX > hingeX) || (deltaX < 0 && currentX < hingeX);

    if (movingAwayFromHinge) {
      xAssist = 1.4;
    }

    const zDampener = zDelta < 0 ? 0.5 : 1.2;

    velocities[i * 3] += deltaX * strength * xAssist;
    velocities[i * 3 + 1] += deltaY * strength;
    velocities[i * 3 + 2] += zDelta * zFactor * zDampener * strength;
  }
}

export function applyLeftPush(geometry, indices, force = 0.5) {
  if (!geometry || !indices.length) return null;

  const velocities = geometry.userData.springVelocities;
  const hingeX = geometry.userData.hingeX;
  const pos = geometry.attributes.position;

  return () => {
    for (const i of indices) {
      const currentX = pos.getX(i);
      const zDirection = currentX - hingeX > 0 ? 1 : -1;

      velocities[i * 3] -= force;
      velocities[i * 3 + 2] += force * zDirection;
    }

    return { updated: false, result: null };
  };
}

export function applyRightPush(pos, indices, vertices, force = 0, mass = 0) {
  if (!pos || !indices || !vertices || !force || !mass) return null;

  const acc = force / mass,
    maxVel = 0.5;

  let vel = 0;

  return (refresh) => {
    vel += acc;
    vel = Math.min(maxVel, vel);

    const result = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      if (!indices.includes(i)) continue;

      const deltaX = vel;
      const deltaZ = vel / 2;

      result[i * 3] = deltaX;
      result[i * 3 + 1] = 0;
      result[i * 3 + 2] = deltaZ;
    }

    return { updated: 1, result };
  };
}

export function applyClothDistanceConstraints(
  geometry,
  pos,
  indices,
  vertices,
  force = 0,
  mass = 0,
  pinned = new Set(),
  iterations = 8
) {
  if (!pos || !indices || !geometry) return null;

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

    return { updated: 1, result };
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
  iterations = 30,
  stiffness = 0.95,
  bendStiffness = 0.9
) {
  if (!geometry || !pos || !indices) return null;

  const index = indices;

  if (!geometry.userData.constraintsBuilt) {
    const structural = [];
    const bending = [];
    const edges = new Set();

    const addEdge = (list, i1, i2) => {
      const key = i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`;
      if (edges.has(key)) return;
      edges.add(key);

      const dx = pos.getX(i2) - pos.getX(i1);
      const dy = pos.getY(i2) - pos.getY(i1);
      const dz = pos.getZ(i2) - pos.getZ(i1);
      const rest = Math.sqrt(dx * dx + dy * dy + dz * dz);

      list.push({ i1, i2, rest });
    };

    for (let i = 0; i < index.length; i += 3) {
      addEdge(structural, index[i], index[i + 1]);
      addEdge(structural, index[i + 1], index[i + 2]);
      addEdge(structural, index[i + 2], index[i]);
    }

    const wSeg = geometry.parameters.widthSegments;
    const hSeg = geometry.parameters.heightSegments;
    const rowSize = wSeg + 1;

    for (let y = 0; y <= hSeg; y++) {
      for (let x = 0; x <= wSeg; x++) {
        const i = y * rowSize + x;
        if (x + 2 <= wSeg) addEdge(bending, i, y * rowSize + (x + 2));
        if (y + 2 <= hSeg) addEdge(bending, i, (y + 2) * rowSize + x);
        if (x + 2 <= wSeg && y + 2 <= hSeg)
          addEdge(bending, i, (y + 2) * rowSize + (x + 2));
        if (x - 2 >= 0 && y + 2 <= hSeg)
          addEdge(bending, i, (y + 2) * rowSize + (x - 2));
      }
    }

    const hingeX = geometry.userData.hingeX;
    const hingePinned = new Set();
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(geometry.userData.original[i * 3] - hingeX) < 0.001) {
        hingePinned.add(i);
      }
    }

    geometry.userData.dcStructural = structural;
    geometry.userData.dcBending = bending;
    geometry.userData.dcHingePinned = hingePinned;
    geometry.userData.constraintsBuilt = true;
  }

  const { dcStructural, dcBending, dcHingePinned } = geometry.userData;

  const count = pos.count;
  const cur = new Float32Array(count * 3);

  const getX = (buf, i) => buf[i * 3];
  const getY = (buf, i) => buf[i * 3 + 1];
  const getZ = (buf, i) => buf[i * 3 + 2];
  const setXYZ = (buf, i, x, y, z) => {
    buf[i * 3] = x;
    buf[i * 3 + 1] = y;
    buf[i * 3 + 2] = z;
  };

  return () => {
    for (let i = 0; i < count; i++) {
      cur[i * 3] = pos.getX(i);
      cur[i * 3 + 1] = pos.getY(i);
      cur[i * 3 + 2] = pos.getZ(i);
    }

    const allPinned = new Set([...pinned, ...dcHingePinned]);

    const solve = (constraints, stiff) => {
      for (const { i1, i2, rest } of constraints) {
        const isPinned1 = allPinned.has(i1);
        const isPinned2 = allPinned.has(i2);
        if (isPinned1 && isPinned2) continue;

        const x1 = getX(cur, i1);
        const y1 = getY(cur, i1);
        const z1 = getZ(cur, i1);

        const x2 = getX(cur, i2);
        const y2 = getY(cur, i2);
        const z2 = getZ(cur, i2);

        const dx = x2 - x1;
        const dy = y2 - y1;
        const dz = z2 - z1;

        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist === 0) continue;

        const diff = (dist - rest) / dist;

        if (isPinned1 && !isPinned2) {
          setXYZ(
            cur,
            i2,
            x2 - dx * diff * stiff,
            y2 - dy * diff * stiff,
            z2 - dz * diff * stiff
          );
        } else if (!isPinned1 && isPinned2) {
          setXYZ(
            cur,
            i1,
            x1 + dx * diff * stiff,
            y1 + dy * diff * stiff,
            z1 + dz * diff * stiff
          );
        } else {
          const corrX = dx * 0.5 * diff * stiff;
          const corrY = dy * 0.5 * diff * stiff;
          const corrZ = dz * 0.5 * diff * stiff;

          setXYZ(cur, i1, x1 + corrX, y1 + corrY, z1 + corrZ);
          setXYZ(cur, i2, x2 - corrX, y2 - corrY, z2 - corrZ);
        }
      }
    };

    for (let k = 0; k < iterations; k++) {
      solve(dcStructural, stiffness);
      solve(dcBending, bendStiffness);

      for (const i of dcHingePinned) {
        const ox = geometry.userData.original[i * 3];
        const oy = geometry.userData.original[i * 3 + 1];
        const oz = geometry.userData.original[i * 3 + 2];
        setXYZ(cur, i, ox, oy, oz);
      }
    }

    const result = new Float32Array(count * 3);
    let maxDelta = 0;
    for (let i = 0; i < count; i++) {
      const sx = pos.getX(i);
      const sy = pos.getY(i);
      const sz = pos.getZ(i);

      const rx = cur[i * 3] - sx;
      const ry = cur[i * 3 + 1] - sy;
      const rz = cur[i * 3 + 2] - sz;

      result[i * 3] = rx;
      result[i * 3 + 1] = ry;
      result[i * 3 + 2] = rz;

      maxDelta = Math.max(maxDelta, Math.abs(rx), Math.abs(ry), Math.abs(rz));
    }

    const updated = maxDelta > 1e-7;
    return { updated, result };
  };
}

export function applyPageSpringForces(
  geometry,
  pos,
  indices,
  vertices,
  force = 0,
  mass = 0,
  pinned = new Set(),
  iterations = 1,
  stiffness = 150,
  bendStiffness = 30,
  damping = 0.95,
  dt = 1 / 60,
  maxVel = 16.0
) {
  if (!geometry || !pos || !indices) return null;

  if (!geometry.userData.springEdgesBuilt) {
    const structural = [];
    const bending = [];
    const edges = new Set();

    const addEdge = (list, i1, i2) => {
      const key = i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`;
      if (edges.has(key)) return;
      edges.add(key);

      const dx = pos.getX(i2) - pos.getX(i1);
      const dy = pos.getY(i2) - pos.getY(i1);
      const dz = pos.getZ(i2) - pos.getZ(i1);
      const rest = Math.sqrt(dx * dx + dy * dy + dz * dz);
      list.push({ i1, i2, rest });
    };

    for (let i = 0; i < indices.length; i += 3) {
      addEdge(structural, indices[i], indices[i + 1]);
      addEdge(structural, indices[i + 1], indices[i + 2]);
      addEdge(structural, indices[i + 2], indices[i]);
    }

    const wSeg = geometry.parameters.widthSegments;
    const hSeg = geometry.parameters.heightSegments;
    const rowSize = wSeg + 1;

    for (let y = 0; y <= hSeg; y++) {
      for (let x = 0; x <= wSeg; x++) {
        const i = y * rowSize + x;
        if (x + 2 <= wSeg) addEdge(bending, i, y * rowSize + (x + 2));
        if (y + 2 <= hSeg) addEdge(bending, i, (y + 2) * rowSize + x);

        if (x + 2 <= wSeg && y + 2 <= hSeg) {
          addEdge(bending, i, (y + 2) * rowSize + (x + 2));
        }
        if (x - 2 >= 0 && y + 2 <= hSeg) {
          addEdge(bending, i, (y + 2) * rowSize + (x - 2));
        }
      }
    }

    geometry.userData.springStructural = structural;
    geometry.userData.springBending = bending;
    geometry.userData.springVelocities = new Float32Array(pos.count * 3);

    const hingeX = geometry.userData.hingeX;
    const hingePinned = new Set();
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(geometry.userData.original[i * 3] - hingeX) < 0.001) {
        hingePinned.add(i);
      }
    }
    geometry.userData.hingePinned = hingePinned;
    geometry.userData.springEdgesBuilt = true;
  }

  return (refresh) => {
    const { springStructural, springBending, hingePinned, springVelocities } =
      geometry.userData;
    const count = pos.count;
    const vMass = geometry.userData.mass || mass || 1;
    const fAccum = new Float32Array(count * 3);

    const solveSprings = (edges, k) => {
      for (let e = 0; e < edges.length; e++) {
        const { i1, i2, rest } = edges[e];

        const dx = pos.getX(i2) - pos.getX(i1);
        const dy = pos.getY(i2) - pos.getY(i1);
        const dz = pos.getZ(i2) - pos.getZ(i1);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;

        const strain = dist / rest;
        let fMag = (dist - rest) * k;

        if (strain > 1.05) {
          fMag *= 10;
        }

        const fx = (dx / dist) * fMag;
        const fy = (dy / dist) * fMag;
        const fz = (dz / dist) * fMag;

        if (!pinned.has(i1) && !hingePinned.has(i1)) {
          fAccum[i1 * 3] += fx;
          fAccum[i1 * 3 + 1] += fy;
          fAccum[i1 * 3 + 2] += fz;
        }
        if (!pinned.has(i2) && !hingePinned.has(i2)) {
          fAccum[i2 * 3] -= fx;
          fAccum[i2 * 3 + 1] -= fy;
          fAccum[i2 * 3 + 2] -= fz;
        }
      }
    };

    for (let i = 0; i < iterations; i++) {
      solveSprings(springStructural, stiffness);
      solveSprings(springBending, bendStiffness);
    }

    const result = new Float32Array(count * 3);
    let isMoving = false;

    for (let i = 0; i < count; i++) {
      if (pinned.has(i) || hingePinned.has(i)) continue;

      const ax = fAccum[i * 3] / vMass;
      const ay = fAccum[i * 3 + 1] / vMass;
      const az = fAccum[i * 3 + 2] / vMass;

      let vx = (springVelocities[i * 3] + ax * dt) * damping;
      let vy = (springVelocities[i * 3 + 1] + ay * dt) * damping;
      let vz = (springVelocities[i * 3 + 2] + az * dt) * damping;

      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (speed > maxVel) {
        const ratio = maxVel / speed;
        vx *= ratio;
        vy *= ratio;
        vz *= ratio;
      }

      springVelocities[i * 3] = vx;
      springVelocities[i * 3 + 1] = vy;
      springVelocities[i * 3 + 2] = vz;

      result[i * 3] = vx * dt;
      result[i * 3 + 1] = vy * dt;
      result[i * 3 + 2] = vz * dt;

      if (Math.abs(vx) > 0.001 || Math.abs(vy) > 0.001 || Math.abs(vz) > 0.001)
        isMoving = true;
    }

    return { updated: isMoving, result };
  };
}

export function applyForce(geometry, delta, inMotion = false) {
  if (!geometry || !delta) {
    {
      result: 0;
    }
  }

  const pos = geometry.attributes.position;

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

    return { result: 0 };
  }

  return { result: 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Wrapper follow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each frame, for every paper vertex, bilinearly interpolates the matching
 * position on the (deformed) wrapper geometry and applies a spring force
 * pulling the paper vertex toward that target.
 *
 * Uses its own velocity buffer (wrapperFollowVelocities) so it can co-exist
 * cleanly with applyPageSpringForces on the same paper geometry.
 *
 * @param {THREE.BufferGeometry} paperGeo
 * @param {THREE.BufferGeometry} wrapperGeo
 * @param {Array}  uvMap       output of buildPageToWrapperMap
 * @param {number} stiffness   spring constant (try 120–250)
 * @param {number} damping     velocity retention per frame (0.8–0.92)
 * @param {number} dt          timestep (1/120 feels responsive)
 * @param {number} maxVel      explosion guard
 */
export function applyWrapperFollow(
  paperGeo,
  wrapperGeo,
  uvMap,
  stiffness = 150,
  damping = 0.88,
  dt = 1 / 120,
  maxVel = 50
) {
  if (!paperGeo || !wrapperGeo || !uvMap) return null;

  // Separate velocity buffer — does not interfere with springVelocities
  if (!paperGeo.userData.wrapperFollowVelocities) {
    paperGeo.userData.wrapperFollowVelocities = new Float32Array(
      paperGeo.attributes.position.count * 3
    );
  }

  return () => {
    const paperPos = paperGeo.attributes.position;
    const wrapperPos = wrapperGeo.attributes.position;
    const vels = paperGeo.userData.wrapperFollowVelocities;

    // hingePinned may not exist until applyPageSpringForces runs on the paper.
    // Fall back to an empty Set so the hinge still acts as expected via the
    // wrapper's own spring simulation.
    const hingePinned = paperGeo.userData.hingePinned || new Set();

    const count = paperPos.count;
    const result = new Float32Array(count * 3);
    const mass = paperGeo.userData.mass || 1;
    let isMoving = false;

    for (let i = 0; i < count; i++) {
      if (hingePinned.has(i)) continue;

      // ── Bilinearly interpolate wrapper position at this paper vertex ──────
      const { indices, weights } = uvMap[i];
      let tx = 0,
        ty = 0,
        tz = 0;
      for (let j = 0; j < 4; j++) {
        const wi = indices[j];
        const w = weights[j];
        tx += wrapperPos.getX(wi) * w;
        ty += wrapperPos.getY(wi) * w;
        tz += wrapperPos.getZ(wi) * w;
      }

      // ── Spring force: F = k * (target − current) ─────────────────────────
      const px = paperPos.getX(i);
      const py = paperPos.getY(i);
      const pz = paperPos.getZ(i);

      const ax = ((tx - px) * stiffness) / mass;
      const ay = ((ty - py) * stiffness) / mass;
      const az = ((tz - pz) * stiffness) / mass;

      // ── Semi-implicit Euler + damping ─────────────────────────────────────
      let vx = (vels[i * 3] + ax * dt) * damping;
      let vy = (vels[i * 3 + 1] + ay * dt) * damping;
      let vz = (vels[i * 3 + 2] + az * dt) * damping;

      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (speed > maxVel) {
        const r = maxVel / speed;
        vx *= r;
        vy *= r;
        vz *= r;
      }

      vels[i * 3] = vx;
      vels[i * 3 + 1] = vy;
      vels[i * 3 + 2] = vz;

      result[i * 3] = vx * dt;
      result[i * 3 + 1] = vy * dt;
      result[i * 3 + 2] = vz * dt;

      if (Math.abs(vx) > 0.001 || Math.abs(vy) > 0.001 || Math.abs(vz) > 0.001)
        isMoving = true;
    }

    return { updated: isMoving, result };
  };
}
