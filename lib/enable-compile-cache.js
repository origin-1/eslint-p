import module from 'node:module';

// to use V8's code cache to speed up instantiation time
/* c8 ignore next */
module.enableCompileCache?.();
