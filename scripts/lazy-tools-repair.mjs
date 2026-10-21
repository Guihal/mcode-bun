import crypto from 'node:crypto';
import { localToolDescriptors } from './local-tool-descriptors.mjs';
import { baseToolDescriptors } from './base-tool-descriptors.mjs';

const hash = source => crypto.createHash('sha256').update(source).digest('hex');
const identifier = /^[A-Za-z_$][\w$]*$/;

function locate(source, descriptor) {
  const first = source.indexOf(descriptor.anchor);
  if (first < 0 || source.indexOf(descriptor.anchor, first + 1) >= 0) throw Error('Lazy tool anchor drift: ' + descriptor.name);
  if (descriptor.kind === 'method' && !source.startsWith(descriptor.prefix, first)) throw Error('Lazy base tool factory drift: ' + descriptor.name);
  const start = descriptor.kind === 'method' ? first + descriptor.prefix.length : descriptor.kind === 'function' ? first : descriptor.kind === 'closure' ? first + 'execute:'.length : first + descriptor.name.length + 1;
  const text = source.slice(start, start + descriptor.length);
  if (hash(text) !== descriptor.hash) throw Error('Unsupported lazy tool source: ' + descriptor.name);
  return { ...descriptor, start, end: start + descriptor.length, text };
}

// These offsets came from resolved module bindings, not text-name matches.
// Shared mutable bindings remain live through getters into their original owner.
function rewritten(record, locals) {
  let text = record.text;
  for (const [offset, name, shorthand, namespace] of record.refs) {
    if (locals.has(name)) continue;
    if (!identifier.test(name) || text.slice(offset, offset + name.length) !== name) throw Error('Lazy tool dependency drift: ' + name);
    const value = `(0,__mcodeDeps.${namespace ? namespace + '.' : ''}${name})`;
    text = text.slice(0, offset) + (shorthand ? name + ':' : '') + value + text.slice(offset + name.length);
  }
  // Generated resources live beside chunks/, preserving the original relative
  // dynamic PDF import without adding it to the eager compiled dependency graph.
  return text.replaceAll('import("./', 'import("../chunks/');
}

export function extractLocalTools(source) {
  const classes = localToolDescriptors.classes.map(d => locate(source, d));
  const helpers = localToolDescriptors.helpers.map(d => locate(source, d));
  const closures = localToolDescriptors.closures.map(d => locate(source, d));
  const helperMap = new Map(helpers.map(d => [d.name, d]));
  const resources = {}, dependencies = new Set();
  // Upstream's xJe/XJe symbols are distinct JavaScript bindings but are unsafe
  // filenames on Windows and in Bun's case-folded module identity cache.
  const moduleName = record => record.kind === 'class' ? 'local-' + classes.indexOf(record).toString().padStart(2, '0') : record.name;
  function resource(record) {
    const included = new Set();
    function include(current) {
      for (const [, name] of current.refs) {
        const helper = helperMap.get(name);
        if (helper && !included.has(name)) { included.add(name); include(helper); }
      }
    }
    include(record);
    const locals = new Set(included);
    for (const item of [record, ...included].map(item => typeof item === 'string' ? helperMap.get(item) : item)) {
      for (const [, name] of item.refs) if (!locals.has(name)) dependencies.add(name);
    }
    const body = helpers.filter(d => included.has(d.name)).map(d => (d.kind === 'variable' ? 'var ' + d.name + '=' : '') + rewritten(d, locals) + ';').join('\n');
    const value = rewritten(record, locals);
    resources[`lazy-tools/${moduleName(record)}.mjs`] = `export default function(__mcodeDeps,__mcodeArgs){\n${record.kind === 'closure' ? 'const [e,n]=__mcodeArgs;\n' : ''}${body}\n${record.kind === 'class' ? 'const Impl=' + value + ';return new Impl(...__mcodeArgs)' : 'return {execute:' + value + '}'}\n}\n`;
  }
  [...classes, ...closures].forEach(resource);
  const edits = helpers.map(d => ({ ...d, replacement: d.kind === 'function' ? '' : 'void 0' }));
  for (const d of classes) edits.push({ ...d, replacement: `Rt(${d.def})(__mcodeLazyToolClass(${d.def}.name,()=>__mcodeLocalLoad(${JSON.stringify(moduleName(d))}),()=>__mcodeLocalDependencies))` });
  for (const d of closures) edits.push({ ...d, replacement: `__mcodeLazyTool(${d.name === 'cron' ? 'n.name' : 'CI.name'},()=>__mcodeLocalLoad(${JSON.stringify(d.name)}),()=>__mcodeLocalDependencies,${d.name === 'cron' ? '[e,n]' : '[e]'}).execute` });
  for (const d of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, d.start) + d.replacement + source.slice(d.end);
  source += '\nimport{lazyTool as __mcodeLazyTool,lazyToolClass as __mcodeLazyToolClass}from"../../runtime/lazy-tool.mjs";\n' +
    'const __mcodeLocalDependencies={' + [...dependencies].sort().map(name => `get ${name}(){return ${name}}`).join(',') + '};\n' +
    'function __mcodeLocalLoad(name){const url=__mavis_pathToFileURL(__mavis_join(__mavis_tuiPackageRoot,"lazy-tools",name+".mjs")).href;return import(url)}\n';
  return { source, resources };
}

