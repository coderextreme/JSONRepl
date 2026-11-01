import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Session } from '../src/session.js';
import { Doc } from '../src/model.js';
import { describeNode } from '../src/describe.js';
import { Player, RecordingSink } from '../src/player.js';

const load = () => JSON.parse(fs.readFileSync(new URL('../sample.json', import.meta.url), 'utf8'));
const run = (s, ...lines) => lines.map((l) => s.exec(l).say);

test('root description follows the fixed order', () => {
  const doc = new Doc(load());
  assert.deepEqual(describeNode(doc.root), ['X3D.', 'Root.', 'Three attributes.', 'Two children: head, Scene.']);
});

test('navigation: down to the Box, with container field named', () => {
  const s = new Session(load());
  run(s, 'child 2', 'child 3', 'child'); // Scene -> 3rd child (Transform Hero)... see asserts below
  const hero = s.node;
  assert.equal(hero.type, 'Transform');
  const out = run(s, 'child', 'child 2', 'child')[2]; // Shape -> geometry -> Box
  assert.equal(s.node.type, 'Box');
  assert.deepEqual(out, ['Box.', 'Only child, in geometry.', 'One attribute.', 'No children.']);
});

test('attributes read in order, long arrays are summarized', () => {
  const s = new Session(load());
  s.exec('search Coordinate');
  assert.equal(s.node.type, 'Coordinate');
  assert.deepEqual(s.exec('attrs').say, ['point, 18 numbers.']);
  s.exec('search Material');
  assert.deepEqual(s.exec('attrs').say, ['diffuseColor, 1 0 0.']);
});

test('follow jumps USE -> DEF and back returns', () => {
  const s = new Session(load());
  s.exec('search USE'); // matches the attribute name "USE"
  assert.equal(s.node.type, 'Shape');
  const before = s.path;
  const say = s.exec('follow').say;
  assert.equal(say[0], 'Shape.');
  assert.equal(say[1], 'Defined as RedBox.');
  s.exec('back');
  assert.deepEqual(s.path, before);
  assert.deepEqual(s.exec('follow').say.slice(0, 1), ['Shape.']);
});

test('set parses by existing type; undo restores the document exactly', () => {
  const raw = load();
  const original = JSON.stringify(raw);
  const s = new Session(raw);
  s.exec('search Box');
  assert.deepEqual(s.exec('set size 2 3 4').say, ['size set to 2 3 4.']);
  assert.deepEqual(s.exec('attrs').say, ['size, 2 3 4.']);
  assert.deepEqual(s.exec('set size nope').say, ['Expected numbers.']);
  s.exec('undo');
  assert.equal(JSON.stringify(s.doc.raw), original);
});

test('delete needs confirmation, anything else cancels', () => {
  const s = new Session(load());
  s.exec('search Box');
  const prompt = s.exec('delete').say;
  assert.equal(prompt[0], 'Delete Box? Say yes to confirm.');
  assert.deepEqual(s.exec('next').say, ['Cancelled.']);
  assert.equal(s.node.type, 'Box');
  s.exec('delete');
  const done = s.exec('yes').say;
  assert.equal(done[0], 'Deleted.');
  assert.equal(s.node.type, 'Shape'); // cursor falls back to the parent
  assert.equal(s.doc.root.children.length, 2);
  s.exec('undo');
  assert.equal(s.exec('search Box').say[0], 'Box.');
});

test('insert adds to an array field, refuses an occupied single field', () => {
  const s = new Session(load());
  s.exec('search Hero');
  const before = s.node.children.length;
  const say = s.exec('insert Group').say;
  assert.equal(say[0], 'Group inserted in children.');
  assert.equal(s.node.type, 'Group');
  s.exec('parent');
  assert.equal(s.node.children.length, before + 1);
  s.exec('search RedBox'); // the Shape holding geometry
  assert.deepEqual(s.exec('insert Sphere geometry').say, ['Field geometry is already occupied.']);
});

test('replace keeps position and requires confirmation', () => {
  const s = new Session(load());
  s.exec('search Box');
  s.exec('replace Sphere');
  const say = s.exec('yes').say;
  assert.equal(say[0], 'Replaced with Sphere.');
  assert.equal(s.node.type, 'Sphere');
  assert.equal(s.node.field, 'geometry');
});

test('submit confirms, then hands the whole document to the callback', () => {
  let got;
  const s = new Session(load(), { onSubmit: (doc, n) => { got = { doc, n }; return 'Submitted.'; } });
  assert.match(s.exec('submit').say[0], /^Submit whole program, \d+ nodes\? Say yes to confirm\.$/);
  assert.deepEqual(s.exec('yes').say, ['Submitted.']);
  assert.ok(got.doc.X3D && got.n > 10);
});

test('search wraps and repeats with no argument', () => {
  const s = new Session(load());
  s.exec('search Transform');
  const first = s.path;
  s.exec('search');
  assert.notDeepEqual(s.path, first);
  s.exec('search');
  assert.deepEqual(s.path, first); // only two Transforms: wraps around
});

test('player reverse steps back by sentence', async () => {
  const sink = new RecordingSink();
  const p = new Player({ sink, instant: true });
  await p.play(['One a.', 'Two b.', 'Three c.']);
  await p.reverse();
  assert.deepEqual(sink.sentences.slice(3), ['Three c.', 'Two b.', 'One a.']);
});
