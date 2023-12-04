#!/usr/bin/env node

import { createRequire }    from 'node:module';
import { join }             from 'node:path';
import { pathToFileURL }    from 'node:url';
import createCLIExecute     from './create-cli-execute.js';

const require = createRequire(import.meta.url);
const eslintDir = join(require.resolve('eslint'), '../../');
const eslintDirURL = pathToFileURL(eslintDir);

// Add --concurrency option.
{
    const requireAsESLint = createRequire(eslintDirURL);
    requireAsESLint('optionator');
    const moduleId = requireAsESLint.resolve('optionator');
    const module = requireAsESLint.cache[moduleId];
    const optionator = module.exports;
    module.exports =
    function (libOptions)
    {
        libOptions.options.push
        (
            {
                option:         'concurrency',
                type:           'Int',
                default:        '1',
                description:    'Number of concurrent threads',
            },
        );
        return optionator(libOptions);
    };
}

const { default: cli } = await import(`${eslintDirURL}lib/cli.js`);
cli.execute = await createCLIExecute(eslintDirURL);
await import(`${eslintDirURL}bin/eslint.js`);
