// Pinned 0.6.12 startup owners. The pristine 98-file inventory is checked by build.
import crypto from 'node:crypto';

function exact(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Startup repair anchor drift: ' + from.slice(0, 100));
  return source.replace(from, to);
}

export function repairStartupMemory(name, source) {
  if (name === 'chunks/chunk-47KWM23C.js') {
    // These webpack loaders only export Jiti's factory and Babel's transform.
    // Neither result has a consumer. Jiti's loader installation and Babel's
    // stack rewriting occur on factory/transform invocation, not registration.
    const start = source.indexOf('var ctt=Ne('), end = source.indexOf('var fme=Ne(', start);
    if (start < 0 || end < 0 || crypto.createHash('sha256').update(source.slice(start, end)).digest('hex') !== '59c1f61205270004d99c98647741059d1df45054d9472a78f6aa9482ee0e124a') throw Error('Unsupported unused startup vendor loaders');
    source = source.slice(0, start) + source.slice(end);
    source = exact(source, 'var WRn=Es(ctt(),1),KRn=Es(dtt(),1);', '');
    // This second Undici bundle has no consumer. The used networking owners
    // retain their own dispatcher initialization, including configured proxies.
    source = exact(source, 'var $me=Es(DMt(),1);', '');
    source = exact(source, 'import{a as DMt}from"./chunk-KTNHM6NK.js";', '');
    // Unused namespace copies do not own registration. YAML/locking remain
    // initialized by their real consumers; ignore/git URL parsers are pure.
    for (const [from, to] of [
      ['var wun=Es(hw(),1);', ''],
      ['var Qun=Es(aVe(),1),$un=Es(hw(),1);', ''],
      ['var jRn=Es(hw(),1);', ''],
      ['var PPn=Es(fme(),1);', ''],
      ['var T1n=Es(fme(),1);', ''],
      ['var k1n=Es(mrt(),1);', ''],
      ['var R1n=Es(zX(),1);', ''],
      ['var $1n=Es(zX(),1);', ''],
    ]) source = exact(source, from, to);
    // These private classes have no consumers or exports in the pinned graph.
    // Their sole decorator is Rt: a non-enumerable WeakMap association keyed by
    // the otherwise unreachable constructor. Static blocks only apply that
    // decorator and class-local Symbol.metadata; constructors never run here.
    // Keep metadata needed by active catalogs, removing only dead class bodies.
    for (const [symbol, length, digest] of [
      ["awi", 9239, "4da4840283b2941aa337264d5eff6dbc8d29fce6f4cf94da37ab93ede4ceb9f1"],
      ["fwi", 2039, "7de05113f7ae286a9230131c9acfd8f90bb70869c31aa1f9c8f59d527f5699fe"],
      ["y1i", 1347, "00d607332fc3d8bb80ff2d66c3da22f79a00646b801b4ee9089724bba806bf11"],
      ["x1i", 1690, "6e2edda8d27c72f9e462de1cdf31f6f9a430df4fedf82660a663dad2619885c2"],
      ["F1i", 2412, "f789e3ca9d2fd3d149b4633cf6476e00504cc542d40fc9f2bf8d9219db007345"],
      ["q1i", 832, "71e2983d1b7102d400886b9ea2d2aa6aa78dc46b265abc9a31e85855589e1be9"],
      ["H1i", 850, "aaa6efac394b3efb4db434a74f2787e3a1d6f25cdbec55348faf277ebf9bf943"],
      ["G1i", 984, "96f2e1a6d8dd200b66e9c96bd92128aead078c6efdfd006413544e5817fb2ec3"],
      ["V1i", 967, "5533576f36166d6d5a3e09987cae86644ba5c042ec017ee92344ddc9d2057ffb"],
      ["W1i", 937, "02b978f3e08cdbaa0dd833710d671e46ca663524e3ab0907cb7e610db366fd03"],
      ["K1i", 913, "b069a380a5aefc4219361bd117f14819dab60ededdf2a6f9213a3743b59a548a"],
      ["J1i", 2338, "333b88d307b6e3601c67b2eb11fb0e286d36ed04c7c6d45feb2de8417283a072"],
      ["Y1i", 1026, "74f05ef9738793714e97e149600ed477ef08f7eb32bc956098b2d63e3b75f5d0"],
      ["X1i", 947, "0a56b0fa628acccc54b65f57858d97daf13a3063a6a745302f9066730b121700"],
      ["Z1i", 1060, "979f1c720853f7a391555fcfa7f62ce2183de62b8885491ac1d232d561e590f3"],
      ["eOi", 897, "16f817a72794c391be740197ab5d6e4d22108a1ab512c092c1476be43172b5a4"],
      ["EOi", 1144, "dd2a82c1eb23e39a7152b3d5f3488ff2300922d3295dde3bbfaf709da2d108f5"],
      ["xOi", 3498, "f21d649809d4a5073420e1c37b420091f7db1145385a6f9fa64b1c43ed18835b"],
      ["nLi", 1256, "d6913aced0ab640bfaac84eb354bd4ec29f82ba4af38a415234a75efe853fdb9"],
      ["CLi", 18238, "f3955603aa240409a8fdd51fea1f041697eff0474c70c057982a40ba35403294"],
      ["OLi", 830, "4d8fbbf403b20f45e44adcf0c459009e8bc27eb156406a8311e08c6dbd6419f2"],
      ["BLi", 869, "3344f05ea63436f25d331db62f4d8d8f226acdb18a8d7a5e4ec3e735f92e10ce"],
      ["LLi", 599, "abe7cd7f2340a7fb7fe6228d8f78275810b97ea79b9360e448b3fe0aa93c86dc"],
      ["Z2i", 579, "1ed0a6ea70d4f79a664d134a183f3e84b3abcef678c48ee377d143b0484d7e87"],
      ["cji", 997, "2dbdc4d9497b8a528db1b8d7b742f18e535373a0ad04c966f764fbe5a4f3bd83"],
      ["mji", 1305, "88a01357e1841cb947ebd6c2731fd594773f75eee7a8c67e6a3047789b0e2347"],
      ["kji", 3655, "a65e90fac5d594477c3ca5f2d2c4aad0dce6f37633322f2860fd20ff1dcac337"],
      ["Oji", 826, "8c425cc78b45fecaf885ae33c040f3171cc4f28fc5dfaaf263de2674b49d0b37"],
      ["RUi", 1473, "9a301c380a1a4235099082ac709a723d3e7b8e0e9df32af5a7fb3ba6182036ff"]
    ]) {
      const anchor = symbol + '=(()=>{let e=[Rt(';
      if (source.split(anchor).length !== 2) throw Error('Unused class anchor drift: ' + symbol);
      const start = source.indexOf(anchor) + symbol.length + 1;
      if (crypto.createHash('sha256').update(source.slice(start, start + length)).digest('hex') !== digest) throw Error('Unsupported unused class: ' + symbol);
      source = source.slice(0, start) + 'void 0' + source.slice(start + length);
    }
    // Preserve the existing singleton lifetimes, creating each only at its
    // first actual compile/validate request. No plugin/DI hooks move here.
    source = exact(source, 'var PXe=Es(uce(),1),MXe=Es(RXe(),1);function nCn(){let e=', 'var PXe,MXe;function nCn(){PXe??=Es(uce(),1);MXe??=Es(RXe(),1);let e=');
    // i_e installs the existing .hbs/.handlebars require hooks, so its module
    // initialization must stay eager. Only the private extra instance is cold.
    source = exact(source, 'var dVn=Opt.default.create();', 'var dVn;');
    source = exact(source, 'return dVn.compile(e,{noEscape:!0,strict:!0})(t)', 'return(dVn??=Opt.default.create()).compile(e,{noEscape:!0,strict:!0})(t)');
    // Only rGe has a consumer among this module's bound encoding exports.
    // Keep the exact model/configuration, but build its processor on first count.
    const tokenStart = source.indexOf('var wln=PH.getEncodingApiForModel('), tokenEnd = source.indexOf('var Eln=4', tokenStart);
    const tokenSource = source.slice(tokenStart, tokenEnd);
    if (tokenStart < 0 || tokenEnd < 0 || crypto.createHash('sha256').update(tokenSource).digest('hex') !== '7bbcb991e33b97f2c4bc6334426ac4531067624037698e38d5e3b11c231e5b30') throw Error('Unsupported primary startup tokenizer');
    const tokenFactory = tokenSource.slice('var wln='.length, tokenSource.indexOf(',{decode:Lei'));
    source = source.slice(0, tokenStart) + 'var wln;function rGe(text,options){return(wln??=' + tokenFactory + ').countTokens(text,options)}' + source.slice(tokenEnd);
    // Both original string counters use B4e + X4e(o200k_base), the same
    // special-token policy, and the bounded processor merge cache. Only the
    // primary has a chat model; the memory owner never exposes cache setters
    // and only calls countTokens on strings. Preserve its non-string error.
    source += '\nfunction mcodeMemoryCountTokens(text,options){if(typeof text!=="string")throw new Error("Model name must be provided either during initialization or passed in to the method.");return rGe(text,options)}export{mcodeMemoryCountTokens};\n';
  }
  if (name === 'chunks/chunk-5ADYFF2U.js') {
    source = exact(source, 'var bzn=UAe.getEncodingApi("o200k_base",()=>jAe),{decode:f$i,decodeAsyncGenerator:p$i,decodeGenerator:h$i,encode:g$i,encodeGenerator:_$i,isWithinTokenLimit:y$i,countTokens:kf,encodeChat:w$i,encodeChatGenerator:N$i,vocabularySize:S$i,setMergeCacheSize:v$i,clearMergeCache:E$i,estimateCost:I$i}=bzn;', 'import{mcodeMemoryCountTokens as kf}from"./chunk-47KWM23C.js";');
    source = exact(source, 'Z as jAe,', '');
    source = exact(source, '_ as UAe,', '');
    source = exact(source, 'var POr=zr(jf(),1);', '');
    source = exact(source, 'var K3n=zr(hh(),1);', '');
  }
  return source;
}
