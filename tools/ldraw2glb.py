#!/usr/bin/env python3
"""Convert LDraw parts (.dat/.ldr) to low-poly binary glTF (.glb).

Low poly: whenever a part references a primitive that has an 8-segment
version in p/8/, that version is used instead, so studs, pins and round
bricks come out as octagons.

Usage:
  ldraw2glb.py [--ldraw DIR] [--color CODE] [--hi] PART.dat OUT.glb
  ldraw2glb.py [--ldraw DIR] --batch LIST.txt OUTDIR     (one part name per line)

Coordinates: LDraw units (LDU) are converted to studs (1 stud = 20 LDU),
and LDraw's -Y-up is flipped to glTF's +Y-up. A 1x1 brick is 1 x 1.2 x 1.
"""
import hashlib, json, os, struct, sys
import numpy as np

LDRAW = os.path.join(os.path.dirname(__file__), '..', 'vendor', 'ldraw', 'ldraw')
# our own parts, for pieces too new for the LDraw library (ldraw-extra/parts,
# made by tools/parts/*.py); the official library's own come first
EXTRA = os.path.join(os.path.dirname(__file__), '..', 'ldraw-extra')
SCALE = 1.0 / 20.0


def load_colors(root):
    colors = {}
    for line in open(os.path.join(root, 'LDConfig.ldr'), encoding='utf-8', errors='replace'):
        t = line.split()
        if len(t) > 2 and t[0] == '0' and t[1] == '!COLOUR':
            code = int(t[t.index('CODE') + 1])
            hexv = t[t.index('VALUE') + 1].lstrip('#')
            rgb = [int(hexv[i:i + 2], 16) / 255 for i in (0, 2, 4)]
            alpha = int(t[t.index('ALPHA') + 1]) / 255 if 'ALPHA' in t else 1.0
            colors[code] = (rgb, alpha, t[2])
    # ours: a doppelganger's other half, a misty liquid green (the renderers make it shimmer)
    colors[MIST] = ([0.45, 1.0, 0.55], 0.5, 'Doppel_Mist')
    # and a quantum mechanic's parts, each its own colour so each can flash on its own
    for i in range(QUANTUM_PARTS):
        colors[QUANTUM + i] = ([1.0, 1.0, 1.0], 1.0, f'Quantum_Strobe_{i}')
    return colors


MIST = 9001
QUANTUM, QUANTUM_PARTS = 9100, 100


def figure_extras(ldr_text):
    """What the renderers need to know about a figure: an angel's glowing aura
    (mist.js), and its joints for the animation (figure_rig; minifig-anim.js)."""
    ex = {}
    if '0 !LEGOHACK AURA' in ldr_text:
        ex['aura'] = True
    rig = figure_rig(ldr_text)
    if rig:
        ex['rig'] = rig
    return ex or None


def figure_groups(ldr_text):
    """The figure's lines by the joint they move with ('0 !LEGOHACK GROUP <name>'
    before them; tools/minifig.py), in order: [(name, [lines])]."""
    groups, cur = {}, None
    for l in ldr_text.splitlines():
        if l.startswith('0 !LEGOHACK GROUP '):
            cur = l.split()[3]
            groups.setdefault(cur, [])
        elif cur and (l.startswith('1 ') or l.startswith('0 !TEXMAP') or l.startswith('0 !:')):
            groups[cur].append(l)
    return list(groups.items())


def figure_geom(lib, path, ldr_text):
    """A built figure's geometry, with the races' special looks: a quantum
    mechanic's every part one plain colour of its own (no prints, no decals:
    faceless), each one strobing in the renderers (mist.js); a doppelganger's
    one side mist (ghosted). A figure in joints (figure_groups) comes back as
    {joint: geometry}, for to_glb to make a node of each."""
    groups = figure_groups(ldr_text)
    quantum = '0 !LEGOHACK QUANTUM' in ldr_text
    if not groups:
        groups = [(None, ldr_text.splitlines())]
    out, i = {}, 0
    for name, lines in groups:
        if quantum:
            geom = []
            for t in (l.split() for l in lines if l.startswith('1 ')):
                pos = np.array([float(v) for v in t[2:5]])
                rot = np.array([float(v) for v in t[5:14]]).reshape(3, 3)
                for code, tex, arr, uv in lib.parse(' '.join(t[14:])):
                    if code == 24 or not len(arr):
                        continue
                    geom.append((QUANTUM + i % QUANTUM_PARTS, None, arr.reshape(-1, 3) @ rot.T + pos, None))
                i += 1
            # one primitive per part (its prints and all), so the whole part flashes as one
            merged = {}
            for c, _, a, _ in geom:
                merged.setdefault(c, []).append(a.reshape(-1, 3, 3))
            geom = [(c, None, np.concatenate(a), None) for c, a in merged.items()]
        elif name is None:
            geom = ghosted(lib.parse(path), ldr_text)
        else:
            # each joint's lines as a model of its own (named by its content: the library caches by name)
            text = '\n'.join(lines) + '\n'
            sub = os.path.join(os.path.dirname(os.path.abspath(path)), 'joints',
                               hashlib.sha1(text.encode()).hexdigest()[:16] + '.ldr')
            if not os.path.exists(sub):
                os.makedirs(os.path.dirname(sub), exist_ok=True)
                open(sub, 'w').write(text)
            geom = ghosted(lib.parse(sub), ldr_text)
        if name is None:
            return geom
        out[name] = geom
    return out


