// A model come apart into the bricks it's built of (a monster slain, brickworld shatterFigureAt; a corpse's
// picture, brickitems corpseIcon).

import * as THREE from 'three';

// A figure (its meshes, as drawn now) in its pieces: the bricks it's built of, each a run of triangles joined to one
// another (welded where they meet), the biggest `most` kept apart and every smaller bit (a stud, a print) joined to the
// one it's nearest. [{center (world), parts: [Mesh, its triangles round the centre, in world space]}]
export function brickPieces(meshes, most) {
  const geos = meshes.map((o) => { const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()); g.applyMatrix4(o.matrixWorld); return { g, mat: o.material }; });
  const keyId = new Map(), parent = [];
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  const vid = []; // per geometry, per vertex: its welded id
  for (const { g } of geos) {
    const P = g.attributes.position, ids = new Int32Array(P.count);
    for (let v = 0; v < P.count; v++) {
      const k = `${Math.round(P.getX(v) * 400)},${Math.round(P.getY(v) * 400)},${Math.round(P.getZ(v) * 400)}`;
      let id = keyId.get(k);
      if (id === undefined) { id = parent.length; parent.push(id); keyId.set(k, id); }
      ids[v] = id;
    }
    for (let t = 0; t + 2 < P.count; t += 3) { const a = find(ids[t]), b = find(ids[t + 1]), c = find(ids[t + 2]); parent[b] = a; parent[find(c)] = a; }
    vid.push(ids);
  }
  // each run: its triangles, how many, its middle
  const runs = new Map();
  geos.forEach(({ g }, gi) => {
    const P = g.attributes.position;
    for (let t = 0; t + 2 < P.count; t += 3) {
      const r = find(vid[gi][t]);
      let run = runs.get(r);
      if (!run) runs.set(r, (run = { tris: [], n: 0, sum: new THREE.Vector3() }));
      run.tris.push([gi, t]); run.n++;
      run.sum.x += P.getX(t); run.sum.y += P.getY(t); run.sum.z += P.getZ(t);
    }
  });
  const list = [...runs.values()].map((r) => ({ ...r, mid: r.sum.divideScalar(r.n) })).sort((a, b) => b.n - a.n);
  const keep = list.slice(0, most).map((r) => ({ tris: [...r.tris], mid: r.mid }));
  for (const r of list.slice(most)) { // (a small bit: with the nearest big one)
    let best = keep[0], bd = Infinity;
    for (const k of keep) { const d = k.mid.distanceToSquared(r.mid); if (d < bd) { bd = d; best = k; } }
    best.tris.push(...r.tris);
  }
  return keep.map((k) => {
    const byGeo = new Map();
    for (const [gi, t] of k.tris) { if (!byGeo.has(gi)) byGeo.set(gi, []); byGeo.get(gi).push(t); }
    const box = new THREE.Box3();
    for (const [gi, ts] of byGeo) { const P = geos[gi].g.attributes.position; for (const t of ts) for (let v = 0; v < 3; v++) box.expandByPoint(new THREE.Vector3(P.getX(t + v), P.getY(t + v), P.getZ(t + v))); }
    const center = box.getCenter(new THREE.Vector3());
    const parts = [];
    for (const [gi, ts] of byGeo) {
      const src = geos[gi].g, out = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(src.attributes)) {
        const arr = new Float32Array(ts.length * 3 * a.itemSize);
        let o = 0;
        for (const t of ts) for (let v = 0; v < 3; v++) for (let c = 0; c < a.itemSize; c++) arr[o++] = a.array[(t + v) * a.itemSize + c];
        out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
      }
      out.translate(-center.x, -center.y, -center.z);
      const mat = Array.isArray(geos[gi].mat) ? geos[gi].mat[0] : geos[gi].mat;
      parts.push(new THREE.Mesh(out, mat));
    }
    return { center, parts };
  });
}

// which of a monster's pieces is its corpse (sizes: how big each is, its bulk): one of its four biggest (a head, a body,
// a leg: not a stud, a ring), the same one every time for the same monster (a newt's corpse is always the same brick
// of the newt). Its index
export function pieceOf(name, sizes) {
  let h = 2166136261;
  for (const ch of String(name)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const most = Math.max(0, ...sizes), big = sizes.map((s, i) => [s, i]).filter(([s]) => s >= most * 0.1).sort((a, b) => b[0] - a[0]).slice(0, 4); // (not an eye, a stud: a tenth the biggest's bulk, at least)
  return big.length ? big[(h >>> 0) % big.length][1] : 0;
}
const across = (o) => { const v = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()); return v.x * v.y * v.z; }; // (its bulk: a flat ring, a hip's socket, isn't big)
export const sizesOf = (objs) => objs.map(across);

// a monster's corpse: that one of its pieces (pieceOf), on its own, round its middle, its underside at its origin's
// height left as it is (laid as any floor item is). model: the monster's model, loaded (an Object3D)
export function corpsePiece(model, name) {
  const root = model.clone(true);
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position) meshes.push(o); });
  const groups = brickPieces(meshes, 16).map((pc) => { const g = new THREE.Group(); for (const p of pc.parts) g.add(p); return g; });
  return groups.length ? groups[pieceOf(name, sizesOf(groups))] : new THREE.Group();
}
