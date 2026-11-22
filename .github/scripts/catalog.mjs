import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { maxBuffer: Infinity });
const check = (ok, message) => { if (!ok) throw new Error(message); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const keysOf = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const id = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]*$/.test(value)
  && !['constructor', 'prototype', '__proto__'].includes(value);
const special = new Set('WIN WINDOWS META PAUSE PRINTSCREEN PRTSCN VOLUMEMUTE VOLUMEDOWN VOLUMEUP MEDIANEXTTRACK MEDIAPREVTRACK MEDIASTOP MEDIAPLAYPAUSE PERIOD . SEMICOLON ; SLASH / PLUS MINUS - ENTER TAB ESC ESCAPE SPACE BACKSPACE DELETE INSERT HOME END PAGEUP PAGEDOWN LEFT RIGHT UP DOWN'.split(' '));
function chord(value) {
  if (!text(value) || value.length > 100) return false;
  const parts = value.toUpperCase().split('+').map(part => part.trim());
  const key = parts.pop();
  const modifiers = parts.map(part => ({ CONTROL: 'CTRL', WINDOWS: 'WIN', META: 'WIN' })[part] ?? part);
  return (special.has(key) || /^[A-Z0-9]$|^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key))
    && modifiers.every(part => ['CTRL','ALT','SHIFT','WIN'].includes(part))
    && new Set(modifiers).size === parts.length
    && (!parts.length || !['WIN','WINDOWS','META'].includes(key));
}
function defaults(value) {
  if (value === undefined) return true;
  if (!keysOf(value, ['when'])) return false;
  const w = value.when;
  if (!keysOf(w, ['scope','appletIds','processes','excludeDesktop','excludeTaskbar','excludeExplorer','excludedProcesses'])
      || !['global','app','applets','exe','browser','desktop','taskbar','explorer'].includes(w.scope)) return false;
  const pages = w.appletIds ?? [];
  if (!Array.isArray(pages) || pages.some(p => !text(p)) || new Set(pages).size !== pages.length
      || (pages.length > 0) !== (w.scope === 'applets')) return false;
  for (const field of ['processes','excludedProcesses']) {
    if (w[field] !== undefined && (!Array.isArray(w[field]) || w[field].some(p => !text(p) || !/^[\p{L}\p{N}_. -]{1,120}$/u.test(p.trim())))) return false;
  }
  return (Boolean(w.processes?.length) === (w.scope === 'exe'))
    && (!w.excludedProcesses?.length || w.scope === 'global')
    && ['excludeDesktop','excludeTaskbar','excludeExplorer'].every(k =>
      w[k] === undefined || (typeof w[k] === 'boolean' && (w.scope === 'global' || (k === 'excludeTaskbar' && !w[k]))));
}
function validate(set) {
  check(keysOf(set, ['schemaVersion','id','title','description','defaults','commands'])
    && set.schemaVersion === 1 && id(set.id) && text(set.title)
    && (set.description === undefined || text(set.description)) && defaults(set.defaults)
    && Array.isArray(set.commands) && set.commands.length, 'Invalid set definition');
  const seen = new Set();
  for (const command of set.commands) {
    check(keysOf(command, ['id','title','keys','category','description','defaults'])
      && id(command.id) && ('commandset.' + set.id + '.' + command.id).length <= 180
      && !seen.has(command.id) && text(command.title) && chord(command.keys)
      && (command.category === undefined || text(command.category))
      && (command.description === undefined || text(command.description)) && defaults(command.defaults),
      'Invalid or duplicate command in ' + set.id + ': ' + command?.id);
    seen.add(command.id);
  }
}
const publicFiles = new Set(['README.md','LICENSE','.gitattributes','.github/workflows/catalog.yml','.github/scripts/catalog.mjs']);
const revision = git('rev-parse','HEAD').toString().trim();
const entries = [];
const ids = new Set();
for (const record of git('ls-tree','-rz',revision).toString().split('\0').filter(Boolean)) {
  const tab = record.indexOf('\t');
  const header = record.slice(0, tab);
  const path = record.slice(tab + 1);
  check(header.startsWith('100644 blob ') && !path.includes('\t'), 'Unsupported file: ' + path);
  if (publicFiles.has(path)) continue;
  check(/^sets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/.test(path), 'Outside the distribution file list: ' + path);
  const bytes = git('show',revision + ':' + path);
  const set = JSON.parse(bytes.toString('utf8'));
  validate(set);
  check(!ids.has(set.id), 'Duplicate set ID: ' + set.id);
  ids.add(set.id);
  const updatedAt = git('log','--first-parent','-1','--format=%cI',revision,'--',path).toString().trim();
  entries.push({ id: set.id, title: set.title, description: set.description, path, updatedAt,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    commands: set.commands.map(({ title, keys, category }) => ({ title, keys, category })) });
}
const output = JSON.stringify({ schemaVersion: 1, revision, sets: entries }, null, 2) + '\n';
if (process.argv[2]) writeFileSync(process.argv[2], output);
console.log('Validated ' + entries.length + ' command sets at ' + revision);
