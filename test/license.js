import assert       from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import eslintDirURL from '../lib/default-eslint-dir-url.js';

it
(
    'ESLint License',
    async () =>
    {
        const actualURL = new URL('../ESLint License.txt', import.meta.url);
        const expectedURL = new URL('./LICENSE', eslintDirURL);
        const [actual, expected] =
        await Promise.all([readFile(actualURL), readFile(expectedURL)]);
        assert.deepEqual(actual, expected);
    },
);
