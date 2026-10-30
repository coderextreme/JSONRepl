// Node -> sentences. Fixed order every time, so the rhythm becomes learnable:
//   type, [DEF/USE], position, attribute count, children summary.
// Each sentence is a separate unit so playback can repeat or step back by sentence.

import { attributesOf, attrValue } from './model.js';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const countWord = (n) => (n < WORDS.length ? WORDS[n] : String(n));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, one, many) => (n === 1 ? one : many);

const MAX_INLINE_NUMBERS = 12;
const MAX_INLINE_STRINGS = 6;
const MAX_STRING = 80;

function fmtNumber(n) {
  return String(Number.isInteger(n) ? n : Number(n.toFixed(4)));
}

export function speakValue(v) {
  if (typeof v === 'number') return fmtNumber(v);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)} and more` : v;
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    if (v.length === 0) return 'empty';
    if (v.every((x) => typeof x === 'number')) {
      return v.length <= MAX_INLINE_NUMBERS ? v.map(fmtNumber).join(' ') : `${v.length} numbers`;
    }
    if (v.every((x) => typeof x === 'string')) {
      return v.length <= MAX_INLINE_STRINGS ? v.join(', ') : `${v.length} strings`;
    }
    return `${v.length} items`;
  }
  return 'structured value';
}

function positionSentence(node) {
  if (!node.parent) return 'Root.';
  const where = node.field && node.field.toLowerCase() !== node.type.toLowerCase()
    ? `, in ${node.field}` : '';
  if (node.siblingCount === 1) return `Only child${where}.`;
  return `Child ${node.siblingIndex + 1} of ${node.siblingCount}${where}.`;
}

function childrenSummary(node) {
  const kids = node.children;
  if (!kids.length) return 'No children.';
  const shown = kids.slice(0, 4).map((k) => k.type);
  const more = kids.length - shown.length;
  const list = shown.join(', ') + (more > 0 ? `, and ${more} more` : '');
  return `${cap(countWord(kids.length))} ${plural(kids.length, 'child', 'children')}: ${list}.`;
}

export function describeNode(node) {
  const out = [`${node.type}.`];
  const def = attrValue(node, 'DEF');
  const use = attrValue(node, 'USE');
  if (def !== undefined) out.push(`Defined as ${def}.`);
  if (use !== undefined) out.push(`Reference to ${use}.`);
  out.push(positionSentence(node));
  const n = attributesOf(node).length;
  out.push(n === 0 ? 'No attributes.' : `${cap(countWord(n))} ${plural(n, 'attribute', 'attributes')}.`);
  out.push(childrenSummary(node));
  return out;
}

export function describeAttributes(node) {
  const attrs = attributesOf(node);
  if (!attrs.length) return ['No attributes.'];
  return attrs.map((a) => `${a.name}, ${speakValue(a.value)}.`);
}

export function describeChildren(node) {
  if (!node.children.length) return ['No children.'];
  return node.children.map((k, i) => {
    const def = attrValue(k, 'DEF');
    const use = attrValue(k, 'USE');
    const tag = def !== undefined ? ` defined as ${def}` : use !== undefined ? ` reference to ${use}` : '';
    return `${i + 1}, ${k.field}: ${k.type}${tag}.`;
  });
}

export function describePath(node) {
  const parts = [];
  for (let n = node; n; n = n.parent) {
    const def = attrValue(n, 'DEF');
    parts.unshift(def !== undefined ? `${n.type} ${def}` : n.type);
  }
  return [`Path: ${parts.join(', ')}.`];
}
