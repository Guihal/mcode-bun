// Pinned canonical-history owners. The retry repair must run first.
import crypto from 'node:crypto';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function exact(source, from, to) {
  if (source.split(from).length !== 2) throw Error('History memory anchor drift: ' + from.slice(0, 100));
  return source.replace(from, to);
}
function section(source, from, to, replacement) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  if (start < 0 || end < 0 || source.indexOf(from, start + 1) >= 0) throw Error('History memory section drift: ' + from);
  return source.slice(0, start) + replacement(source.slice(start, end)) + source.slice(end);
}

const reader = String.raw`
var mcodeReadInfo=new WeakMap;
function mcodeStatKey(s){return [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(":")}
async function X$n(path,parse,cache){
 const before=await mcodeHistoryLstat(path),file=await Nv(path,"r");
 try{
  const opened=await file.stat();
  if(!before.isFile()||before.isSymbolicLink()||mcodeStatKey(before)!==mcodeStatKey(opened))throw Error("Canonical history artifact changed during read");
  const cap=4*1024*1024,block=64*1024,hash=mcodeHistoryHash("sha256"),previousSize=cache.byteLength;
  let position=0,previousDigest,carry=[],carrySize=0,lineStart=0,prefixEnd=0,prefixCount=0,records=[],offsets=[],prefixParts=[];
  const consumeHash=bytes=>{
   if(previousSize!==void 0&&previousSize>=position&&previousSize<=position+bytes.length){
    const cut=previousSize-position;hash.update(bytes.subarray(0,cut));previousDigest=hash.copy().digest("hex");hash.update(bytes.subarray(cut));
   }else hash.update(bytes);
   if(position<cap)prefixParts.push(Buffer.from(bytes.subarray(0,Math.min(bytes.length,cap-position))));
   position+=bytes.length;
  };
  const line=(bytes,end,newline)=>{
   offsets.push(lineStart);records.push(ezn(bytes.toString("utf8"),parse,{path,lineNo:records.length+1}));
   lineStart=end;if(newline&&end<=cap){prefixEnd=end;prefixCount=records.length}
  };
  const decode=(bytes,start)=>{
   let from=0;
   for(;;){const end=bytes.indexOf(10,from);if(end<0)break;
    const part=bytes.subarray(from,end),value=carrySize?Buffer.concat([...carry,part],carrySize+part.length):part;
    line(value,start+end+1,true);carry=[];carrySize=0;from=end+1;
   }
   if(from<bytes.length){const rest=Buffer.from(bytes.subarray(from));carry.push(rest);carrySize+=rest.length}
  };
  // Compare the complete retained prefix before reusing any decoded envelope.
  const prefix=Buffer.allocUnsafe(Math.min(cache.bytes.length,opened.size));
  let read=0;
  while(read<prefix.length){const n=(await file.read(prefix,read,Math.min(block,prefix.length-read),read)).bytesRead;if(!n)throw Error("Canonical history artifact changed during read");read+=n}
  if(prefix.length){consumeHash(prefix);
   const same=prefix.length===cache.bytes.length&&prefix.equals(cache.bytes);
   if(same&&(prefix.at(-1)===10||prefix.length===opened.size)){
    records=[...cache.records];offsets=[...(cache.offsets??[])];lineStart=prefix.length;
    if(prefix.at(-1)===10){prefixEnd=prefix.length;prefixCount=records.length}
   }else decode(prefix,0);
  }
  const buffer=Buffer.allocUnsafe(block);
  for(;;){const start=position,n=(await file.read(buffer,0,block,start)).bytesRead;if(!n)break;const bytes=buffer.subarray(0,n);consumeHash(bytes);decode(bytes,start)}
  if(carrySize)line(Buffer.concat(carry,carrySize),position,false);
  const after=await file.stat(),named=await mcodeHistoryLstat(path);
  if(position!==opened.size||mcodeStatKey(opened)!==mcodeStatKey(after)||mcodeStatKey(after)!==mcodeStatKey(named)||named.isSymbolicLink())throw Error("Canonical history artifact changed during read");
  const allPrefix=Buffer.concat(prefixParts),result=Object.freeze(records),info={offsets,byteLength:position,rawDigest:hash.digest("hex"),previousByteLength:previousSize,previousDigest,statKey:mcodeStatKey(after),fileKey:[after.dev,after.ino].join(":"),path};
  mcodeReadInfo.set(result,info);
  // Cache publication is atomic with a successful complete read. Copy bounded bytes.
  cache.bytes=Buffer.from(allPrefix.subarray(0,position<=cap?position:prefixEnd));
  cache.records=position<=cap?result:Object.freeze(records.slice(0,prefixCount));
  cache.offsets=position<=cap?offsets:offsets.slice(0,prefixCount);cache.byteLength=position;
  return result;
 }finally{await file.close()}
}
`;

