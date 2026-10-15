# Headless Blender export of Z-Anatomy bones+muscles into a compact binary.
import bpy,sys,json,re,bmesh
import numpy as np
blend,outdir,ratio_s=sys.argv[-3],sys.argv[-2],sys.argv[-1]
RATIO=float(ratio_s)
bpy.ops.wm.open_mainfile(filepath=blend)
scene=bpy.context.scene
parent={}
for c in bpy.data.collections:
    for ch in c.children: parent.setdefault(ch.name,c.name)
def topcol(n):
    seen=0
    while n in parent and seen<40: n=parent[n];seen+=1
    return n
SYS={'1: Skeletal system':'bone','4: Muscular system':'muscle'}
EXCL=re.compile(r'fascia|bursa|sheath|septum|retinacul|aponeurosis|ligament|linea alba|tendinous arch|tarsus(\.[lr])?$|tendinous ring|trochlea|iliopectineal arch|cells of ethmoid|sinus of|system\.g|fibrous sheath|raphe',re.I)
deps=bpy.context.evaluated_depsgraph_get()
parts=[]
for o in bpy.data.objects:
    if o.type!='MESH' or len(o.data.polygons)==0: continue
    kinds={SYS.get(topcol(c.name)) for c in o.users_collection}-{None}
    if not kinds: continue
    name=o.name
    if EXCL.search(name) and not name.startswith('Tensor fasciae latae'): continue
    kind=kinds.pop()
    side='M'
    m=re.match(r'^(.*)\.(l|r)$',name)
    base=name
    if m: base,side=m.group(1),m.group(2).upper()
    base=base.strip('()').strip()
    parts.append((o,base,side,kind))
print('parts',len(parts))
quant=[];allpos=[]
records=[]
for o,base,side,kind in parts:
    ev=o.evaluated_get(deps)
    me=ev.to_mesh()
    bm=bmesh.new();bm.from_mesh(me);ev.to_mesh_clear()
    bm.transform(o.matrix_world)
    # Z-Anatomy builds the left side by mirroring (negative scale); applying a
    # mirrored transform turns faces inside-out, so restore outward winding.
    if o.matrix_world.determinant() < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm,faces=bm.faces[:])
    tris=len(bm.faces)
    bmesh.ops.remove_doubles(bm,verts=bm.verts[:],dist=1e-6)
    bm.normal_update()
    bm.verts.ensure_lookup_table()
    pos=np.array([(v.co.x,v.co.z,-v.co.y) for v in bm.verts],dtype=np.float32)
    nor=np.array([(v.normal.x,v.normal.z,-v.normal.y) for v in bm.verts],dtype=np.float32)
    idx=np.array([[v.index for v in f.verts] for f in bm.faces],dtype=np.uint32).reshape(-1)
    bm.free()
    if len(idx)==0: print('SKIP',o.name,len(pos));continue
    records.append(dict(name=o.name,base=base,side=side,kind=kind,pos=pos,nor=nor,idx=idx,src=tris))

P=[];N=[];I=[];meta=[];vo=0;io=0
for r in records:
    P.append(r['pos']);N.append(r['nor'].astype(np.float32));I.append(r['idx'])
    meta.append(dict(name=r['name'],base=r['base'],side=r['side'],kind=r['kind'],v=[vo,len(r['pos'])],i=[io,len(r['idx'])]))
    vo+=len(r['pos']);io+=len(r['idx'])
open(outdir+'/raw_pos.f32','wb').write(np.concatenate(P).tobytes())
open(outdir+'/raw_nor.f32','wb').write(np.concatenate(N).tobytes())
open(outdir+'/raw_idx.u32','wb').write(np.concatenate(I).tobytes())
json.dump(dict(parts=meta,vertexCount=vo,indexCount=io),open(outdir+'/raw.json','w'))
print('verts',vo,'tris',io//3)
