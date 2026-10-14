# Card schema (one JSON array per region file in data/cards/)

Each card is one flash card. The app zooms to the 3D meshes listed in `parts`
(exact Z-Anatomy model base names, WITHOUT the `.l` / `.r` side suffix — the
app resolves sides itself and randomly shows left or right when both exist).

```jsonc
{
  "id": "rectus-femoris",          // kebab-case, globally unique
  "kind": "muscle",                // "muscle" | "bone"
  "name": "Rectus femoris",        // the answer, as a trainer/PT would say it
  "aka": ["Rec fem"],              // optional alternative names / common names
  "region": "Thigh",               // display group, e.g. "Shoulder", "Arm", "Forearm", "Hand", "Hip", "Thigh", "Leg", "Foot", "Back", "Thorax", "Abdomen", "Pelvic floor", "Neck", "Head", "Face", "Eye", "Larynx", "Pharynx", "Skull", "Spine", "Upper limb", "Lower limb"...
  "tier": 1,                       // 1 easy … 5 very hard (see below)
  "parts": ["Rectus femoris muscle"],
  "etymology": "From Latin rectus ‘straight’ + femoris ‘of the thigh’ (femur, thigh). The ‘straight muscle of the thigh’ — its fibres run straight down the front of the thigh, unlike the oblique vasti.",
  // MUSCLES ONLY:
  "origin": "Anterior inferior iliac spine (straight head); superior acetabular rim (reflected head)",
  "insertion": "Base of patella, then via patellar ligament to tibial tuberosity",
  "actions": ["Knee extension", "Hip flexion"],
  "innervation": "Femoral nerve (L2–L4)",
  // BONES ONLY:
  "articulations": ["Hip bone (hip joint)", "Tibia (knee joint)", "Patella (patellofemoral joint)"],
  "landmarks": ["Greater trochanter", "Lesser trochanter", "Linea aspera", "Medial/lateral condyles"],
  // BOTH (optional, one short sentence, practical for a trainer / PT student):
  "tip": "The only quad that crosses the hip — stretch it with hip extension + knee flexion."
}
```

## Etymology
This matters most to the user — they memorise via the Latin/Greek meaning.
Give the source language, each root word with its literal meaning, and a
one-line ‘so it means…’ that ties the name to what you see (shape, location,
action, number of heads, attachments). 1–3 sentences. Be accurate; if a
derivation is uncertain say “probably” — never invent.

## Actions
Use precise joint-movement language a PT exam expects: e.g. “Hip external
rotation”, “Shoulder horizontal adduction”, “Scapular upward rotation”,
“Ankle plantarflexion”, “Subtalar inversion”, “Elbow flexion (strongest when
forearm pronated)”. Primary actions first. 1–5 items.

## Tier guide (difficulty for a personal-trainer / PT student)
1. Iconic, large, gym-famous: femur, humerus, tibia, skull bones like frontal, scapula, clavicle, patella, pelvis, sternum; pec major, deltoid, biceps brachii, triceps brachii, lats, rectus abdominis, gluteus maximus, trapezius, gastrocnemius, rectus femoris.
2. Common gym/clinic knowledge: radius, ulna, fibula, sacrum, mandible, calcaneus; vastus lateralis/medialis, hamstrings, soleus, tibialis anterior, obliques, serratus anterior, SCM, gluteus medius, adductor longus, deltoid heads, trap parts.
3. Solid anatomy-student level: rotator cuff, brachialis, brachioradialis, iliacus/psoas, TFL, pec minor, levator scapulae, rhomboids, gracilis, adductor magnus, talus, scaphoid, C1/C2/C7, 1st/12th rib, muscle heads.
4. Detailed: specific vertebrae (T6, L3…), most ribs, tarsals/carpals, forearm & leg deep muscles, deep hip rotators, erector-spinae subdivisions, scalenes, suprahyoids, masticatory, intrinsic hand/foot.
5. Expert/obscure: phalanges by digit, ossicles, sesamoids, facial expression muscles, extra-ocular, laryngeal, pharyngeal, tongue, interspinales/intertransversarii/rotatores, levatores costarum.

## Rules
- Output ONLY valid JSON (an array of card objects) to the assigned file. No comments in the output file.
- Every model base name you were given must be covered by at least one card's `parts` (unless told to skip it).
- `parts` strings must match the given names EXACTLY (case, spaces, parentheses).
- Text in plain English, concise. Use en-dashes for nerve root ranges (L2–L4).
