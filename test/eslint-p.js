import assert                   from 'node:assert/strict';
import { execFile, fork }       from 'node:child_process';
import { mkdtemp, writeFile }   from 'node:fs/promises';
import { tmpdir }               from 'node:os';
import { dirname, join }        from 'node:path';
import { fileURLToPath }        from 'node:url';
import { promisify }            from 'node:util';

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
            'with `--help`',
            async function ()
            {
                const { stdout } =
                await promisify(execFile)
                (
                    process.execPath,
                    [eslintPPath, '--help'],
                    { timeout: this.timeout() },
                );
                assert
                (
                    stdout.endsWith
                    (
                        '--concurrency Int|String        Number of linting threads, auto to ' +
                        'choose automatically, off to disable mulithreading - default: auto\n',
                    ),
                );
            },
        );

        it
        (
            'with `--inspect-config` when the command succeeds',
            async function ()
            {
                const loaderSrc =
                `
                import childProcess                 from 'node:child_process';
                import { syncBuiltinESMExports }    from 'node:module';

                childProcess.spawnSync = (...args) => process.send(args);
                syncBuiltinESMExports();
                `;
                const execArgv = ['--import', `data:text/javascript,${encodeURI(loaderSrc)}`];
                const childProcess =
                fork
                (
                    eslintPPath,
                    ['--inspect-config'],
                    { execArgv, silent: true, timeout: this.timeout() },
                );
                let actualMessage;
                childProcess.once
                ('message', message => { actualMessage = message; });
                const exitCode =
                await new Promise(resolve => { childProcess.once('close', resolve); });
                assert.equal(exitCode, 0);
                assert.deepEqual
                (
                    actualMessage,
                    [
                        'npx',
                        [
                            '@eslint/config-inspector@latest',
                            '--config',
                            join(pkgPath, 'eslint.config.js'),
                            '--basePath',
                            pkgPath,
                        ],
                        { stdio: 'inherit' },
                    ],
                );
            },
        );

        it
        (
            'with `--inspect-config` and `--flag=unstable_ts_config` when the command succeeds',
            async function ()
            {
                const loaderSrc =
                `
                import childProcess                 from 'node:child_process';
                import { syncBuiltinESMExports }    from 'node:module';

                childProcess.spawnSync = (...args) => process.send(args);
                syncBuiltinESMExports();
                `;
                const cwd = join(pkgPath, 'test', 'fixtures', 'ts-config-files', 'ts');
                const execArgv = ['--import', `data:text/javascript,${encodeURI(loaderSrc)}`];
                const childProcess =
                fork
                (
                    eslintPPath,
                    ['--inspect-config', '--flag=unstable_ts_config'],
                    { cwd, execArgv, silent: true, timeout: this.timeout() },
                );
                let actualMessage;
                childProcess.once
                ('message', message => { actualMessage = message; });
                const exitCode =
                await new Promise(resolve => { childProcess.once('close', resolve); });
                assert.equal(exitCode, 0);
                assert.deepEqual
                (
                    actualMessage,
                    [
                        'npx',
                        [
                            '@eslint/config-inspector@latest',
                            '--config',
                            join(cwd, 'eslint.config.ts'),
                            '--basePath',
                            cwd,
                        ],
                        { stdio: 'inherit' },
                    ],
                );
            },
        );

        it
        (
            'with `--inspect-config` when the command fails',
            async function ()
            {
                const loaderSrc =
                `
                import childProcess                 from 'node:child_process';
                import { syncBuiltinESMExports }    from 'node:module';

                childProcess.spawnSync = childProcess.spawnSync = () => ({ error: Error() });
                syncBuiltinESMExports();
                `;
                const execArgv = ['--import', `data:text/javascript,${encodeURI(loaderSrc)}`];
                const childProcess =
                fork
                (
                    eslintPPath,
                    ['--inspect-config'],
                    { execArgv, silent: true, timeout: this.timeout() },
                );
                const exitCode =
                await new Promise(resolve => { childProcess.once('close', resolve); });
                assert.equal(exitCode, 2);
            },
        );

        it
        (
            'when patchESLint fails',
            async function ()
            {
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
                    { timeout: this.timeout() },
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
            async function ()
            {
                const tmpDir = await mkdtemp(join(tmpdir(), 'eslint-p-'));
                const url = new URL('./fixtures/configurations/load-count.mjs', import.meta.url);
                await Promise.all
                (
                    [
                        writeFile(join(tmpDir, '.eslintignore'), ''),
                        writeFile
                        (
                            join(tmpDir, 'eslint.config.mjs'),
                            `export { default } from ${JSON.stringify(url)};`,
                        ),
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