export function repairLazyTools(name, source, resources) {
  if (name === 'chunks/chunk-ZPSMBMGA.js') {
    const result = extractBaseTools(source);
    if (resources) Object.assign(resources, result.resources);
    return result.source;
  }
  if (name !== 'chunks/chunk-47KWM23C.js') return source;
  const result = extractLocalTools(source);
  if (resources) Object.assign(resources, result.resources);
  return result.source;
}

// The fallback runner and the registered classes share these factories. Retain
// their synchronous metadata, render hooks, shell selection and captured owner
// state, moving only execution and its exclusive pure helpers out of the core.
export function extractBaseTools(source) {
  const methods = baseToolDescriptors.methods.map(d => locate(source, d));
  const helpers = baseToolDescriptors.helpers.map(d => locate(source, d));
  const helperMap = new Map(helpers.map(d => [d.name, d])), resources = {}, shared = new Set();
  const edits = helpers.map(d => ({ ...d, replacement: d.kind === 'function' ? '' : 'void 0' }));
  for (const method of methods) {
    const included = new Set();
    function include(record) {
      for (const [, name] of record.refs) if (helperMap.has(name) && !included.has(name)) { included.add(name); include(helperMap.get(name)); }
    }
    include(method);
    const owner = new Set();
    for (const record of [method, ...included].map(x => typeof x === 'string' ? helperMap.get(x) : x)) {
      for (const [, name, , namespace] of record.refs) if (!included.has(name)) (namespace === 'shared' ? shared : owner).add(name);
    }
    const body = helpers.filter(d => included.has(d.name)).map(d => (d.kind === 'variable' ? 'var ' + d.name + '=' : '') + rewritten(d, included) + ';').join('\n');
    resources[`lazy-tools/base-${method.id}.mjs`] = 'export default function(__mcodeDeps){\n' + body + '\nreturn{' + rewritten(method, included) + '}\n}\n';
    edits.push({ ...method, replacement: `execute:__mcodeLazyTool(${JSON.stringify('base-' + method.id)},()=>__mcodeBaseLoad(${JSON.stringify(method.id)}),()=>({shared:__mcodeBaseDependencies,owner:{${[...owner].sort().map(name => `get ${name}(){return ${name}}`).join(',')}}}),[]).execute` });
  }
  for (const d of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, d.start) + d.replacement + source.slice(d.end);
  source += '\nimport{lazyTool as __mcodeLazyTool}from"../../runtime/lazy-tool.mjs";\n' +
    'const __mcodeBaseDependencies={' + [...shared].sort().map(name => `get ${name}(){return ${name}}`).join(',') + '};\n' +
    'function __mcodeBaseLoad(name){const url=__mavis_pathToFileURL(__mavis_join(__mavis_tuiPackageRoot,"lazy-tools","base-"+name+".mjs")).href;return import(url)}\n';
  return { source, resources };
}
