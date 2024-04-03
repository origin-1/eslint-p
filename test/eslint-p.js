/* globals describe, it */

import assert                   from 'node:assert/strict';
import { execFile }             from 'node:child_process';
import { mkdtemp, writeFile }   from 'node:fs/promises';
import { tmpdir }               from 'node:os';
import { join }                 from 'node:path';
import { fileURLToPath }        from 'node:url';
import { promisify }            from 'node:util';

const countOccurrencies = (string, substring) => string.split(substring).length - 1;

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

        it
        (
            'should warn only once when a .eslintignore file is present',
            async () =>
            {
                const tmpDir = await mkdtemp(join(tmpdir(), 'eslint-p-'));
                await Promise.all
                (
                    [
                        writeFile(join(tmpDir, '.eslintignore'), ''),
                        writeFile
                        (
                            join(tmpDir, 'eslint.config.mjs'),
                            'export default []; process.emitWarning("\\n⚠\\n");',
                        ),
                    ],
                );
                const eslintPPath = fileURLToPath(new URL('../lib/eslint-p.js', import.meta.url));
                const { stdout, stderr } =
                await promisify(execFile)
                (
                    process.execPath,
                    [eslintPPath, '--concurrency=2'],
                    { cwd: tmpDir },
                );
                assert.equal(stdout, '');
                {
                    const count =
                    countOccurrencies
                    (
                        stderr,
                        ' ESLintIgnoreWarning: The ".eslintignore" file is no longer supported. ',
                    );
                    assert.equal(count, 1);
                }
                {
                    const count =
                    countOccurrencies
                    (
                        stderr,
                        '\n⚠\n',
                    );
                    assert.equal(count, 3);
                }
            },
        );
    },
);
