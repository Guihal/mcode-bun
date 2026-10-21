import crypto from 'node:crypto';
import { capabilityDescriptors, unusedCapabilityMetadata } from './capability-descriptors.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function locate(source, descriptor) {
  const at = source.indexOf(descriptor.anchor);
  if (at < 0 || source.indexOf(descriptor.anchor, at + 1) >= 0) throw Error('Capability anchor drift: ' + descriptor.name);
  const start = at + (descriptor.kind === 'destructure' ? descriptor.anchor.indexOf('=') + 1 : descriptor.kind === 'closure' ? 8 : ['class', 'variable'].includes(descriptor.kind) ? descriptor.name.length + 1 : 0);
  const text = source.slice(start, start + descriptor.length);
  if (hash(text) !== descriptor.hash) throw Error('Unsupported capability source: ' + descriptor.name);
  return { ...descriptor, start, end: start + descriptor.length, text };
}
function rewrite(record, locals) {
  let text = record.text;
  for (const [offset, name, shorthand] of record.refs) {
    if (locals.has(name)) continue;
    if (!/^[A-Za-z_$][\w$]*$/.test(name) || text.slice(offset, offset + name.length) !== name) throw Error('Capability dependency drift: ' + name);
    text = text.slice(0, offset) + (shorthand ? name + ':' : '') + `(0,__mcodeDeps.${name})` + text.slice(offset + name.length);
  }
  return text.replaceAll('import("./', 'import("../chunks/');
}

export function repairLazyCapabilities(name, source, resources) {
  const descriptors = capabilityDescriptors[name.replace(/^chunks\//, '')];
  if (!descriptors) return source;
  const targets = descriptors.targets.map(d => locate(source, d)), helpers = descriptors.helpers.map(d => locate(source, d));
  const helperMap = new Map(helpers.map(d => [d.name, d])), dependencies = new Set();
  const edits = [...helpers, ...descriptors.dead.map(d => locate(source, d))].map(d => ({ ...d, replacement: d.kind === 'function' ? '' : 'void 0' }));
  for (const target of targets) {
    const included = new Set();
    function include(record) { for (const [, key] of record.refs) if (helperMap.has(key) && !included.has(key)) { included.add(key); include(helperMap.get(key)); } }
    include(target);
    for (const record of [target, ...helpers.filter(d => included.has(d.name))]) for (const [, key] of record.refs) if (!included.has(key)) dependencies.add(key);
    const body = helpers.filter(d => included.has(d.name)).map(d => (d.kind === 'variable' ? 'var ' + d.name + '=' : '') + rewrite(d, included) + ';').join('\n');
    const value = rewrite(target, included), resource = `lazy-capabilities/${target.id}.mjs`;
    let generated, replacement;
    if (target.kind === 'class') {
      generated = `export default function(__mcodeDeps,__mcodeArgs){\n${body}\nconst Impl=${value};return new Impl(...__mcodeArgs)\n}\n`;
      const decorator = name.includes('47K') ? 'Rt' : 'mU';
      const lazyClass = `__mcodeLazyCapabilityClass(${target.def}.name,()=>__mcodeCapabilityImport(${JSON.stringify(target.id)}),()=>__mcodeCapabilityDependencies)`;
      // The two goal implementations accept context/input only. Do not invent
      // a third-argument cancellation contract when adapting their methods.
      const ownerClass = target.id.startsWith('goal-') ? `class extends ${lazyClass}{constructor(...args){super(...args);const execute=this.execute;this.execute=(context,input)=>execute(context,input)}}` : lazyClass;
      replacement = `${decorator}(${target.def})(${ownerClass})`;
    } else {
      // These functions have no owner-local initialization. Cache their pure
      // helper closure in the physical ESM module; mutable shared state stays
      // in live getters at its original owner. Method receivers remain intact.
      const expression = target.kind === 'method' ? `({${value}}).${target.method}` : target.kind === 'closure' ? `(t,e,n)=>${value}` : value;
      generated = `let implementation;export default function(__mcodeDeps){if(implementation)return implementation;\n${body}\nreturn implementation=${expression}\n}\n`;
      const invoke = `await __mcodeCapabilityFunction(${JSON.stringify(target.id)})`;
      replacement = target.kind === 'function' ? `async function ${target.name}(...args){return(${invoke})(...args)}` : target.kind === 'method' ? `async ${target.method}(...args){return(${invoke}).apply(this,args)}` : `async(i,a,o)=>(${invoke})(t,e,n)(i,a,o)`;
    }
    if (resources) resources[resource] = generated;
    edits.push({ ...target, replacement });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.replacement + source.slice(edit.end);
  // These private declarations have no resolved reads or exports after class
  // pruning. Their only initialization is data/TypeBox schema construction.
  const metadata = (unusedCapabilityMetadata[name.replace(/^chunks\//, '')] ?? []).map(d => locate(source, d));
  for (const d of metadata.sort((a, b) => b.start - a.start)) source = source.slice(0, d.start) + (d.kind === 'destructure' ? '{}' : 'void 0') + source.slice(d.end);
  source += '\nimport{lazyToolClass as __mcodeLazyCapabilityClass}from"../../runtime/lazy-tool.mjs";\n' +
    'const __mcodeCapabilityDependencies={' + [...dependencies].sort().map(key => `get ${key}(){return ${key}}`).join(',') + '};\n' +
    'function __mcodeCapabilityImport(name){return import(__mavis_pathToFileURL(__mavis_join(__mavis_tuiPackageRoot,"lazy-capabilities",name+".mjs")).href)}\n' +
    'async function __mcodeCapabilityFunction(name){const module=await __mcodeCapabilityImport(name);return module.default(__mcodeCapabilityDependencies)}\n';
  return source;
}
