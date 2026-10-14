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
import json, os, struct, sys
import numpy as np

LDRAW = os.path.join(os.path.dirname(__file__), '..', 'vendor', 'ldraw', 'ldraw')
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
    return colors


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


def to_glb(geom, colors, base_color, out_path):
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
        ntris += len(tri)
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
    gltf = {'asset': {'version': '2.0', 'generator': 'legohack ldraw2glb', 'copyright': 'LDraw.org Parts Library, CC BY 2.0/4.0'},
            'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}],
            'meshes': [{'primitives': meshes_prims}], 'materials': materials,
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
