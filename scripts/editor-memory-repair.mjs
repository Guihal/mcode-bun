// Exact-version repair of the two terminal editor undo snapshot shapes.
import crypto from 'node:crypto';

export function repairEditorMemory(source) {
  if (crypto.createHash('sha256').update(source).digest('hex') !== '2c4337e3a58bdc3e2411a19d7c0d885f328fd5806242308ba3ea6433d7edfbe3') throw Error('Unsupported pristine upstream editor owner');
  const from = 'push(e){this.stack.push(structuredClone(e))}';
  if (source.split(from).length !== 2) throw Error('Editor undo snapshot anchor drift');
  // Strings are immutable. Own the mutable state/lines/map containers, retaining
  // structuredClone for arbitrary nested attachment/plugin extension state.
  const to = 'push(e){this.stack.push("state"in e?{...e,state:{...e.state,lines:[...e.state.lines]},pastes:new Map(e.pastes),...e.extensionState===void 0?{}:{extensionState:structuredClone(e.extensionState)}}:{value:e.value,cursor:e.cursor})}';
  return source.replace(from, to);
}