const scanner = String.raw`
var mcodeScanFacts=new WeakMap;
function mcodeProofInfo(info){if(!info)return;const {offsets,...proof}=info;return proof}
async function mcodeArchiveKeys(path){
 const names=await _dr(path),keys=[];
 for(const item of names){const stat=await mcodeHistoryLstat(item.path);keys.push([item.fileName,item.regular&&!stat.isSymbolicLink()&&stat.isFile(),mcodeStatKey(stat)])}
 return JSON.stringify(keys);
}
async function mcodeScanArtifact(files,path,kind){
 let before;try{before=await mcodeHistoryLstat(path)}catch(error){throw new Za("malformed-jsonl",error)}
 if(!before.isFile()||before.isSymbolicLink())throw new Za("unsafe-artifact");
 // A fresh bounded cache for each archive is released with that generation.
 let result;
 if(files instanceof wSe){
  result=await u_t((async()=>{const records=kind==="active"&&files.options.reuseDecodedRecords?await files.readActiveStrict(path):await X$n(path,Rcr,{bytes:Buffer.alloc(0),records:[],offsets:[]});kind==="active"?Pa(records):lSe(records);return records})(),path,kind);
 }else result=await u_t(kind==="active"?files.readActiveStrict(path):files.readStrict(path),path,kind);
 let info=mcodeReadInfo.get(result.records);
 if(!info){const lines=await X$n(path,()=>null,{bytes:Buffer.alloc(0),records:[],offsets:[]});info=mcodeReadInfo.get(lines)}
 if(mcodeStatKey(before)!==info.statKey)throw new Za("unsafe-artifact");
 return {...result,info};
}
function mcodeGenerationFacts(artifact){
 const users=[];
 for(let index=0;index<artifact.records.length;index++){
  const record=artifact.records[index];if(!Idr(record.message_id))continue;
  if(record.message.role!=="user")throw new Za("external-user-lineage-conflict");
  users.push({id:record.message_id,fingerprint:wdr(record),lineNumber:index+1,byteOffset:artifact.info.offsets[index]});
 }
 return users;
}
function mcodeApplyUsers(users,generation,revision,lineage,locators){
 for(const user of users){const previous=lineage.get(user.id);
  if(previous&&(previous.fingerprint!==user.fingerprint||previous.lastGeneration+1!==generation))throw new Za("external-user-lineage-conflict");
  lineage.set(user.id,{fingerprint:user.fingerprint,lastGeneration:generation});
  if(!previous)locators.push({schemaVersion:1,messageId:user.id,generation,lineNumber:user.lineNumber,byteOffset:user.byteOffset,artifactRevision:revision});
 }
}
async function yU(e,t=rE()){
 const archiveKeys=await mcodeArchiveKeys(e.snapshotsPath),names=await _dr(e.snapshotsPath),byGeneration=gdr(names),reached=new Set,artifacts=[],facts=[];
 let artifact=await mcodeScanArtifact(t,e.activePath,"active"),generation=Sdr(artifact.records),activeGeneration=generation,activeRevision=artifact.revision,activeInfo=mcodeProofInfo(artifact.info);
 for(;;){
  const marker=d_t(artifact.records,generation),fileName=artifact.kind==="active"?"messages.jsonl":artifact.fileName;
  artifacts.unshift({revision:artifact.revision,generation,kind:artifact.kind,fileName,byteLength:artifact.byteLength,messageCount:artifact.messageCount});facts.unshift({generation,revision:artifact.revision,users:mcodeGenerationFacts(artifact)});
  if(generation===0)break;
  if(!marker)throw new Za("invalid-generation-marker");
  const parent=marker.parentSnapshot;if(parent.generation!==generation-1)throw new Za("parent-mismatch");
  const name=byGeneration.get(parent.generation)?.find(item=>item.compactionId===parent.compactionId);
  if(!name)throw new Za("parent-snapshot-missing");if(!name.regular)throw new Za("unsafe-artifact");
  if(reached.has(name.fileName))throw new Za("invalid-generation-marker");reached.add(name.fileName);
  // Drop the preceding payload before loading the next generation.
  artifact=void 0;
  artifact=await mcodeScanArtifact(t,name.path,"snapshot");
  if(artifact.revision!==parent.revision)throw new Za("artifact-revision-mismatch");
  artifact.fileName=name.fileName;generation=name.generation;
 }
 const lineage=new Map,locators=[];
 for(const item of facts)mcodeApplyUsers(item.users,item.generation,item.revision,lineage,locators);
 if(archiveKeys!==await mcodeArchiveKeys(e.snapshotsPath)||activeInfo.statKey!==mcodeStatKey(await mcodeHistoryLstat(e.activePath)))throw new Za("unsafe-artifact");
 const result={catalog:{schemaVersion:1,sessionId:e.sessionId,activeGeneration,activeRevision,artifacts},locators,orphans:names.filter(item=>!reached.has(item.fileName)).map(item=>item.fileName)};
 mcodeScanFacts.set(result,{lineage,archiveKeys,activeInfo});return result;
}
`;

