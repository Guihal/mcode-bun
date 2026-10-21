// Exact-version repair of the existing image owner and its physical worker.
import crypto from 'node:crypto';

function exact(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Image memory anchor drift: ' + from.slice(0, 90));
  return source.replace(from, to);
}
function section(source, from, to, replacement) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  if (start < 0 || end < 0 || source.indexOf(from, start + 1) >= 0) throw Error('Image memory function drift: ' + from);
  return source.slice(0, start) + replacement + source.slice(end);
}

export function repairImageMemory(source) {
  if (crypto.createHash('sha256').update(source).digest('hex') !== '32f5847d2b8511e050a48729e891ec4485adc0faf81de94cc381cef9d370db00') throw Error('Unsupported pristine upstream image owner');
  // Transposed orientation images have their own allocation, even if flipping fails.
  source = exact(source, 'd*o+(o-1-c));return t.fliph(i),i', 'd*o+(o-1-c));try{return t.fliph(i),i}catch(error){i.free();throw error}');
  source = exact(source, '(u-1-d)*o+c);return t.fliph(i),i', '(u-1-d)*o+c);try{return t.fliph(i),i}catch(error){i.free();throw error}');
  return repairBody(source);
}

function repairBody(source) {
  source = section(source, 'async function D(', 'function rt(', `async function D(t,e,r){
  const n={...et,...r},i=Math.ceil(t.byteLength/3)*4,d=await j();
  if(!d){
    const o=R(t,e);
    if(o&&o.width>0&&o.height>0&&o.width<=n.maxWidth&&o.height<=n.maxHeight&&i<n.maxBytes)return{data:Buffer.from(t).toString("base64"),mimeType:e,originalWidth:o.width,originalHeight:o.height,width:o.width,height:o.height,wasResized:!1};
    throw new F;
  }
  let c,o;
  try{
    o=d.PhotonImage.new_from_byteslice(t);c=O(d,o,t);
    if(c!==o)o.free();o=void 0;
    const a=c.get_width(),f=c.get_height(),s=e.split("/")[1]??"png";
    if(a<=n.maxWidth&&f<=n.maxHeight&&i<n.maxBytes)return{data:Buffer.from(t).toString("base64"),mimeType:e||\`image/\${s}\`,originalWidth:a,originalHeight:f,width:a,height:f,wasResized:!1};
    let m=a,w=f;
    if(m>n.maxWidth){w=Math.round(w*n.maxWidth/m);m=n.maxWidth}
    if(w>n.maxHeight){m=Math.round(m*n.maxHeight/w);w=n.maxHeight}
    const qualities=Array.from(new Set([n.jpegQuality,85,70,55,40]));
    let l=m,g=w;
    for(;;){
      const image=d.resize(c,l,g,d.SamplingFilter.Lanczos3);
      try{
        let candidate=H(image.get_bytes(),"image/png");
        if(candidate.encodedSize<n.maxBytes)return{data:candidate.data,mimeType:candidate.mimeType,originalWidth:a,originalHeight:f,width:l,height:g,wasResized:!0};
        candidate=null;
        for(const quality of qualities){
          candidate=H(image.get_bytes_jpeg(quality),"image/jpeg");
          if(candidate.encodedSize<n.maxBytes)return{data:candidate.data,mimeType:candidate.mimeType,originalWidth:a,originalHeight:f,width:l,height:g,wasResized:!0};
          candidate=null;
        }
      }finally{image.free()}
      if(l===1&&g===1)break;
      const width=l===1?1:Math.max(1,Math.floor(l*.75)),height=g===1?1:Math.max(1,Math.floor(g*.75));
      if(width===l&&height===g)break;l=width;g=height;
    }
    return null;
  }catch{return null}finally{if(c)c.free();if(o&&o!==c)o.free()}
}
`);
  source = section(source, 'async function T(', 'function pt(', `class McodeImageWorkerUnavailable extends Error{}
async function T(t,e,r,n){
  let worker;
  try{worker=ot(t)}catch(error){throw new McodeImageWorkerUnavailable(error.message,{cause:error})}
  let timer,ready=false;
  try{
    return await new Promise((resolve,reject)=>{
      const failed=error=>reject(ready?error:new McodeImageWorkerUnavailable(error.message,{cause:error}));
      timer=setTimeout(()=>reject(new Error("Image resize worker timed out")),30000);
      worker.on("message",message=>{
        if(!it(message)){reject(new Error("Invalid image resize worker response"));return}
        if(message.ready===true&&!ready){
          ready=true;
          // Never transfer the caller's buffer (including pooled Buffer backing stores).
          try{const bytes=rt(e);worker.postMessage({inputBytes:bytes,mimeType:r,options:n},[bytes.buffer])}catch(error){reject(error)}
          return;
        }
        if(message.error){
          const error=message.name==="ImageProcessorUnavailableError"?new F:new Error(message.error);
          if(message.startup===true&&!ready)failed(error);else reject(error);
          return;
        }
        if(!ready||!("result"in message)){reject(new Error("Invalid image resize worker response"));return}
        resolve(message.result??null);
      });
      worker.once("error",failed);
      worker.once("exit",code=>failed(new Error(\`Image resize worker exited with code \${code}\`)));
    });
  }finally{clearTimeout(timer);await worker.terminate()}
}
var mcodeImageLane=Promise.resolve();
async function wt(t,e,r){
  // Gle prepares multiple image parts with Promise.all. Keep its WASM heaps
  // bounded to one owned operation instead of starting a decoder per part.
  const previous=mcodeImageLane;let release;
  mcodeImageLane=new Promise(resolve=>{release=resolve});
  await previous;
  try{
    const worker=new URL("./image-resize-worker.js",__mavis_tuiPackageEntryUrl);
    try{return await T(worker,t,e,r)}catch(error){if(error instanceof McodeImageWorkerUnavailable)return await D(t,e,r);throw error}
  }finally{release()}
}
`);
  return exact(source, 'export{F as a,wt as b,pt as c};', 'export{F as a,wt as b,pt as c,D as resizeImageOnMainThread};');
}
