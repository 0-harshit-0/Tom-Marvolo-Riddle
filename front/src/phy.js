export function applyGravity(pos, indices, vertices, force = 0, mass = 0) {
  if (!pos || !indices || !vertices || !force || !mass) return null;

  const acc = force / mass,
    maxVel = 1;

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

    return { updated: inMotion, result };
  };
}

// phy.js - applyMouseDrag
export function applyMouseDrag(
  geometry,
  grabbedIndexes,
  deltaX,
  deltaY,
  deltaZ,
  strength = 2
) {
  if (!geometry || !grabbedIndexes.length) return;

  const velocities = geometry.userData.springVelocities;
  if (!velocities) return;

  const hingeX = geometry.userData.hingeX;
  const pos = geometry.attributes.position;

  for (const i of grabbedIndexes) {
    // vertices right of hinge lift up (+Z) when pushed left, drop when pushed right
    const zDirection = pos.getX(i) - hingeX > 0 ? -1 : 1;

    velocities[i * 3] += deltaX * strength;
    velocities[i * 3 + 1] += deltaY * strength;
    velocities[i * 3 + 2] += deltaX * zDirection * strength; // 👈 derived from deltaX, not deltaZ
  }
}
export function applyLeftPush(geometry, indices, force = 0.5) {
  if (!geometry || !indices.length) return null;

  const velocities = geometry.userData.springVelocities;
  const hingeX = geometry.userData.hingeX; // Grab the hinge X
  const pos = geometry.attributes.position;

  return () => {
    for (const i of indices) {
      const currentX = pos.getX(i);

      // Calculate Z direction:
      // If vertex is to the right of hinge, push UP (+).
      // If vertex is to the left of hinge, push DOWN (-).
      const zDirection = currentX - hingeX > 0 ? 1 : -1;

      // Inject velocity as an Impulse
      velocities[i * 3] -= force; // Move Left
      velocities[i * 3 + 2] += force * zDirection; // Directional Lift
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

  // ===============================
  // Build constraints once (from geometry positions at time of build)
  // ===============================
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

    // Structural constraints from triangle edges
    for (let i = 0; i < index.length; i += 3) {
      const a = index[i];
      const b = index[i + 1];
      const c = index[i + 2];

      addEdge(structural, a, b);
      addEdge(structural, b, c);
      addEdge(structural, c, a);
    }

    // Shear constraints (cross quad)
    const wSeg = geometry.parameters.widthSegments;
    const hSeg = geometry.parameters.heightSegments;
    const rowSize = wSeg + 1;

    for (let y = 0; y < hSeg; y++) {
      for (let x = 0; x < wSeg; x++) {
        const i1 = y * rowSize + (x + 1);
        const i2 = (y + 1) * rowSize + x;
        addEdge(structural, i1, i2);
      }
    }

    // Bending constraints (2-step neighbors)
    for (let y = 0; y <= hSeg; y++) {
      for (let x = 0; x <= wSeg; x++) {
        const i = y * rowSize + x;

        if (x + 2 <= wSeg) {
          const j = y * rowSize + (x + 2);
          addEdge(bending, i, j);
        }

        if (y + 2 <= hSeg) {
          const j = (y + 2) * rowSize + x;
          addEdge(bending, i, j);
        }
      }
    }

    geometry.userData.structural = structural;
    geometry.userData.bending = bending;

    // ===============================
    // Build hinge pinned set (fully fixed in xyz)
    // ===============================
    const hingeX = geometry.userData.hingeX;
    const hingePinned = new Set();

    for (let i = 0; i < pos.count; i++) {
      const originalX = geometry.userData.original[i * 3];
      if (Math.abs(originalX - hingeX) < 0.001) {
        hingePinned.add(i);
      }
    }

    geometry.userData.hingePinned = hingePinned;
    geometry.userData.constraintsBuilt = true;
  }

  // ===============================
  // Solver function returns (refresh) => { updated, result }
  // result is a Float32Array of deltas (x,y,z) for each vertex
  // ===============================
  return (refresh) => {
    const structural = geometry.userData.structural;
    const bending = geometry.userData.bending;
    const hingePinned = geometry.userData.hingePinned;

    const count = pos.count;
    // copy current positions into a local buffer cur (x,y,z interleaved)
    const cur = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      cur[i * 3] = pos.getX(i);
      cur[i * 3 + 1] = pos.getY(i);
      cur[i * 3 + 2] = pos.getZ(i);
    }

    const getX = (arr, i) => arr[i * 3];
    const getY = (arr, i) => arr[i * 3 + 1];
    const getZ = (arr, i) => arr[i * 3 + 2];
    const setXYZ = (arr, i, x, y, z) => {
      arr[i * 3] = x;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = z;
    };

    const solve = (constraints, stiff) => {
      for (const { i1, i2, rest } of constraints) {
        const isPinned1 = pinned.has(i1) || hingePinned.has(i1);
        const isPinned2 = pinned.has(i2) || hingePinned.has(i2);

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
          // move i2 fully
          setXYZ(
            cur,
            i2,
            x2 - dx * diff * stiff,
            y2 - dy * diff * stiff,
            z2 - dz * diff * stiff
          );
        } else if (!isPinned1 && isPinned2) {
          // move i1 fully
          setXYZ(
            cur,
            i1,
            x1 + dx * diff * stiff,
            y1 + dy * diff * stiff,
            z1 + dz * diff * stiff
          );
        } else if (!isPinned1 && !isPinned2) {
          // split correction
          const corrX = dx * 0.5 * diff * stiff;
          const corrY = dy * 0.5 * diff * stiff;
          const corrZ = dz * 0.5 * diff * stiff;

          setXYZ(cur, i1, x1 + corrX, y1 + corrY, z1 + corrZ);
          setXYZ(cur, i2, x2 - corrX, y2 - corrY, z2 - corrZ);
        }
        // if both pinned do nothing
      }
    };

    // iterative solver on local buffer
    for (let k = 0; k < iterations; k++) {
      solve(structural, stiffness);
      solve(bending, bendStiffness);

      // ensure hinge pinned vertices remain exactly at original positions for extra safety
      // they are already treated as pinned above but restore to original to avoid drift
      for (const i of hingePinned) {
        const ox = geometry.userData.original[i * 3];
        const oy = geometry.userData.original[i * 3 + 1];
        const oz = geometry.userData.original[i * 3 + 2];
        setXYZ(cur, i, ox, oy, oz);
      }
    }

    // compute delta = cur - originalPosAtStart
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

    const updated = maxDelta > 1e-7; // tiny threshold
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
  stiffness = 150, // Structural stiffness
  bendStiffness = 30, // Bending stiffness (should be lower)
  damping = 0.95, // Velocity retention (0.9 - 0.98 is good)
  dt = 1 / 60,
  maxVel = 1.0 // Prevents "explosions"
) {
  if (!geometry || !pos || !indices) return null;

  // 1. Setup Constraints and Velocities (Run once)
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

    // Build Structural Edges (Triangle edges + Shear/Cross-quad)
    for (let i = 0; i < indices.length; i += 3) {
      addEdge(structural, indices[i], indices[i + 1]);
      addEdge(structural, indices[i + 1], indices[i + 2]);
      addEdge(structural, indices[i + 2], indices[i]);
    }

    const wSeg = geometry.parameters.widthSegments;
    const hSeg = geometry.parameters.heightSegments;
    const rowSize = wSeg + 1;

    // Build Bending Edges (Skip neighbors)
    for (let y = 0; y <= hSeg; y++) {
      for (let x = 0; x <= wSeg; x++) {
        const i = y * rowSize + x;
        if (x + 2 <= wSeg) addEdge(bending, i, y * rowSize + (x + 2));
        if (y + 2 <= hSeg) addEdge(bending, i, (y + 2) * rowSize + x);
      }
    }

    geometry.userData.springStructural = structural;
    geometry.userData.springBending = bending;
    geometry.userData.springVelocities = new Float32Array(pos.count * 3);

    // Locate Hinge (Fixed side)
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

    // 2. Accumulate Spring Forces (Hooke's Law: F = -k * displacement)
    const solveSprings = (edges, k) => {
      for (let e = 0; e < edges.length; e++) {
        const { i1, i2, rest } = edges[e];

        const dx = pos.getX(i2) - pos.getX(i1);
        const dy = pos.getY(i2) - pos.getY(i1);
        const dz = pos.getZ(i2) - pos.getZ(i1);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;

        // --- ADD SNIPPET HERE ---
        const strain = dist / rest;
        let fMag = (dist - rest) * k; // Use 'k' from the function parameter

        if (strain > 1.05) {
          fMag *= 10; // Rapidly increase resistance if stretching more than 5%
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

    // 3. Integration & Damping
    const result = new Float32Array(count * 3);
    let isMoving = false;

    for (let i = 0; i < count; i++) {
      if (pinned.has(i) || hingePinned.has(i)) continue;

      // a = F / m
      const ax = fAccum[i * 3] / vMass;
      const ay = fAccum[i * 3 + 1] / vMass;
      const az = fAccum[i * 3 + 2] / vMass;

      // v = (v + a * dt) * damping (Air resistance)
      let vx = (springVelocities[i * 3] + ax * dt) * damping;
      let vy = (springVelocities[i * 3 + 1] + ay * dt) * damping;
      let vz = (springVelocities[i * 3 + 2] + az * dt) * damping;

      // Clamp velocity to prevent physics "explosion"
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

      // Final displacement delta
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

    return { result: 0 };
  }

  return { result: 1 };
}