const index = String.raw`
async function p(b,m,h=!1,y,append){
 const A=y??await t.readActiveStrict(m.messages),w=a.get(b)??U7(m.sessionDir);a.set(b,w);
 const state=mcodeIndexes.get(b),info=mcodeReadInfo.get(A),revision=Zr(A),generation=W7(A);
 try{
  let archives;try{archives=await mcodeArchiveKeys(m.snapshots)}catch{}
  if(!e.files&&state&&info&&archives!==void 0&&archives===state.archiveKeys){
   if(append&&append.normal&&append.existingRevision===state.result.catalog.activeRevision&&append.existingInfo?.rawDigest===state.activeInfo.rawDigest&&append.existingInfo?.statKey===state.activeInfo.statKey&&info.fileKey===state.activeInfo.fileKey&&generation===state.result.catalog.activeGeneration&&info.previousByteLength===state.activeInfo.byteLength&&info.previousDigest===state.activeInfo.rawDigest&&A.length===append.existingLength+append.appended.length&&Cy(A.slice(append.existingLength))===Cy(append.appended)){
    const lineage=new Map(state.lineage),locators=state.result.locators.map(item=>item.generation===generation?{...item,artifactRevision:revision}:item);
    const tail={records:A.slice(append.existingLength),info:{offsets:info.offsets.slice(append.existingLength)}};
    const users=mcodeGenerationFacts(tail).map(item=>({...item,lineNumber:item.lineNumber+append.existingLength}));
    mcodeApplyUsers(users,generation,revision,lineage,locators);
    const catalog={...state.result.catalog,activeRevision:revision,artifacts:state.result.catalog.artifacts.map(item=>item.kind==="active"?{...item,revision,byteLength:info.byteLength,messageCount:A.length}:item)},result={catalog,locators,orphans:state.result.orphans};
    if(archives!==await mcodeArchiveKeys(m.snapshots)||info.statKey!==mcodeStatKey(await mcodeHistoryLstat(m.messages))){mcodeIndexes.delete(b);return p(b,m,h)}
    await w.rebuild(result);mcodeIndexes.clear();mcodeIndexes.set(b,{result,lineage,archiveKeys:archives,activeInfo:mcodeProofInfo(info)});return;
   }
   if(revision===state.result.catalog.activeRevision&&info.rawDigest===state.activeInfo.rawDigest&&info.statKey===state.activeInfo.statKey){
    await w.loadOrRebuild({sessionId:b,activeGeneration:generation,activeRevision:revision},()=>state.result);return;
   }
  }
  mcodeIndexes.delete(b);
  const result=await yU({activePath:m.messages,snapshotsPath:m.snapshots,sessionId:b},e.files?void 0:t),facts=mcodeScanFacts.get(result);
  await w.rebuild(result);if(!e.files){mcodeIndexes.clear();mcodeIndexes.set(b,{result,...facts})}
 }catch(error){mcodeIndexes.delete(b);if(error instanceof FC||h&&evt(error))return;throw error}
}
`;

