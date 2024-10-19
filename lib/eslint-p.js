#!/usr/bin/env node

import module from 'node:module';

// to use V8's code cache to speed up instantiation time
module.enableCompileCache?.();

const createCLIExecutePromise = import('./create-cli-execute.js');

const [{ createRequire }, { default: eslintDirURL }] =
await Promise.all([import('node:module'), import('./default-eslint-dir-url.js')]);

// Add --concurrency option.
{
    const requireAsESLint = createRequire(eslintDirURL);
    const moduleId = requireAsESLint.resolve('optionator');
    const optionator = requireAsESLint(moduleId);
    const module = requireAsESLint.cache[moduleId];
    module.exports =
    function (libOptions)
    {
        libOptions.options.push
        (
            {
                option:         'concurrency',
                type:           'Int',
                default:        '0',
                description:    'Number of linting threads or 0 to calculate automatically',
            },
        );
        return optionator(libOptions);
    };
}

const [{ default: cli }, { default: createCLIExecute }] =
await Promise.all([import(`${eslintDirURL}lib/cli.js`), createCLIExecutePromise]);
cli.execute = await createCLIExecute(eslintDirURL, cli.calculateInspectConfigFlags);
await import(`${eslintDirURL}bin/eslint.js`);
