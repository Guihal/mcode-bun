// Module imports are shared by ESM; initialized implementations belong to one
// descriptor. A canceled caller never cancels or invalidates another call's load.
export function lazyTool(label, load, dependencies, constructorArgs) {
  let initialization;
  return {
    async execute(...args) {
      const signal = args[2];
      if (signal?.aborted) throw new Error('Operation aborted');
      initialization ??= Promise.resolve().then(load).then(module => module.default(dependencies(), constructorArgs)).catch(error => {
        initialization = undefined;
        throw new Error(`Unable to initialize native tool ${label}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      });
      const implementation = await initialization;
      if (signal?.aborted) throw new Error('Operation aborted');
      return implementation.execute(...args);
    },
  };
}

export function lazyToolClass(label, load, dependencies) {
  return class {
    constructor(...args) {
      this.execute = lazyTool(label, load, dependencies, args).execute;
    }
  };
}
