/* globals describe, it */

import assert               from 'node:assert/strict';
import { execFile }         from 'node:child_process';
import { fileURLToPath }    from 'node:url';
import { promisify }        from 'node:util';

describe
(
    'eslint-p',
    () =>
    {
        it
        (
            'with `--help`',
            async () =>
            {
                const eslintPPath = fileURLToPath(new URL('../lib/eslint-p.js', import.meta.url));
                const { stdout } =
                await promisify(execFile)
                (
                    process.execPath,
                    [eslintPPath, '--help'],
                );
                assert
                (
                    stdout.endsWith
                    ('--concurrency Int               Number of concurrent threads - default: 1\n'),
                );
            },
        );

        it
        (
            'when patchESLint fails',
            async () =>
            {
                const eslintPPath = fileURLToPath(new URL('../lib/eslint-p.js', import.meta.url));
                const loaderSrc =
                `
                import path from 'node:path';

                const { normalize } = path;
                path.normalize =
                (...args) =>
                {
                    if (args.length === 1 && args[0] === '.eslintcache')
                    {
                        path.normalize = normalize;
                        throw Error('Boom 💣');
                    }
                    return normalize(...args);
                };
                `;
                const promise =
                promisify(execFile)
                (
                    process.execPath,
                    ['--import', `data:text/javascript,${encodeURI(loaderSrc)}`, eslintPPath],
                );
                await assert.rejects
                (
                    promise,
                    ({ stdout, stderr }) =>
                    {
                        assert(/^Error: Boom 💣$/mu.test(stderr));
                        assert.equal(stdout, '');
                        return true;
                    },
                );
            },
        );
    },
);