export function repairHistoryMemory(source) {
  // Guard the complete post-retry owner, not only the replacement snippets.
  // The pristine digest remains independently enforced by repair().
  if (digest(source) !== 'd9c8d0fcd045a0e67c6c24bfaad2ceeaf49cb9a3c9a11f512d3e67b75ef035fa') throw Error('Unsupported post-retry history owner');
  source = 'import {lstat as mcodeHistoryLstat} from "node:fs/promises";import {createHash as mcodeHistoryHash} from "node:crypto";\n' + source;
  source = section(source, 'async function X$n(', 'function Z$n(', () => reader);
  source = section(source, 'async function yU(', 'async function mdr(', () => scanner);
  source = exact(source, 'var vj=class{', 'var mcodeHistoryReadonly=Symbol("mcode.history.readonly"),mcodeImmutableMessages=new WeakMap;function mcodeHistoryReadonlyRequest(previous){return{[mcodeHistoryReadonly]:previous}}function mcodeHistorySnapshot(snapshot,request){return request&&Object.hasOwn(request,mcodeHistoryReadonly)?lr({...snapshot,messages:lr(snapshot.messages).value,identityVector:lr(snapshot.identityVector).value}).value:snapshot}function mcodeHistoryMessage(record,request,index){if(!request||!Object.hasOwn(request,mcodeHistoryReadonly)||!uU.has(record))return $Se(record.message);let message=mcodeImmutableMessages.get(record);if(!message){const previous=request[mcodeHistoryReadonly],candidate=previous?.identityVector[index]===record.message_id?previous.messages[index]:void 0;message=lr(record.message,candidate).value;mcodeImmutableMessages.set(record,message)}return message}var vj=class{');
  for (const call of ['append(n)', 'replace(n)', 'read(t)', 'readActive(t)']) source = exact(source, 'this.provider.' + call, 'this.provider.' + call.slice(0, -1) + ',mcodeHistoryReadonlyRequest(this.previousSnapshot))');
  source = exact(source, 'operation:{id:n.operation?.id??t.operation.id,kind:"compaction"}})', 'operation:{id:n.operation?.id??t.operation.id,kind:"compaction"}},mcodeHistoryReadonlyRequest(this.previousSnapshot))');
  source = section(source, 'function QBr(', 'function Yxe(', body => {
    for (const method of ['read','readActive','append','replace','compact']) body = exact(body, method + ':async n=>{', method + ':async(n,request)=>{');
    for (const method of ['read','readActive']) body = exact(body, 'await e.' + method + '(n)', 'await e.' + method + '(n,request)');
    for (const method of ['append','replace']) body = exact(body, 'await e.' + method + '(Yxe(n))', 'await e.' + method + '(Yxe(n),request)');
    body = exact(body, 'e.compact({...s,method:i.method,replacementSourceIndexes:i.replacementSourceIndexes})', 'e.compact({...s,method:i.method,replacementSourceIndexes:i.replacementSourceIndexes},request)');
    return exact(body, 'e.compact({...s,method:i.method})', 'e.compact({...s,method:i.method},request)');
  });
  source = exact(source, 'function K_t(e,t){return{revision:t?Zr(e):fd(e),messages:e.map(({message:n})=>$Se(n)),identityVector:e.map(({message_id:n})=>n)}}', 'function K_t(e,t,request){return mcodeHistorySnapshot({revision:t?Zr(e):fd(e),messages:e.map((record,index)=>mcodeHistoryMessage(record,request,index)),identityVector:e.map(({message_id:n})=>n)},request)}');
  source = section(source, 'function tvt(', 'async function USe(', body => {
    body = exact(body, 'a=new Map,l=new WeakMap;', 'a=new Map,l=new WeakMap,mcodeIndexes=new Map;');
    body = exact(body, 'read:b=>g(b,()=>u(b,!1)),readActive:b=>g(b,()=>u(b,!0))', 'read:(b,request)=>g(b,()=>u(b,!1,request)),readActive:(b,request)=>g(b,()=>u(b,!0,request))');
    body = exact(body, 'append:b=>g(b.sessionId,async()=>{await USe', 'append:(b,request)=>g(b.sessionId,async()=>{let append;await USe');
    body = exact(body, 'Vpr(y,A),await zpr({files:t,path:h.messages,existing:y,appended:A})', 'Vpr(y,A);append={existingRevision:Zr(y),existingInfo:mcodeReadInfo.get(y),existingLength:y.length,appended:A,normal:await zpr({files:t,path:h.messages,existing:y,appended:A})}');
    body = exact(body, 'let m=await u(b.sessionId,!0);return e.activity?.notify(b.sessionId),m}),replace:', 'let m=await u(b.sessionId,!0,request,append);return e.activity?.notify(b.sessionId),m}),replace:');
    body = exact(body, 'replace:b=>g(b.sessionId,async()=>{', 'replace:(b,request)=>g(b.sessionId,async()=>{mcodeIndexes.delete(b.sessionId);');
    body = exact(body, 'let m=await u(b.sessionId,!0);return e.activity?.notify(b.sessionId),m}),compact:', 'let m=await u(b.sessionId,!0,request);return e.activity?.notify(b.sessionId),m}),compact:');
    body = exact(body, 'compact:b=>g(b.sessionId,async()=>{', 'compact:(b,request)=>g(b.sessionId,async()=>{mcodeIndexes.delete(b.sessionId);');
    body = exact(body, 'delete:b=>g(b,async()=>{', 'delete:b=>g(b,async()=>{mcodeIndexes.delete(b);a.delete(b);');
    body = exact(body, 'messages:x.map(({message:U})=>$Se(U))', 'messages:x.map((record,index)=>mcodeHistoryMessage(record,request,index))');
    body = exact(body, 'return e.activity?.notify(b.sessionId),D}', 'return e.activity?.notify(b.sessionId),mcodeHistorySnapshot(D,request)}');
    body = exact(body, 'async function u(b,m){', 'async function u(b,m,request,append){');
    body = exact(body, 'return await p(b,h,!0,A),K_t(A,m)', 'return await p(b,h,!0,A,append),K_t(A,m,request)');
    const start=body.indexOf('async function p('),end=body.indexOf('async function g(',start);
    if(start<0||end<0)throw Error('History index lane drift');
    body=body.slice(0,start)+index+body.slice(end);
    body=exact(body,'return s.run(b,m)','return s.run(b,async()=>{try{return await m()}catch(error){mcodeIndexes.delete(b);throw error}})');
    return body;
  });
  source = section(source, 'async function zpr(', 'function qpr(', body => exact(exact(body, 'n.records);return}', 'n.records);return!1}'), 'await e.files.append(e.path,e.appended,e.existing)}', 'await e.files.append(e.path,e.appended,e.existing);return!0}'));
  return source;
}