def figure_rig(ldr_text):
    """The figure's joints ('0 !LEGOHACK RIG', LDraw units) in the model's units
    and axes (as to_glb writes it: studs, Y up, Z to the front), or None."""
    line = next((l for l in ldr_text.splitlines() if l.startswith('0 !LEGOHACK RIG ')), None)
    if not line:
        return None
    flip = np.array([1, -1, -1])
    rig = json.loads(line[len('0 !LEGOHACK RIG '):])
    for j in rig.values():
        j['pivot'] = (np.array(j['pivot']) * SCALE * flip).round(5).tolist()
        if 'axis' in j:
            j['axis'] = (np.array(j['axis']) * flip).round(5).tolist()
        if 'grip' in j:
            # a held item's placement, as a 4x4 matrix (column-major) in the model's units and axes
            F = np.diag(flip.astype(float))
            m = F @ np.array(j['grip']['mat']).reshape(3, 3) @ F
            p = np.array(j['grip']['pos']) * SCALE * flip
            M = np.eye(4)
            M[:3, :3], M[:3, 3] = m, p
            j['grip'] = M.T.flatten().round(5).tolist()
    return rig


def ghosted(geom, ldr_text):
    """A doppelganger: if the model says '0 !LEGOHACK GHOST <side>', everything
    on that side of the middle (x > 0 for side 1, x < 0 for -1) turns to mist.
    Triangles across the middle are cut in two; the shape stays the same."""
    side = next((float(l.split()[3]) for l in ldr_text.splitlines() if l.startswith('0 !LEGOHACK GHOST')), None)
    if side is None:
        return geom
    out = {}

    def put(key, tri, uv):
        t, u = out.setdefault(key, ([], []))
        t.append(tri)
        u.append(uv)

    def clip(poly, uvs, sgn):
        # the part of a polygon where sgn * x >= 0 (Sutherland-Hodgman against the plane x = 0)
        P, U = [], []
        n = len(poly)
        for i in range(n):
            a, b = poly[i], poly[(i + 1) % n]
            da, db = sgn * a[0], sgn * b[0]
            if da >= 0:
                P.append(a); U.append(uvs[i])
            if (da >= 0) != (db >= 0):
                t = da / (da - db)
                P.append(a + t * (b - a)); U.append(uvs[i] + t * (uvs[(i + 1) % n] - uvs[i]))
        return P, U

    for code, tex, arr, uv in geom:
        uvs = uv if uv is not None else np.zeros((len(arr), 3, 2))
        x = arr[:, :, 0] * side
        for i in range(len(arr)):
            if (x[i] >= 0).all():
                put((MIST, None), arr[i], uvs[i])
            elif (x[i] <= 0).all():
                put((code, tex), arr[i], uvs[i])
            else:
                for key, sgn in (((MIST, None), side), ((code, tex), -side)):
                    P, U = clip(list(arr[i]), list(uvs[i]), sgn)
                    for k in range(1, len(P) - 1):   # fan into triangles
                        put(key, np.array([P[0], P[k], P[k + 1]]), np.array([U[0], U[k], U[k + 1]]))
    return [(c, t, np.array(tr).reshape(-1, 3, 3), np.array(u).reshape(-1, 3, 2) if t else None)
            for (c, t), (tr, u) in out.items() if tr]


