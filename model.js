// Tree model over X3D JSON (X3DJSONLD style).
//
// Conventions handled:
//   "@name": value      -> attribute
//   "-field": {...}|[..] -> child container (containerField = "field")
//   {"Type": {...}}      -> a typed node wrapper
//   {"#comment": "..."}  -> a comment node
// Non-wrapped objects (head, Scene, meta items, ProtoBody...) become "bare"
// nodes whose type is the key they were found under.
//
// The model is rebuilt from the raw JSON after every edit; the raw JSON is
// the single source of truth. A cursor is a path of child indexes from the root.

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isMeta = (k) => k.startsWith('@') || k.startsWith('-') || k.startsWith('#');

function containerLike(val) {
  return isObj(val) || (Array.isArray(val) && val.some(isObj));
}

export function isContainerKey(key, val) {
  if (key.startsWith('-')) return true;
  if (key.startsWith('@') || key.startsWith('#')) return false;
  return containerLike(val);
}

function classify(item, fallbackType) {
  if (!isObj(item)) return null;
  const keys = Object.keys(item);
  if (keys.length === 1) {
    const k = keys[0];
    if (k === '#comment') return { type: 'Comment', body: item, wrapped: false };
    if (!isMeta(k) && isObj(item[k])) return { type: k, body: item[k], wrapped: true };
  }
  return { type: fallbackType || 'Object', body: item, wrapped: false };
}

function collect(node) {
  const kids = [];
  for (const [key, val] of Object.entries(node.body)) {
    if (!isContainerKey(key, val)) continue;
    const field = key.replace(/^-/, '');
    const items = Array.isArray(val) ? val : [val];
    items.forEach((item, i) => {
      const c = classify(item, field);
      if (!c) return;
      kids.push({
        ...c,
        raw: item,
        parent: node,
        key,
        field,
        index: Array.isArray(val) ? i : null,
        children: [],
      });
    });
  }
  node.children = kids;
  kids.forEach((k, i) => {
    k.siblingIndex = i;
    k.siblingCount = kids.length;
    k.path = [...node.path, i];
    collect(k);
  });
}

export function attributesOf(node) {
  return Object.entries(node.body)
    .filter(([k, v]) => !isContainerKey(k, v))
    .map(([k, v]) => ({ name: k.replace(/^[@#]/, ''), key: k, value: v }));
}

export function attrValue(node, name) {
  const a = attributesOf(node).find((x) => x.name === name);
  return a ? a.value : undefined;
}

export class Doc {
  constructor(raw) {
    this.raw = raw;
    this.rebuild();
  }

  rebuild() {
    const c = classify(this.raw, 'Document') || { type: 'Document', body: {}, wrapped: false };
    this.root = { ...c, raw: this.raw, parent: null, key: null, field: null, index: null,
      siblingIndex: 0, siblingCount: 1, path: [], children: [] };
    collect(this.root);
    this.defs = new Map();
    for (const n of this.walk()) {
      const def = attrValue(n, 'DEF');
      if (typeof def === 'string' && !this.defs.has(def)) this.defs.set(def, n);
    }
  }

  *walk(node = this.root) {
    yield node;
    for (const k of node.children) yield* this.walk(k);
  }

  // Resolve a path, clamping to the deepest node that still exists.
  nodeAt(path) {
    let n = this.root;
    for (const i of path) {
      if (!n.children[i]) break;
      n = n.children[i];
    }
    return n;
  }

  count() {
    let c = 0;
    for (const _ of this.walk()) c++;
    return c;
  }
}
