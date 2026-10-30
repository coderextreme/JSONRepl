#!/usr/bin/env node
// Text REPL for the protactile X3D JSON editor prototype.
//   node src/repl.js [file.json] [--out submitted.json] [--instant]

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Session } from './session.js';
import { Player, ConsoleSink } from './player.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out');

const file = positional[0] || path.join(here, '..', 'sample.json');
const outFile = opt('--out') || 'submitted.json';
const isTTY = Boolean(process.stdout.isTTY);
const instant = flag('--instant') || !isTTY;

const HELP = `
Read     here  attrs  children  path
Move     parent  child [n]  next  prev  follow (USE -> DEF)  back  search [text]
Edit     set name value  unset name  insert Type [field]  delete  replace Type  undo
Program  submit            (delete/replace/submit ask for "yes")
Playback repeat  reverse  slower  faster
Other    help  quit
`;

const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const session = new Session(raw, {
  onSubmit: (doc, count) => {
    fs.writeFileSync(outFile, JSON.stringify(doc, null, 2));
    return `Submitted. ${count} nodes written to ${path.basename(outFile)}.`;
  },
});
const player = new Player({ sink: new ConsoleSink(), instant });

async function handle(line) {
  const cmd = line.trim().split(/\s+/)[0].toLowerCase();
  switch (cmd) {
    case '': return true;
    case 'quit': case 'exit': return false;
    case 'help': console.log(HELP); return true;
    case 'repeat': await player.repeat(); return true;
    case 'reverse': await player.reverse(); return true;
    case 'slower': await player.play([`Speed ${player.slower().toFixed(2)}.`], { remember: false }); return true;
    case 'faster': await player.play([`Speed ${player.faster().toFixed(2)}.`], { remember: false }); return true;
    default: {
      const { say } = session.exec(line);
      await player.play(say);
      return true;
    }
  }
}

console.log(`Loaded ${path.basename(file)}. Type "help" for commands.`);
await player.play(session.exec('here').say);

const rl = readline.createInterface({ input: process.stdin, terminal: isTTY });
if (isTTY) process.stdout.write('> ');
for await (const line of rl) {
  if (!isTTY) console.log('> ' + line);
  if (!(await handle(line))) break;
  if (isTTY) process.stdout.write('> ');
}
rl.close();
