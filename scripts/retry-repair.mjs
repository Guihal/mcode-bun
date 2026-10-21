// Exact-version repair of the existing request/retry owner, not a CLI supervisor.
import crypto from 'node:crypto';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function exact(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Repair anchor drift: ' + from.slice(0, 90));
  return source.replace(from, to);
}
function section(source, from, to, update) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  if (start < 0 || end < 0) throw Error('Repair function drift: ' + from);
  return source.slice(0, start) + update(source.slice(start, end)) + source.slice(end);
}
export function repair(source) {
  if (hash(source) !== 'c9d0342a9efa65955831fdc28907cbd434aab354ec3fbaf1f253f7d3b9b36293') throw Error('Unsupported pristine upstream request owner');
  source = section(source, 'function rB(', 'async function Npn(', body => {
    body = exact(body, 'return(async(o,a,l)=>{', 'return Object.assign(async(o,a,l)=>{');
    body = exact(body, 'p,g=1,b;', 'g=1,b;');
    body = exact(body, 'p??=w;let _=w+A-p>n.maxRetryElapsedMs;if(g>n.maxRetries||_)', 'if(g>n.maxRetries)');
    if (!body.endsWith('})}')) throw Error('Retry factory ending drift');
    return 'var mcodeRetryOwned=Symbol("mcode.providerRetryOwned");\n' + body.slice(0, -3) + '},{[mcodeRetryOwned]:!0})}';
  });
  source = section(source, 'async function Npn(', 'function Dpn(', () => `
// Publish one completed successful request; failed partial text/tools never enter history.
async function Npn(e,t,n,r,i,s,o,a,l){
  let response,stream,iterator,snapshot;
  const options={...(r??{}),maxRetries:0,onResponse:async(value,meta)=>{response=value;await r?.onResponse?.(value,meta)}};
  Object.defineProperty(options,e4,{value:s,enumerable:true});
  const failure=(final,thrown)=>{
    F_(l,a,final??snapshot,thrown,r?.signal);
    return cR({final,thrown,response,stream,iterator,buffered:[],nowMs:i,callerAborted:r?.signal?.aborted===true});
  };
  try{
    stream=await e(t,n,options);
    iterator=stream[Symbol.asyncIterator]();
    for(;;){
      const next=await iterator.next();
      if(next.done)break;
      snapshot=Vdn(next.value)??snapshot;
      if(next.value.type==="error")return failure(next.value.error);
    }
    const final=await stream.result();
    if(Hpn(final))return failure(final);
    F_(l,a,final,void 0,r?.signal);
    return {kind:"committed",stream:mcodePublishedStream(final)};
  }catch(error){return failure(void 0,error)}
}
function mcodePublishedStream(message){
  return {
    async *[Symbol.asyncIterator](){
      yield {type:"start",partial:{...message,content:[]}};
      yield message.stopReason==="error"||message.stopReason==="aborted"
        ?{type:"error",reason:message.stopReason,error:message}
        :{type:"done",reason:message.stopReason,message};
    },
    result:async()=>message
  };
}
`);
  source = section(source, 'function cR(', 'function Bpn(', body => {
    body = exact(body, 'explicitAbort:e.final?.stopReason==="aborted"', 'explicitAbort:e.callerAborted===!0');
    const from = body.indexOf(',i=e.retryAllErrors'), to = body.indexOf(';return i.retryable', from);
    if (from < 0 || to < 0) throw Error('Retry classification drift');
    body = body.slice(0, from) + ';r.facts.explicitAbort=e.callerAborted===!0;if(e.final?.stopReason==="aborted"&&!e.callerAborted)e.final={...e.final,stopReason:"error"};let i={retryable:!e.callerAborted,reason:hO(r.facts)}' + body.slice(to);
    return body.replaceAll('normalized:r,error:', 'normalized:r,final:e.final,error:');
  });
  source = section(source, 'function tWe(', 'function Upn(', body => {
    body = exact(body, 'explicitAbort:n||e?.stopReason==="aborted"', 'explicitAbort:n===!0');
    return exact(body, '),i=hO(r.facts);return', ');r.facts.explicitAbort=n===!0;let i=hO(r.facts);return');
  });
  source = exact(source, 'function Fpn(e){if(!e.stream)', 'function Fpn(e){if(e.final){Lpn(e);return mcodePublishedStream({...e.final,content:[]})}if(!e.stream)');
  source = exact(source, 'return t.metrics?t.metrics.wrapLogicalStreamFn(I,{recordTerminalFailure:A==="agent"}):I}', 'return Object.assign(t.metrics?t.metrics.wrapLogicalStreamFn(I,{recordTerminalFailure:A==="agent"}):I,{[mcodeRetryOwned]:C[mcodeRetryOwned]})}');
  source = exact(source, 'return{maxOutputTokens:e.maxOutputTokens,fits:r=>hPt(', 'return{[mcodeRetryOwned]:e.streamFn?.[mcodeRetryOwned]===!0,maxOutputTokens:e.maxOutputTokens,fits:r=>hPt(');
  source = exact(source, 'if(o.stopReason!=="error")return{generation:o,attemptNumber:r.value};', 'if(o.stopReason!=="error")return{generation:o,attemptNumber:r.value};if(t[mcodeRetryOwned])throw new Qy("CHECKPOINT_PROVIDER_FAILED","llm_checkpoint","Checkpoint Provider request failed after the native retry budget was exhausted.");');
  return source;
}
