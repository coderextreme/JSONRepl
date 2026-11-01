// Editing session: one cursor over one document. exec(line) returns
// { say: string[] } (sentences to play) and never touches the terminal,
// so a glove classifier, Braille input or foot pedal can drive the same API.

import { Doc, attributesOf, attrValue } from './model.js';
import { describeNode, describeAttributes, describeChildren, describePath, speakValue } from './describe.js';

const ALIASES = {
  up: 'parent', down: 'child', first: 'child',
  n: 'next', p: 'prev', previous: 'prev',
  read: 'attrs', attributes: 'attrs', where: 'here',
  remove: 'delete', find: 'search', ok: 'yes', confirm: 'yes',
};

// Placeholder until a real schema is wired in: fields that hold lists of nodes.
const MF_FIELDS = new Set(['children', 'joints', 'segments', 'sites', 'viewpoints', 'skeleton', 'skin']);
const STRING_ATTRS = new Set(['DEF', 'USE', 'name', 'description', 'info', 'title', 'content', 'url']);
const TYPE_RE = /^[A-Za-z_][\w.-]*$/;

class UserError extends Error {}

function parseValue(name, text, existing) {
  const t = text.trim();
  if (Array.isArray(existing) && existing.every((x) => typeof x === 'number')) {
    const nums = t.split(/[\s,]+/).filter(Boolean).map(Number);
    if (!nums.length || nums.some(Number.isNaN)) throw new UserError('Expected numbers.');
    return nums;
  }
  if (typeof existing === 'number') {
    const n = Number(t);
    if (t === '' || Number.isNaN(n)) throw new UserError('Expected a number.');
    return n;
  }
  if (typeof existing === 'boolean') {
    if (t !== 'true' && t !== 'false') throw new UserError('Expected true or false.');
    return t === 'true';
  }
  if (typeof existing === 'string' || STRING_ATTRS.has(name)) return t;
  if (t === 'true' || t === 'false') return t === 'true';
  const parts = t.split(/[\s,]+/).filter(Boolean);
  if (parts.length && parts.every((p) => !Number.isNaN(Number(p)))) {
    return parts.length === 1 ? Number(parts[0]) : parts.map(Number);
  }
  return t;
}

export class Session {
  constructor(raw, { onSubmit } = {}) {
    this.doc = new Doc(raw);
    this.path = [];
    this.history = [];   // earlier cursor paths, for "back"
    this.undoStack = []; // { json, path }
    this.pending = null; // { prompt, run }
    this.lastSearch = '';
    this.onSubmit = onSubmit || (() => 'Submitted.');
  }

  get node() {
    return this.doc.nodeAt(this.path);
  }

  // ---- helpers ----
  _moveTo(path) {
    this.history.push(this.path);
    if (this.history.length > 200) this.history.shift();
    this.path = path;
    return describeNode(this.node);
  }

  _snapshot() {
    this.undoStack.push({ json: JSON.stringify(this.doc.raw), path: this.path });
    if (this.undoStack.length > 100) this.undoStack.shift();
  }

  _afterEdit(preferPath) {
    this.doc.rebuild();
    this.path = this.doc.nodeAt(preferPath).path;
  }

  // ---- command entry point ----
  exec(line) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return { say: [] };
    let cmd = tokens[0].toLowerCase();
    cmd = ALIASES[cmd] || cmd;
    const args = tokens.slice(1);
    const rest = line.trim().slice(tokens[0].length).trim();