class Library:
    def __init__(self, root, lowres=True):
        self.root = root
        self.lowres = lowres
        self.cache = {}
        self.dirs = (['p/8'] if lowres else []) + ['parts', 'p', 'models']
        self.index = {}
        for d in ['parts', 'parts/s', 'p', 'p/8', 'p/48', 'models']:
            full = os.path.join(root, d)
            if os.path.isdir(full):
                for f in os.listdir(full):
                    self.index[(d, f.lower())] = os.path.join(full, f)
        for d in ['parts', 'parts/s']:
            full = os.path.join(EXTRA, d)
            if os.path.isdir(full):
                for f in os.listdir(full):
                    self.index.setdefault((d, f.lower()), os.path.join(full, f))

    def find(self, name):
        if os.path.isfile(name):
            return name
        name = name.replace('\\', '/').lower()
        for d in self.dirs:
            sub, _, base = name.rpartition('/')
            key = (d + ('/' + sub if sub else ''), base)
            if key in self.index:
                return self.index[key]
        return None

    def parse(self, name):
        """Return the flattened geometry of a file in its own colour space:
        list of (color_code, texture, tri_array Nx3x3, uv_array Nx3x2 or None),
        where colour 16 means 'inherit' and texture is an image path or None."""
        if name in self.cache:
            return self.cache[name]
        path = self.find(name)
        if path is None:
            print(f'  missing: {name}', file=sys.stderr)
            self.cache[name] = []
            return []
        base = os.path.dirname(os.path.abspath(path))
        tris = {}      # (code, texture) -> [tri arrays]
        uvs = {}       # (code, texture) -> [uv arrays]

        def add(code, tex, arr, uv):
            tris.setdefault((code, tex), []).append(arr)
            if tex is not None:
                uvs.setdefault((code, tex), []).append(uv)

        def add_mapped(code, arr, tm, occluders=None):
            """Planar-project a texture onto the faces that face the projection.
            With occluders (the whole sub-part), only faces nothing else covers
            are printed: the outer surface, not the back or the inside."""
            p1, p2, p3, image = tm
            U, V = p2 - p1, p3 - p1
            N = np.cross(U, V); N /= np.linalg.norm(N)
            n = np.cross(arr[:, 1] - arr[:, 0], arr[:, 2] - arr[:, 0])
            ln = np.linalg.norm(n, axis=1); ok = ln > 1e-9
            facing = np.zeros(len(arr), bool)
            facing[ok] = np.abs((n[ok] / ln[ok, None]) @ N) > 0.08   # anything not edge-on; occlusion does the rest
            if occluders is not None:
                # printed if any part of the face shows: test its centre, near its
                # corners and its edge midpoints (long thin faces can hide their centre)
                w = np.array([[1, 1, 1], [8, 1, 1], [1, 8, 1], [1, 1, 8], [4, 4, 1], [1, 4, 4], [4, 1, 4]], float)
                w /= w.sum(1, keepdims=True)
                for k in np.nonzero(facing)[0]:
                    if all(occluded(pt, -N, occluders) for pt in w @ arr[k]):
                        facing[k] = False
            if (~facing).any():
                add(code, None, arr[~facing], None)
            if facing.any():
                a = arr[facing]
                uv = np.stack([((a - p1) @ U) / (U @ U), ((a - p1) @ V) / (V @ V)], axis=-1)
                add(code, image, a, uv)

        def texmap(t):
            if len(t) >= 14 and t[3] == 'PLANAR':
                pts = np.array(list(map(float, t[4:13]))).reshape(3, 3)
                img = ' '.join(t[13:])
                if not os.path.isabs(img):
                    img = os.path.join(base, img)
                return (pts[0], pts[1], pts[2], img)
            return None

        invert_next = False
        ccw = True
        tex_next = None      # !TEXMAP NEXT: applies to the next line only
        tex_block = None     # !TEXMAP START ... END
        in_fallback = False
        for raw in open(path, encoding='utf-8', errors='replace'):
            t = raw.split()
            if not t:
                continue
            kind = t[0]
            if kind == '0':
                if len(t) >= 3 and t[1] == 'BFC':
                    if 'INVERTNEXT' in t:
                        invert_next = True
                    if 'CW' in t:
                        ccw = False
                    if 'CCW' in t:
                        ccw = True
                elif len(t) >= 3 and t[1] == '!TEXMAP':
                    if t[2] == 'NEXT':
                        tex_next = texmap(t)
                    elif t[2] == 'START':
                        tex_block = texmap(t)
                    elif t[2] == 'FALLBACK':
                        in_fallback = True
                    elif t[2] == 'END':
                        tex_block, in_fallback = None, False
                continue
            if in_fallback:      # geometry for renderers without textures: we have them
                continue
            tm = tex_next or tex_block
            tex_next = None
            if kind == '1' and len(t) >= 15:
                color = int(t[1])
                x, y, z, a, b, c, d, e, f, g, h, i = map(float, t[2:14])
                m = np.array([[a, b, c], [d, e, f], [g, h, i]])
                off = np.array([x, y, z])
                flip = (np.linalg.det(m) < 0) ^ invert_next
                invert_next = False
                child = []
                for ccode, ctex, arr, uv in self.parse(' '.join(t[14:])):
                    out = arr @ m.T + off
                    if flip:
                        out = out[:, ::-1, :]
                        uv = None if uv is None else uv[:, ::-1, :]
                    child.append((color if ccode == 16 else ccode, ctex, out, uv))
                if tm is None:
                    for item in child:
                        add(*item)
                else:
                    # project onto the whole sub-part at once, so only its front surface is printed
                    plain = [c for c in child if c[1] is None]
                    for c in child:
                        if c[1] is not None:
                            add(*c)
                    if plain:
                        codes = np.concatenate([np.full(len(c[2]), c[0]) for c in plain])
                        allt = np.concatenate([c[2] for c in plain])
                        for code in np.unique(codes):
                            add_mapped(int(code), allt[codes == code], tm, allt)
                continue
            invert_next = False
            if kind in ('3', '4'):
                color = int(t[1])
                n = 3 if kind == '3' else 4
                p = np.array(list(map(float, t[2:2 + 3 * n]))).reshape(n, 3)
                faces = [p[[0, 1, 2]]] if n == 3 else [p[[0, 1, 2]], p[[0, 2, 3]]]
                for fc in faces:
                    if not ccw:
                        fc = fc[::-1]
                    if tm is None:
                        add(color, None, fc[None], None)
                    else:
                        add_mapped(color, fc[None], tm)
        result = [(c, tx, np.concatenate(v), np.concatenate(uvs[(c, tx)]) if tx else None)
                  for (c, tx), v in tris.items()]
        self.cache[name] = result
        return result


