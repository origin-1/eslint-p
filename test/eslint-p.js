/* globals it */

import assert               from 'node:assert/strict';
import { execFile }         from 'node:child_process';
import { fileURLToPath }    from 'node:url';
import { promisify }        from 'node:util';

it
(
    'eslint-p',
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