    try {
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        if (cmd === 'yes') return { say: p.run() };
        return { say: ['Cancelled.'] };
      }
      const fn = this['cmd_' + cmd];
      if (!fn) return { say: [`Unknown command: ${tokens[0]}.`] };
      return { say: fn.call(this, args, rest) };
    } catch (e) {
      if (e instanceof UserError) return { say: [e.message] };
      throw e;
    }
  }

  // ---- reading ----
  cmd_here() { return describeNode(this.node); }
  cmd_attrs() { return describeAttributes(this.node); }
  cmd_children() { return describeChildren(this.node); }
  cmd_path() { return describePath(this.node); }

  // ---- navigation ----
  cmd_parent() {
    if (!this.node.parent) return ['Already at the root.'];
    return this._moveTo(this.node.parent.path);
  }

  cmd_child(args) {
    const kids = this.node.children;
    if (!kids.length) return ['No children.'];
    const i = args.length ? Number(args[0]) - 1 : 0;
    if (!Number.isInteger(i) || i < 0 || i >= kids.length) {
      return [`Choose a child from 1 to ${kids.length}.`];
    }
    return this._moveTo(kids[i].path);
  }

  cmd_next() {
    const n = this.node;
    const sib = n.parent && n.parent.children[n.siblingIndex + 1];
    return sib ? this._moveTo(sib.path) : ['No next sibling.'];
  }

  cmd_prev() {
    const n = this.node;
    const sib = n.parent && n.parent.children[n.siblingIndex - 1];
    return sib ? this._moveTo(sib.path) : ['No previous sibling.'];
  }

  cmd_follow() {
    const use = attrValue(this.node, 'USE');
    if (use === undefined) return ['Not a reference.'];
    const target = this.doc.defs.get(use);
    if (!target) return [`Definition of ${use} not found.`];
    return this._moveTo(target.path);
  }

  cmd_back() {
    if (!this.history.length) return ['Nothing to go back to.'];
    this.path = this.doc.nodeAt(this.history.pop()).path;
    return describeNode(this.node);
  }

  cmd_search(args, rest) {
    const term = (rest || this.lastSearch).toLowerCase();
    if (!term) return ['Search for what?'];
    this.lastSearch = term;
    const all = [...this.doc.walk()];
    const cur = all.indexOf(this.node);
    for (let step = 1; step < all.length; step++) {
      const n = all[(cur + step) % all.length];
      const hay = [n.type, ...attributesOf(n).flatMap((a) => [a.name, String(a.value)])];
      if (hay.some((h) => h.toLowerCase().includes(term))) return this._moveTo(n.path);
    }
    return [`No other match for ${term}.`];
  }

  // ---- editing ----
  cmd_set(args, rest) {
    const m = rest.match(/^(\S+)\s+([\s\S]+)$/);
    if (!m) throw new UserError('Say: set name value.');
    const [, name, text] = m;
    const node = this.node;
    const existing = attributesOf(node).find((a) => a.name === name);
    const value = parseValue(name, text, existing && existing.value);
    const key = existing ? existing.key : (node.type === 'Comment' && name === 'comment' ? '#comment' : '@' + name);
    this._snapshot();
    node.body[key] = value;
    this._afterEdit(this.path);
    return [`${name} set to ${speakValue(value)}.`];
  }

  cmd_unset(args) {
    const [name] = args;
    if (!name) throw new UserError('Say: unset name.');
    const existing = attributesOf(this.node).find((a) => a.name === name);
    if (!existing) throw new UserError(`No attribute ${name}.`);
    this._snapshot();
    delete this.node.body[existing.key];
    this._afterEdit(this.path);
    return [`${name} removed.`];
  }

  cmd_insert(args) {
    const [type, field = 'children'] = args;
    if (!type || !TYPE_RE.test(type) || !TYPE_RE.test(field)) throw new UserError('Say: insert Type [field].');
    const node = this.node;
    const key = '-' + field;
    const item = { [type]: {} };
    const existing = node.body[key];
    if (existing !== undefined && !Array.isArray(existing)) {
      throw new UserError(`Field ${field} is already occupied.`);
    }
    this._snapshot();
    if (Array.isArray(existing)) existing.push(item);
    else node.body[key] = MF_FIELDS.has(field) ? [item] : item;
    this.doc.rebuild();
    const parent = this.doc.nodeAt(node.path);
    const created = parent.children.find((c) => c.raw === item);
    this.history.push(this.path);
    this.path = created.path;
    return [`${type} inserted in ${field}.`, ...describeNode(created)];
  }

  cmd_delete() {
    const node = this.node;
    if (!node.parent) throw new UserError('Cannot delete the root.');
    this.pending = {
      run: () => {
        this._snapshot();
        const holder = node.parent.body[node.key];
        if (node.index !== null) holder.splice(node.index, 1);
        else delete node.parent.body[node.key];
        this._afterEdit(node.parent.path);
        return ['Deleted.', ...describeNode(this.node)];
      },
    };
    return [`Delete ${node.type}? Say yes to confirm.`];
  }

  cmd_replace(args) {
    const [type] = args;
    if (!type || !TYPE_RE.test(type)) throw new UserError('Say: replace Type.');
    const node = this.node;
    if (!node.parent) throw new UserError('Cannot replace the root.');
    if (!node.wrapped) throw new UserError('Only typed nodes can be replaced.');
    this.pending = {
      run: () => {
        this._snapshot();
        const item = { [type]: {} };
        if (node.index !== null) node.parent.body[node.key][node.index] = item;
        else node.parent.body[node.key] = item;
        this._afterEdit(node.path);
        return [`Replaced with ${type}.`, ...describeNode(this.node)];
      },
    };
    return [`Replace ${node.type} with ${type}? Say yes to confirm.`];
  }

  cmd_undo() {
    const snap = this.undoStack.pop();
    if (!snap) return ['Nothing to undo.'];
    this.doc.raw = JSON.parse(snap.json);
    this._afterEdit(snap.path);
    return ['Undone.', ...describeNode(this.node)];
  }

  cmd_submit() {
    this.pending = {
      run: () => [this.onSubmit(this.doc.raw, this.doc.count())],
    };
    return [`Submit whole program, ${this.doc.count()} nodes? Say yes to confirm.`];
  }

  cmd_yes() { return ['Nothing to confirm.']; }
}
