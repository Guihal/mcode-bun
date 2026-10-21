// Opt in at the existing stdio factory. Preserve ordinary stdio and Windows.
export function repairSharedMcp(source) {
  const from = 'function Kie(t,e){return new $ie({command:t.command,args:t.args,env:__r(t.env,e?.env),cwd:t.cwd??h_r(),stderr:"pipe",maxBufferSize:g_r})}';
  if (source.split(from).length !== 2) throw Error('Unsupported upstream shared MCP transport factory');
  return source.replace(from, 'function Kie(t,e){const options={command:t.command,args:t.args,env:__r(t.env,e?.env),cwd:t.cwd??h_r(),stderr:"pipe",maxBufferSize:g_r};if(process.platform!=="win32"&&options.env.MCODE_SHARED_MCP==="1")return new (require(__mavis_join(__mavis_tuiPackageRoot,"..","runtime","shared-mcp.cjs")).SharedMcpTransport)(options);return new $ie(options)}');
}
