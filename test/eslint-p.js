import assert                           from 'node:assert/strict';
import { execFile }                     from 'node:child_process';
import { mkdir, mkdtemp, writeFile }    from 'node:fs/promises';
import { tmpdir }                       from 'node:os';
import { dirname, join }                from 'node:path';
import { fileURLToPath }                from 'node:url';
import { promisify }                    from 'node:util';

const countOccurrencies = (string, substring) => string.split(substring).length - 1;

describe
(
    'eslint-p',
    () =>
    {
        let pkgPath;
        let eslintPPath;

        before
        (
            () =>
            {
                pkgPath = dirname(fileURLToPath(new URL('.', import.meta.url)));
                eslintPPath = join(pkgPath, 'lib', 'eslint-p.js');
            },
        );

        it
        (
            'should print version information',
            async function ()
            {
                const { stdout, stderr } =
                await promisify(execFile)
                (
                    process.execPath,
                    [eslintPPath, '--version'],
                    { timeout: this.timeout() },
                );
                assert.equal(stderr, '');
                assert.match(stdout, /^eslint-p v\d+\.\d+\.\d+\nESLint v\d+\.\d+\.\d+\n$/);
            },
        );

        it
        (
            'should warn only once when a .eslintignore file is present',
            async function ()
            {
                const tmpDir = await mkdtemp(join(tmpdir(), 'eslint-p-'));
                const url = new URL('./fixtures/load-count.mjs', import.meta.url);
                const configFileText = `export { default } from ${JSON.stringify(url)};`;
                await Promise.all
                (
                    [
                        writeFile(join(tmpDir, '.eslintignore'), ''),
                        writeFile(join(tmpDir, 'eslint.config.mjs'), configFileText),
                        writeFile(join(tmpDir, 'index.js'), ''),
                    ],
                );
                const { stdout, stderr } =
                await promisify(execFile)
                (
                    process.execPath,
                    [eslintPPath, '--concurrency=2'],
                    { cwd: tmpDir, timeout: this.timeout() },
                );
                assert.equal(stdout, '');
                {
                    const count = countOccurrencies(stderr, ' ESLintIgnoreWarning: ');
                    assert.equal(count, 1);
                }
                {
                    const count = countOccurrencies(stderr, '\n⚠\n');
                    assert.equal(count, 3);
                }
            },
        );

        it
        (
            'should warn only once when an inactive flag is passed',
            async function ()
            {
                const tmpDir = await mkdtemp(join(tmpdir(), 'eslint-p-'));
                const url = new URL('./fixtures/load-count.mjs', import.meta.url);
                const configFileText = `export { default } from ${JSON.stringify(url)};`;
                await Promise.all
                (
                    [
                        writeFile(join(tmpDir, 'eslint.config.mjs'), configFileText),
                        writeFile(join(tmpDir, 'index.js'), ''),
                    ],
                );
                const { stdout, stderr } =
                await promisify(execFile)
                (
                    process.execPath,
                    [eslintPPath, '--concurrency=2', '--flag=test_only_replaced'],
                    { cwd: tmpDir, timeout: this.timeout() },
                );
                assert.equal(stdout, '');
                {
                    const count =
                    countOccurrencies(stderr, ' ESLintInactiveFlag_test_only_replaced: ');
                    assert.equal(count, 1);
                }
                {
                    const count = countOccurrencies(stderr, '\n⚠\n');
                    assert.equal(count, 3);
                }
            },
        );

        it
        (
            'should warn only once for each empty config file',
            async function ()
            {
                const tmpDir = await mkdtemp(join(tmpdir(), 'eslint-p-'));
                const url = new URL('./fixtures/load-count.mjs', import.meta.url);
                const configFileText = `import ${JSON.stringify(url)};`;
                await Promise.all
                (
                    [
                        writeFile(join(tmpDir, 'eslint.config.mjs'), configFileText),
                        writeFile(join(tmpDir, 'index.js'), ''),
                        (async () =>
                        {
                            const subDir = join(tmpDir, 'subdir');
                            await mkdir(subDir);
                            await Promise.all
                            (
                                [
                                    writeFile(join(subDir, 'eslint.config.mjs'), configFileText),
                                    writeFile(join(subDir, 'index.js'), ''),
                                ],
                            );
                        }
                        )(),
                    ],
                );
                const { stdout, stderr } =
                await promisify(execFile)
                (
                    process.execPath,
                    [eslintPPath, '--concurrency=2', '--flag=v10_config_lookup_from_file'],
                    { cwd: tmpDir, timeout: this.timeout() },
                );
                assert.equal(stdout, '');
                {
                    const count = countOccurrencies(stderr, ' ESLintEmptyConfigWarning: ');
                    assert.equal(count, 2);
                }
                {
                    const count = countOccurrencies(stderr, '\n⚠\n');
                    assert.equal(count, 3);
                }
            },
        );
    },
);
