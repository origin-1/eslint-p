#!/usr/bin/env node

import { createRequire }    from 'node:module';
import createCLIExecute     from './create-cli-execute.js';
import eslintDirURL         from './default-eslint-dir-url.js';

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

const { default: cli } = await import(`${eslintDirURL}lib/cli.js`);
cli.execute = await createCLIExecute(eslintDirURL, cli.calculateInspectConfigFlags);
await import(`${eslintDirURL}bin/eslint.js`);
