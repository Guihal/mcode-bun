// Preserve the synchronous registry transaction; retry acquisition only.
// proper-lockfile's sync API explicitly rejects its own retries option.
export function repairMcpRegistry(source) {
  const from = 'let n=(0,C9e.lockSync)(r,{realpath:!1,retries:0}),s;';
  if (source.split(from).length !== 2) throw Error('Unsupported upstream MCP name registry acquisition');
  const to = `let n=(()=>{
    const deadline=globalThis.performance.now()+5000;
    const sleeper=new Int32Array(new SharedArrayBuffer(4));
    for(;;){
      try{return (0,C9e.lockSync)(r,{realpath:!1,retries:0})}
      catch(error){
        const remaining=deadline-globalThis.performance.now();
        if(error?.code!=="ELOCKED"||remaining<=0)throw error;
        Atomics.wait(sleeper,0,0,Math.min(20,remaining));
      }
    }
  })(),s;`;
  return source.replace(from, to);
}