def occluded(origin, d, tris, eps=0.05):
    """Does a ray from origin along d hit any of tris (Nx3x3)? Moller-Trumbore, vectorised."""
    o = origin + d * eps
    e1, e2 = tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]
    pv = np.cross(d, e2)
    det = (e1 * pv).sum(1)
    good = np.abs(det) > 1e-9
    inv = np.where(good, 1 / np.where(good, det, 1), 0)
    tv = o - tris[:, 0]
    u = (tv * pv).sum(1) * inv
    qv = np.cross(tv, e1)
    v = (qv @ d) * inv
    t = (e2 * qv).sum(1) * inv
    return bool((good & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > eps)).any())


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def decal_png(image, rgb, pad=2):
    """The decal image laid over the part's own colour, as PNG bytes, with a
    border of plain part colour so clamped edges outside the image stay plain."""
    from io import BytesIO
    from PIL import Image
    im = Image.open(image).convert('RGBA')
    bg = Image.new('RGBA', (im.width + 2 * pad, im.height + 2 * pad), tuple(int(c * 255) for c in rgb) + (255,))
    bg.alpha_composite(im, (pad, pad))
    out = BytesIO()
    bg.convert('RGB').save(out, 'PNG')
    return out.getvalue(), im.size


def to_glb(geom, colors, base_color, out_path, extras=None):
    buf = bytearray()
    accessors, views, meshes_prims, materials = [], [], [], []
    images, textures = [], []
    ntris = 0

    def put(data, target=34962):
        off = len(buf)
        buf.extend(data)
        while len(buf) % 4:
            buf.append(0)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            v['target'] = target
        views.append(v)
        return len(views) - 1

    def accessor(arr, typ, minmax=False):
        acc = {'bufferView': put(arr.tobytes()), 'componentType': 5126, 'count': len(arr), 'type': typ}
        if minmax:
            acc['min'] = arr.min(0).tolist()
            acc['max'] = arr.max(0).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    def add_prims(geom, meshes_prims):
        n = 0
        for code, tex, arr, uv in sorted(geom, key=lambda g: (g[0], g[1] or '')):
            if code == 16:
                code = base_color
            if code == 24:
                continue
            verts = (arr.reshape(-1, 3) * SCALE * np.array([1, -1, -1])).astype(np.float32)
            # flipping Y and Z keeps handedness, so winding is unchanged
            tri = verts.reshape(-1, 3, 3)
            nrm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
            ln = np.linalg.norm(nrm, axis=1, keepdims=True)
            keep = ln[:, 0] > 1e-9
            tri, nrm = tri[keep], (nrm[keep] / ln[keep])
            if not len(tri):
                continue
            n += len(tri)
            attrs = {'POSITION': accessor(tri.reshape(-1, 3).astype(np.float32), 'VEC3', True),
                     'NORMAL': accessor(np.repeat(nrm, 3, axis=0).astype(np.float32), 'VEC3')}
            rgb, alpha, cname = colors.get(code, ([1, 0, 1], 1.0, f'unknown{code}'))
            # LDConfig colours are sRGB; glTF's baseColorFactor is linear (textures stay sRGB)
            pbr = {'baseColorFactor': [srgb_to_linear(c) for c in rgb] + [alpha], 'metallicFactor': 0.0, 'roughnessFactor': 0.35}
            if tex:
                png, (w, h) = decal_png(tex, rgb)
                pad = 2
                st = uv[keep].reshape(-1, 2)
                st = np.stack([(st[:, 0] * w + pad) / (w + 2 * pad), (st[:, 1] * h + pad) / (h + 2 * pad)], -1)
                attrs['TEXCOORD_0'] = accessor(st.astype(np.float32), 'VEC2')
                images.append({'bufferView': put(png, None), 'mimeType': 'image/png', 'name': os.path.basename(tex)})
                textures.append({'source': len(images) - 1, 'sampler': 0})
                pbr['baseColorTexture'] = {'index': len(textures) - 1}
                pbr['baseColorFactor'] = [1, 1, 1, alpha]
                cname += ' + ' + os.path.basename(tex)
            mat = {'name': cname, 'doubleSided': True, 'pbrMetallicRoughness': pbr}
            if alpha < 1:
                mat['alphaMode'] = 'BLEND'
            materials.append(mat)
            meshes_prims.append({'attributes': attrs, 'material': len(materials) - 1, 'extras': {'ldrawColor': code}})
        return n

    # a figure in joints ({name: geometry}) gets a mesh and a node for each, under one root
    named = list(geom.items()) if isinstance(geom, dict) else [(None, geom)]
    meshes = []
    for gname, gm in named:
        prims = []
        ntris += add_prims(gm, prims)
        meshes.append(dict({'primitives': prims}, **({'name': gname} if gname else {})))
    root_extras = {'extras': extras} if extras else {}
    if named[0][0] is None:
        nodes = [dict({'mesh': 0}, **root_extras)]
    else:
        nodes = [dict({'name': 'figure', 'children': list(range(1, len(named) + 1))}, **root_extras)]
        nodes += [{'name': n, 'mesh': i} for i, (n, _) in enumerate(named)]
    gltf = {'asset': {'version': '2.0', 'generator': 'legohack ldraw2glb', 'copyright': 'LDraw.org Parts Library, CC BY 2.0/4.0'},
            'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': nodes,
            'meshes': meshes, 'materials': materials,
            'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}]}
    if images:
        gltf.update(images=images, textures=textures,
                    samplers=[{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}])
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    with open(out_path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(buf)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(buf), 0x004E4942) + bytes(buf))
    return ntris


def main(argv):
    root, color, lowres, batch = LDRAW, 16, True, False
    args = []
    it = iter(argv)
    for a in it:
        if a == '--ldraw':
            root = next(it)
        elif a == '--color':
            color = int(next(it))
        elif a == '--hi':
            lowres = False
        elif a == '--batch':
            batch = True
        else:
            args.append(a)
    colors = load_colors(root)
    if color == 16:
        color = 71  # light bluish grey, when no colour is given
    lib = Library(root, lowres)
    if batch:
        names = [l.strip() for l in open(args[0]) if l.strip() and not l.startswith('#')]
        os.makedirs(args[1], exist_ok=True)
        for n in names:
            out = os.path.join(args[1], os.path.splitext(os.path.basename(n))[0] + '.glb')
            print(f'{n}: {to_glb(lib.parse(n), colors, color, out)} tris')
    else:
        print(f'{args[0]}: {to_glb(lib.parse(args[0]), colors, color, args[1])} tris')


if __name__ == '__main__':
    main(sys.argv[1:])
