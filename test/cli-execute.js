/* globals after, afterEach, before, beforeEach, describe, it */

import assert           from 'node:assert/strict';

import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync }
from 'node:fs';

import { tmpdir }       from 'node:os';
import { join }         from 'node:path';
import createCLIExecute from '../lib/create-cli-execute.js';
import eslintDirURL     from '../lib/default-eslint-dir-url.js';
import shell            from 'shelljs';
import sinon            from 'sinon';

/**
 * Returns the path inside of the fixture directory.
 * @param {...string} args file path segments.
 * @returns {string} The path inside the fixture directory.
 * @private
 */
function getFixturePath(...args)
{
    const filepath = join(fixtureDir, ...args);
    return filepath;
}

const [{ ESLint }, { default: log }, { default: RuntimeInfo }, execute] =
await Promise.all
(
    [
        import(`${eslintDirURL}lib/eslint/eslint.js`),
        import(`${eslintDirURL}lib/shared/logging.js`),
        import(`${eslintDirURL}lib/shared/runtime-info.js`),
        createCLIExecute(eslintDirURL),
    ],
);
const fixtureDir = join(realpathSync(tmpdir()), 'eslint/fixtures');

describe
(
    'cli',
    () =>
    {
        // copy into clean area so as not to get "infected" by this project's .eslintrc files
        before
        (
            function ()
            {
                /*
                 * GitHub Actions Windows and macOS runners occasionally exhibit
                 * extremely slow filesystem operations, during which copying fixtures
                 * exceeds the default test timeout, so raise it just for this hook.
                 * Mocha uses `this` to set timeouts on an individual hook level.
                 */
                this.timeout(60 * 1000);
                shell.mkdir('-p', fixtureDir);
                shell.cp('-r', './test/fixtures/.', fixtureDir);
            },
        );

        after
        (() => { shell.rm('-r', fixtureDir); });

        beforeEach
        (
            () =>
            {
                sinon.stub(log, 'info');
                sinon.stub(log, 'error');
            },
        );

        afterEach(() => sinon.restore());

        it
        (
            'should return with exit code 2 if flat config mode is not enabled',
            async () =>
            {
                sinon.define(process.env, 'ESLINT_USE_FLAT_CONFIG', 'false');
                const exitCode = await execute([]);

                assert.equal(log.error.callCount, 1);
                assert.equal(exitCode, 2);
            },
        );

        describe
        (
            'execute()',
            () =>
            {
                it
                (
                    'should return error when text with incorrect quotes is passed as argument',
                    async () =>
                    {
                        const flag = '--no-config-lookup';
                        const configFile = getFixturePath('configurations', 'quotes-error.js');
                        const result =
                        await execute
                        (
                            `${flag} -c ${configFile} --stdin --stdin-filename foo.js`,
                            'var foo = \'bar\';',
                        );

                        assert.strictEqual(result, 1);
                    },
                );

                it
                (
                    'should not print debug info when passed the empty string as text',
                    async () =>
                    {
                        const flag = '--no-config-lookup';
                        const result =
                        await execute
                        (['argv0', 'argv1', '--stdin', flag, '--stdin-filename', 'foo.js'], '');

                        assert.strictEqual(result, 0);
                        assert(log.info.notCalled);
                    },
                );

                it
                (
                    'should exit with console error when passed unsupported arguments',
                    async () =>
                    {
                        const filePath = getFixturePath('files');
                        const result = await execute(`--blah --another ${filePath}`);

                        assert.strictEqual(result, 2);
                    },
                );
            },
        );

        describe
        (
            'when given a config with rules with options and severity level set to error',
            () =>
            {
                const cwd = process.cwd();

                beforeEach
                (() => { process.chdir(getFixturePath()); });

                afterEach
                (() => { process.chdir(cwd); });

                it
                (
                    'should exit with an error status (1)',
                    async () =>
                    {
                        const configPath = getFixturePath('configurations', 'quotes-error.js');
                        const filePath = getFixturePath('single-quoted.js');
                        const code = `--no-ignore --config ${configPath} ${filePath}`;
                        const exitStatus = await execute(code);

                        assert.strictEqual(exitStatus, 1);
                    },
                );
            },
        );

        describe
        (
            'when there is a local config file', () =>
            {
                const cwd = process.cwd();

                beforeEach
                (() => { process.chdir(getFixturePath()); });

                afterEach
                (() => { process.chdir(cwd); });

                it
                (
                    'should load the local config file',
                    async () => { await execute('cli/passing.js --no-ignore'); },
                );

                it
                (
                    'should load the local config file with glob pattern',
                    async () => { await execute('cli/pass*.js --no-ignore'); },
                );
            },
        );

        describe
        (
            'Formatters',
            () =>
            {
                const flag = '--no-config-lookup';

                it
                (
                    'when given a valid built-in formatter name should execute without any errors',
                    async () =>
                    {
                        const filePath = getFixturePath('passing.js');
                        const exit = await execute(`${flag} -f json ${filePath}`);

                        assert.strictEqual(exit, 0);
                    },
                );

                describe
                (
                    'when given a valid built-in formatter name that uses rules meta.',
                    () =>
                    {
                        const cwd = process.cwd();

                        beforeEach
                        (() => { process.chdir(getFixturePath()); });

                        afterEach
                        (() => { process.chdir(cwd); });

                        it
                        (
                            'should execute without any errors',
                            async () =>
                            {
                                const filePath = getFixturePath('passing.js');
                                const exit =
                                await execute
                                (`--no-ignore -f json-with-metadata ${filePath} ${flag}`);

                                assert.strictEqual(exit, 0);

                                /*
                                 * Note: For flat config, rulesMeta only contains meta data for the
                                 * rules that triggered messages in the results. (Flat config uses
                                 * ESLint#getRulesMetaForResults().)
                                 */
                                // Check metadata.
                                const { metadata } = JSON.parse(log.info.args[0][0]);
                                const expectedMetadata =
                                {
                                    cwd:        process.cwd(),
                                    rulesMeta:  { },
                                };

                                assert.deepStrictEqual(metadata, expectedMetadata);
                            },
                        );
                    },
                );

                describe
                (
                    'when the --max-warnings option is passed', () =>
                    {
                        it
                        (
                            'and there are too many warnings should provide ' +
                            '`maxWarningsExceeded` metadata to the formatter',
                            async () =>
                            {
                                const exit =
                                await execute
                                (
                                    '--no-ignore -f json-with-metadata --max-warnings 1 --rule ' +
                                    `'quotes: warn' ${flag}`,
                                    '\'hello\' + \'world\';',
                                );

                                assert.strictEqual(exit, 1);

                                const { metadata } = JSON.parse(log.info.args[0][0]);

                                assert.deepStrictEqual
                                (
                                    metadata.maxWarningsExceeded,
                                    { maxWarnings: 1, foundWarnings: 2 },
                                );
                            },
                        );

                        it
                        (
                            'and warnings do not exceed the limit should omit ' +
                            '`maxWarningsExceeded` metadata from the formatter',
                            async () =>
                            {
                                const exit =
                                await execute
                                (
                                    '--no-ignore -f json-with-metadata --max-warnings 1 --rule ' +
                                    `'quotes: warn' ${flag}`,
                                    '\'hello world\';',
                                );

                                assert.strictEqual(exit, 0);

                                const { metadata } = JSON.parse(log.info.args[0][0]);

                                assert(!('maxWarningsExceeded' in metadata));
                            },
                        );
                    },
                );

                describe
                (
                    'when given an invalid built-in formatter name',
                    () =>
                    {
                        const cwd = process.cwd();

                        beforeEach
                        (() => { process.chdir(getFixturePath()); });

                        afterEach
                        (() => { process.chdir(cwd); });

                        it
                        (
                            'should execute with error',
                            async () =>
                            {
                                const filePath = getFixturePath('passing.js');
                                const exit = await execute(`-f fakeformatter ${filePath}`);

                                assert.strictEqual(exit, 2);
                            },
                        );
                    },
                );

                describe
                (
                    'when given a valid formatter path',
                    () =>
                    {
                        const cwd = process.cwd();

                        beforeEach
                        (() => { process.chdir(getFixturePath()); });

                        afterEach
                        (() => { process.chdir(cwd); });

                        it
                        (
                            'should execute without any errors',
                            async () =>
                            {
                                const formatterPath = getFixturePath('formatters', 'simple.js');
                                const filePath = getFixturePath('passing.js');
                                const exit = await execute(`-f ${formatterPath} ${filePath}`);

                                assert.strictEqual(exit, 0);
                            },
                        );
                    },
                );

                describe
                (
                    'when given an invalid formatter path',
                    () =>
                    {
                        const cwd = process.cwd();

                        beforeEach
                        (() => { process.chdir(getFixturePath()); });

                        afterEach
                        (() => { process.chdir(cwd); });

                        it
                        (
                            'should execute with error',
                            async () =>
                            {
                                const formatterPath =
                                getFixturePath('formatters', 'file-does-not-exist.js');
                                const filePath = getFixturePath('passing.js');
                                const exit =
                                await execute(`--no-ignore -f ${formatterPath} ${filePath}`);

                                assert.strictEqual(exit, 2);
                            },
                        );
                    },
                );

                describe
                (
                    'when given an async formatter path',
                    () =>
                    {
                        const cwd = process.cwd();

                        beforeEach
                        (() => { process.chdir(getFixturePath()); });

                        afterEach
                        (() => { process.chdir(cwd); });

                        it
                        (
                            'should execute without any errors',
                            async () =>
                            {
                                const formatterPath = getFixturePath('formatters', 'async.js');
                                const filePath = getFixturePath('passing.js');
                                const exit = await execute(`-f ${formatterPath} ${filePath}`);

                                assert.strictEqual
                                (log.info.getCall(0).args[0], 'from async formatter');
                                assert.strictEqual(exit, 0);
                            },
                        );
                    },
                );
            },
        );

        describe
        (
            'Exit Codes',
            () =>
            {
                const cwd = process.cwd();

                beforeEach
                (() => { process.chdir(getFixturePath()); });

                afterEach
                (() => { process.chdir(cwd); });

                it
                (
                    'when executing a file with a lint error should exit with error',
                    async () =>
                    {
                        const filePath = getFixturePath('undef.js');
                        const code = `--no-ignore --rule no-undef:2 ${filePath}`;
                        const exit = await execute(code);

                        assert.strictEqual(exit, 1);
                    },
                );

                it
                (
                    'when using --fix-type without --fix or --fix-dry-run should exit with error',
                    async () =>
                    {
                        const filePath = getFixturePath('passing.js');
                        const code = `--fix-type suggestion ${filePath}`;
                        const exit = await execute(code);

                        assert.strictEqual(exit, 2);
                    },
                );

                it
                (
                    'when executing a file with a syntax error should exit with error',
                    async () =>
                    {
                        const filePath = getFixturePath('syntax-error.js');
                        const exit = await execute(`--no-ignore ${filePath}`);

                        assert.strictEqual(exit, 1);
                    },
                );
            },
        );

        describe
        (
            'when calling execute more than once',
            () =>
            {
                const cwd = process.cwd();

                beforeEach
                (() => { process.chdir(getFixturePath()); });

                afterEach
                (() => { process.chdir(cwd); });

                it
                (
                    'should not print the results from previous execution',
                    async () =>
                    {
                        const filePath = getFixturePath('missing-semicolon.js');
                        await execute(`--no-ignore --rule semi:2 ${filePath}`);

                        assert(log.info.called, 'Log should have been called.');

                        log.info.resetHistory();

                        const passingPath = getFixturePath('passing.js');
                        await execute(`--no-ignore --rule semi:2 ${passingPath}`);

                        assert(log.info.notCalled);
                    },
                );
            },
        );

        describe
        (
            'when executing with version flag',
            () =>
            {
                it
                (
                    'should print out current version',
                    async () =>
                    {
                        const exitCode = await execute('-v');

                        assert.equal(exitCode, 0);
                        assert.equal(log.info.callCount, 1);
                        assert.match
                        (
                            log.info.args[0][0],
                            /^eslint-p v\d+\.\d+\.\d+.*\nESLint v\d+\.\d+\.\d+.*$/,
                        );
                    },
                );
            },
        );

        describe
        (
            'when executing with env-info flag',
            () =>
            {
                afterEach
                (() => { sinon.restore(); });

                it
                (
                    'should print out environment information',
                    async () =>
                    {
                        sinon.stub(RuntimeInfo, 'environment').returns('');

                        assert.strictEqual(await execute('--env-info'), 0);
                        assert.strictEqual(log.info.callCount, 1);
                    },
                );

                it
                (
                    'With error condition should print error message and return error code',
                    async () =>
                    {
                        sinon.stub(RuntimeInfo, 'environment').throws('There was an error!');

                        assert.strictEqual(await execute('--env-info'), 2);
                        assert.strictEqual(log.error.callCount, 1);
                    },
                );
            },
        );

        it
        (
            'when executing with help flag should print out help',
            async () =>
            {
                assert.strictEqual(await execute('-h'), 0);
                assert.strictEqual(log.info.callCount, 1);
            },
        );

        it
        (
            'when executing a file with a shebang should execute without error',
            async () =>
            {
                const filePath = getFixturePath('shebang.js');
                const flag = '--no-config-lookup';
                const exit = await execute(`${flag} --no-ignore ${filePath}`);

                assert.strictEqual(exit, 0);
            },
        );

        describe
        (
            'FixtureDir Dependent Tests',
            () =>
            {
                const cwd = process.cwd();

                beforeEach
                (() => { process.chdir(getFixturePath()); });

                afterEach
                (() => { process.chdir(cwd); });

                it
                (
                    'when given a config file and a directory of files should load and execute ' +
                    'without error',
                    async () =>
                    {
                        const configPath = getFixturePath('configurations', 'semi-error.js');
                        const filePath = getFixturePath('formatters');
                        const code = `--no-ignore --config ${configPath} ${filePath}`;
                        const exitStatus = await execute(code);

                        assert.strictEqual(exitStatus, 0);
                    },
                );

                describe
                (
                    'when executing with global flag',
                    () =>
                    {
                        it
                        (
                            'should default defined variables to read-only',
                            async () =>
                            {
                                const filePath = getFixturePath('undef.js');
                                const exit =
                                await execute
                                (
                                    `--global baz,bat --no-ignore --rule no-global-assign:2 ${
                                    filePath}`,
                                );

                                assert(log.info.calledOnce);
                                assert.strictEqual(exit, 1);
                            },
                        );

                        it
                        (
                            'should allow defining writable global variables',
                            async () =>
                            {
                                const filePath = getFixturePath('undef.js');
                                const exit =
                                await execute
                                (`--global baz:false,bat:true --no-ignore ${filePath}`);

                                assert(log.info.notCalled);
                                assert.strictEqual(exit, 0);
                            },
                        );

                        it
                        (
                            'should allow defining variables with multiple flags',
                            async () =>
                            {
                                const filePath = getFixturePath('undef.js');
                                const exit =
                                await execute
                                (`--global baz --global bat:true --no-ignore ${filePath}`);

                                assert(log.info.notCalled);
                                assert.strictEqual(exit, 0);
                            },
                        );
                    },
                );

                it
                (
                    'when supplied with rule flag and severity level set to error should exit ' +
                    'with an error status (2)',
                    async () =>
                    {
                        const filePath = getFixturePath('single-quoted.js');
                        const code = `--no-ignore --rule 'quotes: [2, double]' ${filePath}`;
                        const exitStatus = await execute(code);

                        assert.strictEqual(exitStatus, 1);
                    },
                );

                describe
                (
                    'when the quiet option is enabled',
                    () =>
                    {
                        it
                        (
                            'should only print error',
                            async () =>
                            {
                                const filePath = getFixturePath('single-quoted.js');
                                const cliArgs =
                                '--no-ignore --quiet -f stylish --rule \'quotes: [2, double]\' ' +
                                `--rule 'no-undef: 1' ${filePath}`;
                                await execute(cliArgs);

                                assert(log.info.calledOnce);

                                const [formattedOutput] = log.info.firstCall.args;

                                assert(formattedOutput.includes('(1 error, 0 warnings)'));
                            },
                        );

                        it
                        (
                            'should print nothing if there are no errors',
                            async () =>
                            {
                                const filePath = getFixturePath('single-quoted.js');
                                const cliArgs =
                                '--no-ignore --quiet -f stylish --rule \'quotes: [1, double]\' ' +
                                `--rule 'no-undef: 1' ${filePath}`;
                                await execute(cliArgs);

                                assert(log.info.notCalled);
                            },
                        );

                        it
                        (
                            'should not run rules set to \'warn\'',
                            async () =>
                            {
                                const filePath = getFixturePath('single-quoted.js');
                                const configPath = getFixturePath('eslint.config-rule-throws.js');
                                const cliArgs = `--quiet --config ${configPath}' ${filePath}`;
                                const exit = await execute(cliArgs);

                                assert.strictEqual(exit, 0);
                            },
                        );

                        it
                        (
                            'should run rules set to \'warn\' while maxWarnings is set',
                            async () =>
                            {
                                const filePath = getFixturePath('single-quoted.js');
                                const configPath = getFixturePath('eslint.config-rule-throws.js');
                                const cliArgs =
                                `--quiet --max-warnings=1 --config ${configPath}' ${filePath}`;
                                await assert.rejects
                                (async () => { await execute(cliArgs); });
                            },
                        );
                    },
                );

                describe
                (
                    'no-error-on-unmatched-pattern flag',
                    () =>
                    {
                        it
                        (
                            'when executing without no-error-on-unmatched-pattern flag should ' +
                            'throw an error on unmatched glob pattern',
                            async () =>
                            {
                                const filePath =
                                getFixturePath('unmatched-patterns').replace(/\\/gu, '/');
                                const globPattern = 'unmatched*.js';
                                await assert.rejects
                                (
                                    async () =>
                                    { await execute(`"${filePath}/${globPattern}"`); },
                                    Error
                                    (
                                        `No files matching '${filePath}/${globPattern}' were ` +
                                        'found.',
                                    ),
                                );
                            },
                        );

                        it
                        (
                            'when executing with no-error-on-unmatched-pattern flag should not ' +
                            'throw an error on unmatched node glob syntax patterns',
                            async () =>
                            {
                                const filePath = getFixturePath('unmatched-patterns');
                                const exit =
                                await execute
                                (`--no-error-on-unmatched-pattern "${filePath}/unmatched*.js"`);

                                assert.strictEqual(exit, 0);
                            },
                        );

                        describe
                        (
                            'when executing with no-error-on-unmatched-pattern flag and multiple ' +
                            'patterns',
                            () =>
                            {
                                it
                                (
                                    'should not throw an error on multiple unmatched node glob ' +
                                    'syntax patterns',
                                    async () =>
                                    {
                                        const filePath = getFixturePath('unmatched-patterns/js3');
                                        const exit =
                                        await execute
                                        (
                                            '--no-error-on-unmatched-pattern ' +
                                            `${filePath}/unmatched1*.js ${filePath}/unmatched2*.js`,
                                        );

                                        assert.strictEqual(exit, 0);
                                    },
                                );

                                it
                                (
                                    'should still throw an error on when a matched pattern has ' +
                                    'lint errors',
                                    async () =>
                                    {
                                        const filePath = getFixturePath('unmatched-patterns');
                                        const exit =
                                        await execute
                                        (
                                            '--no-ignore --no-error-on-unmatched-pattern ' +
                                            `${filePath}/unmatched1*.js ${filePath}/failing.js`,
                                        );

                                        assert.strictEqual(exit, 1);
                                    },
                                );
                            },
                        );
                    },
                );

                describe
                (
                    'Parser Options', () =>
                    {
                        describe
                        (
                            'when given parser options', () =>
                            {
                                it
                                (
                                    'should exit with error if parser options are invalid',
                                    async () =>
                                    {
                                        const filePath = getFixturePath('passing.js');
                                        const exit =
                                        await execute
                                        (`--no-ignore --parser-options test111 ${filePath}`);

                                        assert.strictEqual(exit, 2);
                                    },
                                );

                                it
                                (
                                    'should exit with no error if parser is valid',
                                    async () =>
                                    {
                                        const filePath = getFixturePath('passing.js');
                                        const exit =
                                        await execute
                                        (`--no-ignore --parser-options=ecmaVersion:6 ${filePath}`);

                                        assert.strictEqual(exit, 0);
                                    },
                                );

                                it
                                (
                                    'should exit with an error on ecmaVersion 7 feature in ' +
                                    'ecmaVersion 6',
                                    async () =>
                                    {
                                        const filePath = getFixturePath('passing-es7.js');
                                        const exit =
                                        await execute
                                        (`--no-ignore --parser-options=ecmaVersion:6 ${filePath}`);

                                        assert.strictEqual(exit, 1);
                                    },
                                );

                                it
                                (
                                    'should exit with no error on ecmaVersion 7 feature in ' +
                                    'ecmaVersion 7',
                                    async () =>
                                    {
                                        const filePath = getFixturePath('passing-es7.js');
                                        const exit =
                                        await execute
                                        (`--no-ignore --parser-options=ecmaVersion:7 ${filePath}`);

                                        assert.strictEqual(exit, 0);
                                    },
                                );

                                it
                                (
                                    'should exit with no error on ecmaVersion 7 feature with ' +
                                    'config ecmaVersion 6 and command line ecmaVersion 7',
                                    async () =>
                                    {
                                        const configPath =
                                        getFixturePath('configurations', 'es6.js');
                                        const filePath = getFixturePath('passing-es7.js');
                                        const exit =
                                        await execute
                                        (
                                            `--no-ignore --config ${configPath} ` +
                                            `--parser-options=ecmaVersion:7 ${filePath}`,
                                        );

                                        assert.strictEqual(exit, 0);
                                    },
                                );
                            },
                        );
                    },
                );

                describe
                (
                    'when given the max-warnings flag',
                    () =>
                    {
                        let filePath;
                        let configFilePath;

                        before
                        (
                            () =>
                            {
                                filePath = getFixturePath('max-warnings/six-warnings.js');
                                configFilePath = getFixturePath('max-warnings/eslint.config.js');
                            },
                        );

                        it
                        (
                            'should not change exit code if warning count under threshold',
                            async () =>
                            {
                                const exitCode =
                                await execute
                                (`--no-ignore --max-warnings 10 ${filePath} -c ${configFilePath}`);

                                assert.strictEqual(exitCode, 0);
                            },
                        );

                        it
                        (
                            'should exit with exit code 1 if warning count exceeds threshold',
                            async () =>
                            {
                                const exitCode =
                                await execute
                                (`--no-ignore --max-warnings 5 ${filePath} -c ${configFilePath}`);

                                assert.strictEqual(exitCode, 1);
                                assert.ok(log.error.calledOnce);
                                assert
                                (
                                    log.error.getCall(0).args[0].includes
                                    ('ESLint found too many warnings'),
                                );
                            },
                        );

                        it
                        (
                            'should exit with exit code 1 without printing warnings if the quiet ' +
                            'option is enabled and warning count exceeds threshold',
                            async () =>
                            {
                                const exitCode =
                                await execute
                                (
                                    `--no-ignore --quiet --max-warnings 5 ${filePath} -c ${
                                    configFilePath}`,
                                );

                                assert.strictEqual(exitCode, 1);
                                assert.ok(log.error.calledOnce);
                                assert
                                (
                                    log.error.getCall(0).args[0].includes
                                    ('ESLint found too many warnings'),
                                );
                                assert.ok(log.info.notCalled); // didn't print warnings
                            },
                        );

                        it
                        (
                            'should not change exit code if warning count equals threshold',
                            async () =>
                            {
                                const exitCode =
                                await execute
                                (`--no-ignore --max-warnings 6 ${filePath} -c ${configFilePath}`);

                                assert.strictEqual(exitCode, 0);
                            },
                        );

                        it
                        (
                            'should not change exit code if flag is not specified and there are ' +
                            'warnings',
                            async () =>
                            {
                                const exitCode = await execute(`-c ${configFilePath} ${filePath}`);

                                assert.strictEqual(exitCode, 0);
                            },
                        );
                    },
                );

                describe
                (
                    'when given the exit-on-fatal-error flag',
                    () =>
                    {
                        it
                        (
                            'should not change exit code if no fatal errors are reported',
                            async () =>
                            {
                                const filePath =
                                getFixturePath('exit-on-fatal-error', 'no-fatal-error.js');
                                const exitCode =
                                await execute(`--no-ignore --exit-on-fatal-error ${filePath}`);

                                assert.strictEqual(exitCode, 0);
                            },
                        );

                        it
                        (
                            'should exit with exit code 1 if no fatal errors are found, but rule ' +
                            'violations are found',
                            async () =>
                            {
                                const filePath =
                                getFixturePath
                                ('exit-on-fatal-error', 'no-fatal-error-rule-violation.js');
                                const exitCode =
                                await execute(`--no-ignore --exit-on-fatal-error ${filePath}`);

                                assert.strictEqual(exitCode, 1);
                            },
                        );

                        it
                        (
                            'should exit with exit code 2 if fatal error is found',
                            async () =>
                            {
                                const filePath =
                                getFixturePath('exit-on-fatal-error', 'fatal-error.js');
                                const exitCode =
                                await execute(`--no-ignore --exit-on-fatal-error ${filePath}`);

                                assert.strictEqual(exitCode, 2);
                            },
                        );

                        it
                        (
                            'should exit with exit code 2 if fatal error is found in any file',
                            async () =>
                            {
                                const filePath = getFixturePath('exit-on-fatal-error');
                                const exitCode =
                                await execute(`--no-ignore --exit-on-fatal-error ${filePath}`);

                                assert.strictEqual(exitCode, 2);
                            },
                        );
                    },
                );

                describe
                (
                    'Ignores',
                    () =>
                    {
                        it
                        (
                            'when given a directory with eslint excluded files in the directory ' +
                            'should throw an error and not process any files',
                            async () =>
                            {
                                const options =
                                `--config ${getFixturePath('eslint.config-with-ignores.js')}`;
                                const filePath = getFixturePath('cli');
                                const expectedMessage =
                                `All files matched by '${filePath.replace(/\\/gu, '/')}' are ` +
                                'ignored.';
                                await assert.rejects
                                (
                                    async () => { await execute(`${options} ${filePath}`); },
                                    Error(expectedMessage),
                                );
                            },
                        );

                        describe
                        (
                            'when given a file in excluded files list',
                            () =>
                            {
                                it
                                (
                                    'should not process the file',
                                    async () =>
                                    {
                                        const options =
                                        `--config ${
                                        getFixturePath('eslint.config-with-ignores.js')}`;
                                        const filePath = getFixturePath('passing.js');
                                        const exit = await execute(`${options} ${filePath}`);

                                        // a warning about the ignored file
                                        assert(log.info.called);
                                        assert.strictEqual(exit, 0);
                                    },
                                );

                                it
                                (
                                    'should process the file when forced',
                                    async () =>
                                    {
                                        const options =
                                        `--config ${
                                        getFixturePath('eslint.config-with-ignores.js')}`;
                                        const filePath = getFixturePath('passing.js');
                                        const exit =
                                        await execute(`${options} --no-ignore ${filePath}`);

                                        // no warnings
                                        assert(!log.info.called);
                                        assert.strictEqual(exit, 0);
                                    },
                                );

                                it
                                (
                                    'should suppress the warning if --no-warn-ignored is passed',
                                    async () =>
                                    {
                                        const options =
                                        `--config ${
                                        getFixturePath('eslint.config-with-ignores.js')}`;
                                        const filePath = getFixturePath('passing.js');
                                        const exit =
                                        await execute(`${options} --no-warn-ignored ${filePath}`);

                                        assert(!log.info.called);
                                        assert.strictEqual(exit, 0);
                                    },
                                );

                                it
                                (
                                    'should not lint anything when no files are passed if ' +
                                    '--pass-on-no-patterns is passed',
                                    async () =>
                                    {
                                        const exit = await execute('--pass-on-no-patterns');

                                        assert(!log.info.called);
                                        assert.strictEqual(exit, 0);
                                    },
                                );

                                it
                                (
                                    'should suppress the warning if --no-warn-ignored is passed ' +
                                    'and an ignored file is passed via stdin',
                                    async () =>
                                    {
                                        const options =
                                        `--config ${
                                        getFixturePath('eslint.config-with-ignores.js')}`;
                                        const filePath = getFixturePath('passing.js');
                                        const exit =
                                        await execute
                                        (
                                            `${options} --no-warn-ignored --stdin ` +
                                            `--stdin-filename ${filePath}`,
                                            'foo',
                                        );

                                        assert(!log.info.called);
                                        assert.strictEqual(exit, 0);
                                    },
                                );
                            },
                        );

                        describe
                        (
                            'when given a pattern to ignore',
                            () =>
                            {
                                it
                                (
                                    'should not process any files',
                                    async () =>
                                    {
                                        const ignoredFile = getFixturePath('cli/syntax-error.js');
                                        const ignorePathOption = '';
                                        const filePath = getFixturePath('cli/passing.js');
                                        const ignorePattern = 'cli/**';
                                        const exit =
                                        await execute
                                        (
                                            `--ignore-pattern ${ignorePattern} ` +
                                            `${ignorePathOption} ${ignoredFile} ${filePath}`,
                                        );

                                        // warnings about the ignored files
                                        assert(log.info.called);
                                        assert.strictEqual(exit, 0);
                                    },
                                );

                                it
                                (
                                    'should interpret pattern that contains a slash as relative ' +
                                    'to cwd',
                                    async () =>
                                    {
                                        process.chdir('cli/ignore-pattern-relative/subdir');

                                        /*
                                         * The config file is in `cli/ignore-pattern-relative`, so
                                         * this would fail if `subdir/**` ignore pattern is
                                         * interpreted as relative to the config base path.
                                         */
                                        const exit =
                                        await execute('**/*.js --ignore-pattern subdir/**');

                                        assert.strictEqual(exit, 0);

                                        await assert.rejects
                                        (
                                            async () =>
                                            await execute
                                            ('**/*.js --ignore-pattern subsubdir/*.js'),
                                            /All files matched by '\*\*\/\*\.js' are ignored/u,
                                        );
                                    },
                                );

                                it
                                (
                                    'should interpret pattern that doesn\'t contain a slash as ' +
                                    'relative to cwd',
                                    async () =>
                                    {
                                        process.chdir
                                        ('cli/ignore-pattern-relative/subdir/subsubdir');
                                        await assert.rejects
                                        (
                                            async () =>
                                            await execute('**/*.js --ignore-pattern *.js'),
                                            /All files matched by '\*\*\/\*\.js' are ignored/u,
                                        );
                                    },
                                );

                                it
                                (
                                    'should ignore files if the pattern is a path to a directory ' +
                                    '(with trailing slash)',
                                    async () =>
                                    {
                                        const filePath = getFixturePath('cli/syntax-error.js');
                                        const exit =
                                        await execute(`--ignore-pattern cli/ ${filePath}`);

                                        // parsing error causes exit code 1
                                        assert(log.info.called);
                                        assert.strictEqual(exit, 0);
                                    },
                                );

                                it
                                (
                                    'should ignore files if the pattern is a path to a directory ' +
                                    '(without trailing slash)',
                                    async () =>
                                    {
                                        const filePath = getFixturePath('cli/syntax-error.js');
                                        const exit =
                                        await execute(`--ignore-pattern cli ${filePath}`);

                                        // parsing error causes exit code 1
                                        assert(log.info.called);
                                        assert.strictEqual(exit, 0);
                                    },
                                );
                            },
                        );
                    },
                );
            },
        );

        describe
        (
            'when given a parser name',
            () =>
            {
                it
                (
                    'should exit with a fatal error if parser is invalid',
                    async () =>
                    {
                        const filePath = getFixturePath('passing.js');
                        await assert.rejects
                        (
                            async () => await execute(`--no-ignore --parser test111 ${filePath}`),
                            'Cannot find module \'test111\'',
                        );
                    },
                );

                it
                (
                    'should exit with no error if parser is valid',
                    async () =>
                    {
                        const filePath = getFixturePath('passing.js');
                        const flag = '--no-config-lookup';
                        const exit =
                        await execute(`${flag} --no-ignore --parser espree ${filePath}`);

                        assert.strictEqual(exit, 0);
                    },
                );
            },
        );

        describe
        (
            'when supplied with report output file path',
            () =>
            {
                const flag = '--no-config-lookup';
                const outDir = 'test/output';

                afterEach
                (() => { rmSync(outDir, { force: true, recursive: true }); });

                it
                (
                    'should write the file and create dirs if they don\'t exist',
                    async () =>
                    {
                        const filePath = getFixturePath('single-quoted.js');
                        const code =
                        `${flag} --rule 'quotes: [1, double]' --o ${outDir}/eslint-output.txt ${
                        filePath}`;
                        await execute(code);

                        assert
                        (readFileSync(`${outDir}/eslint-output.txt`, 'utf8').includes(filePath));
                        assert(log.info.notCalled);
                    },
                );

                it
                (
                    'should return an error if the path is a directory',
                    async () =>
                    {
                        const filePath = getFixturePath('single-quoted.js');
                        const code =
                        `${flag} --rule 'quotes: [1, double]' --o ${outDir} ${filePath}`;
                        mkdirSync(outDir);
                        const exit = await execute(code);

                        assert.strictEqual(exit, 2);
                        assert(log.info.notCalled);
                        assert(log.error.calledOnce);
                    },
                );

                it
                (
                    'should return an error if the path could not be written to',
                    async () =>
                    {
                        const filePath = getFixturePath('single-quoted.js');
                        const code =
                        `${flag} --rule 'quotes: [1, double]' --o ${outDir}/eslint-output.txt ${
                        filePath}`;
                        writeFileSync(outDir, 'foo');
                        const exit = await execute(code);

                        assert.strictEqual(exit, 2);
                        assert(log.info.notCalled);
                        assert(log.error.calledOnce);
                    },
                );
            },
        );

        describe
        (
            'when passed --no-inline-config',
            () =>
            {
                afterEach
                (() => { sinon.verifyAndRestore(); });

                it
                (
                    'should pass allowInlineConfig:false to ESLint when --no-inline-config is used',
                    async () =>
                    {
                        sinon
                        .mock(ESLint)
                        .expects('fromCLIOptions')
                        .withExactArgs(sinon.match({ inlineConfig: false }))
                        .callThrough();
                        sinon.stub(ESLint.prototype, 'lintParallel').returns
                        (
                            [
                                {
                                    filePath:       './foo.js',
                                    output:         'bar',
                                    messages:
                                    [
                                        {
                                            severity:   2,
                                            message:    'Fake message',
                                        },
                                    ],
                                    errorCount:     1,
                                    warningCount:   0,
                                },
                            ],
                        );
                        sinon
                        .stub(ESLint.prototype, 'loadFormatter')
                        .returns({ format: () => 'done' });
                        sinon.stub(ESLint, 'outputFixes');

                        await execute('--no-inline-config .');
                    },
                );

                it
                (
                    'should not error and allowInlineConfig should be true by default',
                    async () =>
                    {
                        sinon
                        .mock(ESLint)
                        .expects('fromCLIOptions')
                        .withExactArgs(sinon.match({ inlineConfig: true }))
                        .callThrough();
                        sinon.stub(ESLint.prototype, 'lintParallel').returns([]);
                        sinon
                        .stub(ESLint.prototype, 'loadFormatter')
                        .returns({ format: () => 'done' });
                        sinon.stub(ESLint, 'outputFixes');
                        const exitCode = await execute('.');

                        assert.strictEqual(exitCode, 0);
                    },
                );
            },
        );

        describe
        (
            'when passed --fix',
            () =>
            {
                afterEach
                (() => { sinon.verifyAndRestore(); });

                it
                (
                    'should pass fix:true to ESLint when executing on files',
                    async () =>
                    {
                        sinon
                        .mock(ESLint)
                        .expects('fromCLIOptions')
                        .withExactArgs(sinon.match({ fix: true }))
                        .callThrough();
                        sinon.stub(ESLint.prototype, 'lintParallel').returns([]);
                        sinon
                        .stub(ESLint.prototype, 'loadFormatter')
                        .returns({ format: () => 'done' });
                        sinon.stub(ESLint, 'outputFixes');
                        const exitCode = await execute('--fix .');

                        assert.strictEqual(exitCode, 0);
                    },
                );

                it
                (
                    'should rewrite files when in fix mode',
                    async () =>
                    {
                        const report =
                        [
                            {
                                filePath:       './foo.js',
                                output:         'bar',
                                messages:
                                [
                                    {
                                        severity:   2,
                                        message:    'Fake message',
                                    },
                                ],
                                errorCount:     1,
                                warningCount:   0,
                            },
                        ];
                        sinon
                        .mock(ESLint)
                        .expects('fromCLIOptions')
                        .withExactArgs(sinon.match({ fix: true }))
                        .callThrough();
                        sinon.stub(ESLint.prototype, 'lintParallel').returns(report);
                        sinon
                        .stub(ESLint.prototype, 'loadFormatter')
                        .returns({ format: () => 'done' });
                        sinon.mock(ESLint).expects('outputFixes').withExactArgs(report);
                        const exitCode = await execute('--fix .');

                        assert.strictEqual(exitCode, 1);
                    },
                );

                it
                (
                    'should provide fix predicate and rewrite files when in fix mode and quiet ' +
                    'mode',
                    async () =>
                    {
                        const report =
                        [
                            {
                                filePath:       './foo.js',
                                output:         'bar',
                                messages:
                                [
                                    {
                                        severity:   1,
                                        message:    'Fake message',
                                    },
                                ],
                                errorCount:     0,
                                warningCount:   1,
                            },
                        ];
                        sinon
                        .mock(ESLint)
                        .expects('fromCLIOptions')
                        .withExactArgs(sinon.match({ fix: true, quiet: true }))
                        .callThrough();
                        sinon.stub(ESLint.prototype, 'lintParallel').returns(report);
                        sinon
                        .stub(ESLint.prototype, 'loadFormatter')
                        .returns({ format: () => 'done' });
                        sinon.stub(ESLint, 'getErrorResults').returns([]);
                        sinon.mock(ESLint).expects('outputFixes').withExactArgs(report);
                        const exitCode = await execute('--fix --quiet .');

                        assert.strictEqual(exitCode, 0);
                    },
                );

                it
                (
                    'should not call ESLint and return 2 when executing on text',
                    async () =>
                    {
                        sinon
                        .mock(ESLint)
                        .expects('fromCLIOptions')
                        .never()
                        .callThrough();
                        const exitCode = await execute('--fix .', 'foo = bar;');

                        assert.strictEqual(exitCode, 2);
                    },
                );
            },
        );

        describe
        (
            'when passed --fix-dry-run',
            () =>
            {
                afterEach
                (() => { sinon.verifyAndRestore(); });

                it
                (
                    'should pass fix:true to ESLint when executing on files',
                    async () =>
                    {
                        sinon
                        .mock(ESLint)
                        .expects('fromCLIOptions')
                        .withExactArgs(sinon.match({ fixDryRun: true }))
                        .callThrough();
                        sinon.stub(ESLint.prototype, 'lintParallel').returns([]);
                        sinon
                        .stub(ESLint.prototype, 'loadFormatter')
                        .returns({ format: () => 'done' });
                        sinon.mock(ESLint).expects('outputFixes').never();
                        const exitCode = await execute('--fix-dry-run .');

                        assert.strictEqual(exitCode, 0);
                    },
                );

                it
                (
                    'should pass fixTypes to ESLint when --fix-type is passed',
                    async () =>
                    {
                        const expectedESLintOptions =
                        {
                            fixDryRun:  true,
                            fixType:    ['suggestion'],
                        };
                        sinon
                        .mock(ESLint)
                        .expects('fromCLIOptions')
                        .withExactArgs(sinon.match(expectedESLintOptions))
                        .callThrough();
                        sinon.stub(ESLint.prototype, 'lintParallel').returns([]);
                        sinon
                        .stub(ESLint.prototype, 'loadFormatter')
                        .returns({ format: () => 'done' });
                        sinon.stub(ESLint, 'outputFixes');
                        const exitCode = await execute('--fix-dry-run --fix-type suggestion .');

                        assert.strictEqual(exitCode, 0);
                    },
                );

                it
                (
                    'should not rewrite files when in fix-dry-run mode',
                    async () =>
                    {
                        const report =
                        [
                            {
                                filePath:       './foo.js',
                                output:         'bar',
                                messages:
                                [
                                    {
                                        severity:   2,
                                        message:    'Fake message',
                                    },
                                ],
                                errorCount:     1,
                                warningCount:   0,
                            },
                        ];
                        sinon
                        .mock(ESLint)
                        .expects('fromCLIOptions')
                        .withExactArgs(sinon.match({ fixDryRun: true }))
                        .callThrough();
                        sinon.stub(ESLint.prototype, 'lintParallel').returns(report);
                        sinon
                        .stub(ESLint.prototype, 'loadFormatter')
                        .returns({ format: () => 'done' });
                        sinon.mock(ESLint).expects('outputFixes').never();
                        const exitCode = await execute('--fix-dry-run .');

                        assert.strictEqual(exitCode, 1);
                    },
                );

                it
                (
                    'should provide fix predicate when in fix-dry-run mode and quiet mode',
                    async () =>
                    {
                        const report =
                        [
                            {
                                filePath:       './foo.js',
                                output:         'bar',
                                messages:
                                [
                                    {
                                        severity:   1,
                                        message:    'Fake message',
                                    },
                                ],
                                errorCount:     0,
                                warningCount:   1,
                            },
                        ];
                        sinon
                        .mock(ESLint)
                        .expects('fromCLIOptions')
                        .withExactArgs(sinon.match({ fixDryRun: true, quiet: true }))
                        .callThrough();
                        sinon.stub(ESLint.prototype, 'lintParallel').returns(report);
                        sinon
                        .stub(ESLint.prototype, 'loadFormatter')
                        .returns({ format: () => 'done' });
                        sinon.stub(ESLint, 'getErrorResults').returns([]);
                        sinon.mock(ESLint).expects('outputFixes').never();
                        const exitCode = await execute('--fix-dry-run --quiet .');

                        assert.strictEqual(exitCode, 0);
                    },
                );

                it
                (
                    'should allow executing on text',
                    async () =>
                    {
                        const report =
                        [
                            {
                                filePath:     './foo.js',
                                output:       'bar',
                                messages:
                                [
                                    {
                                        severity: 2,
                                        message:  'Fake message',
                                    },
                                ],
                                errorCount:   1,
                                warningCount: 0,
                            },
                        ];
                        sinon
                        .mock(ESLint)
                        .expects('fromCLIOptions')
                        .withExactArgs(sinon.match({ fixDryRun: true }))
                        .callThrough();
                        sinon.stub(ESLint.prototype, 'lintParallel').returns(report);
                        sinon
                        .stub(ESLint.prototype, 'loadFormatter')
                        .returns({ format: () => 'done' });
                        sinon.mock(ESLint).expects('outputFixes').never();
                        const exitCode = await execute('--fix-dry-run .', 'foo = bar;');

                        assert.strictEqual(exitCode, 1);
                    },
                );

                it
                (
                    'should not call ESLint and return 2 when used with --fix',
                    async () =>
                    {
                        sinon
                        .mock(ESLint)
                        .expects('fromCLIOptions')
                        .never()
                        .callThrough();
                        const exitCode = await execute('--fix --fix-dry-run .', 'foo = bar;');

                        assert.strictEqual(exitCode, 2);
                    },
                );
            },
        );

        describe
        (
            'when passing --print-config',
            () =>
            {
                const cwd = process.cwd();

                beforeEach
                (() => { process.chdir(getFixturePath()); });

                afterEach
                (() => { process.chdir(cwd); });

                it
                (
                    'should print out the configuration',
                    async () =>
                    {
                        const filePath = getFixturePath('xxx.js');
                        const exitCode = await execute(`--print-config ${filePath}`);

                        assert(log.info.calledOnce);
                        assert.strictEqual(exitCode, 0);
                    },
                );

                it
                (
                    'should error if any positional file arguments are passed',
                    async () =>
                    {
                        const filePath1 = getFixturePath('files', 'bar.js');
                        const filePath2 = getFixturePath('files', 'foo.js');
                        const exitCode = await execute(`--print-config ${filePath1} ${filePath2}`);

                        assert(log.info.notCalled);
                        assert(log.error.calledOnce);
                        assert.strictEqual(exitCode, 2);
                    },
                );

                it
                (
                    'should error out when executing on text',
                    async () =>
                    {
                        const exitCode = await execute('--print-config=myFile.js', 'foo = bar;');

                        assert(log.info.notCalled);
                        assert(log.error.calledOnce);
                        assert.strictEqual(exitCode, 2);
                    },
                );
            },
        );

        describe
        (
            'when passing --report-unused-disable-directives',
            () =>
            {
                it
                (
                    'errors when --report-unused-disable-directives',
                    async () =>
                    {
                        const exitCode =
                        await execute
                        (
                            '--no-config-lookup --report-unused-disable-directives --rule ' +
                            '"\'no-console\': \'error\'"',
                            'foo(); // eslint-disable-line no-console',
                        );

                        assert.strictEqual
                        (log.error.callCount, 0, 'log.error should not be called');
                        assert.strictEqual(log.info.callCount, 1, 'log.info is called once');
                        assert.ok
                        (
                            log.info.firstCall.args[0].includes
                            (
                                'Unused eslint-disable directive (no problems were reported from ' +
                                '\'no-console\')',
                            ),
                            'has correct message about unused directives',
                        );
                        assert.ok
                        (
                            log.info.firstCall.args[0].includes('1 error and 0 warning'),
                            'has correct error and warning count',
                        );
                        assert.strictEqual(exitCode, 1, 'exit code should be 1');
                    },
                );

                it
                (
                    'errors when --report-unused-disable-directives-severity error',
                    async () =>
                    {
                        const exitCode =
                        await execute
                        (
                            '--no-config-lookup --report-unused-disable-directives-severity ' +
                            'error --rule "\'no-console\': \'error\'"',
                            'foo(); // eslint-disable-line no-console',
                        );

                        assert.strictEqual
                        (log.error.callCount, 0, 'log.error should not be called');
                        assert.strictEqual(log.info.callCount, 1, 'log.info is called once');
                        assert.ok
                        (
                            log.info.firstCall.args[0].includes
                            (
                                'Unused eslint-disable directive (no problems were reported from ' +
                                '\'no-console\')',
                            ),
                            'has correct message about unused directives',
                        );
                        assert.ok
                        (
                            log.info.firstCall.args[0].includes('1 error and 0 warning'),
                            'has correct error and warning count',
                        );
                        assert.strictEqual(exitCode, 1, 'exit code should be 1');
                    },
                );

                it
                (
                    'errors when --report-unused-disable-directives-severity 2',
                    async () =>
                    {
                        const exitCode =
                        await execute
                        (
                            '--no-config-lookup --report-unused-disable-directives-severity 2 ' +
                            '--rule "\'no-console\': \'error\'"',
                            'foo(); // eslint-disable-line no-console',
                        );

                        assert.strictEqual
                        (log.error.callCount, 0, 'log.error should not be called');
                        assert.strictEqual(log.info.callCount, 1, 'log.info is called once');
                        assert.ok
                        (
                            log.info.firstCall.args[0].includes
                            (
                                'Unused eslint-disable directive (no problems were reported from ' +
                                '\'no-console\')',
                            ),
                            'has correct message about unused directives',
                        );
                        assert.ok
                        (
                            log.info.firstCall.args[0].includes('1 error and 0 warning'),
                            'has correct error and warning count',
                        );
                        assert.strictEqual(exitCode, 1, 'exit code should be 1');
                    },
                );

                it
                (
                    'warns when --report-unused-disable-directives-severity warn',
                    async () =>
                    {
                        const exitCode =
                        await execute
                        (
                            '--no-config-lookup --report-unused-disable-directives-severity warn ' +
                            '--rule "\'no-console\': \'error\'""',
                            'foo(); // eslint-disable-line no-console',
                        );

                        assert.strictEqual
                        (log.error.callCount, 0, 'log.error should not be called');
                        assert.strictEqual(log.info.callCount, 1, 'log.info is called once');
                        assert.ok
                        (
                            log.info.firstCall.args[0].includes
                            (
                                'Unused eslint-disable directive ' +
                                '(no problems were reported from \'no-console\')',
                            ),
                            'has correct message about unused directives',
                        );
                        assert.ok
                        (
                            log.info.firstCall.args[0].includes('0 errors and 1 warning'),
                            'has correct error and warning count',
                        );
                        assert.strictEqual(exitCode, 0, 'exit code should be 0');
                    },
                );

                it
                (
                    'warns when --report-unused-disable-directives-severity 1',
                    async () =>
                    {
                        const exitCode =
                        await execute
                        (
                            '--no-config-lookup --report-unused-disable-directives-severity 1 ' +
                            '--rule "\'no-console\': \'error\'"',
                            'foo(); // eslint-disable-line no-console',
                        );

                        assert.strictEqual
                        (log.error.callCount, 0, 'log.error should not be called');
                        assert.strictEqual(log.info.callCount, 1, 'log.info is called once');
                        assert.ok
                        (
                            log.info.firstCall.args[0].includes
                            (
                                'Unused eslint-disable directive (no problems were reported from ' +
                                '\'no-console\')',
                            ),
                            'has correct message about unused directives',
                        );
                        assert.ok
                        (
                            log.info.firstCall.args[0].includes('0 errors and 1 warning'),
                            'has correct error and warning count',
                        );
                        assert.strictEqual(exitCode, 0, 'exit code should be 0');
                    },
                );

                it
                (
                    'does not report when --report-unused-disable-directives-severity off',
                    async () =>
                    {
                        const exitCode =
                        await execute
                        (
                            '--no-config-lookup --report-unused-disable-directives-severity off ' +
                            '--rule "\'no-console\': \'error\'"',
                            'foo(); // eslint-disable-line no-console',
                        );

                        assert.strictEqual
                        (log.error.callCount, 0, 'log.error should not be called');
                        assert.strictEqual(log.info.callCount, 0, 'log.info should not be called');
                        assert.strictEqual(exitCode, 0, 'exit code should be 0');
                    },
                );

                it
                (
                    'does not report when --report-unused-disable-directives-severity 0',
                    async () =>
                    {
                        const exitCode =
                        await execute
                        (
                            '--no-config-lookup --report-unused-disable-directives-severity 0 ' +
                            '--rule "\'no-console\': \'error\'"',
                            'foo(); // eslint-disable-line no-console',
                        );

                        assert.strictEqual
                        (log.error.callCount, 0, 'log.error should not be called');
                        assert.strictEqual(log.info.callCount, 0, 'log.info should not be called');
                        assert.strictEqual(exitCode, 0, 'exit code should be 0');
                    },
                );

                it
                (
                    'fails when passing invalid string for ' +
                    '--report-unused-disable-directives-severity',
                    async () =>
                    {
                        const exitCode =
                        await execute
                        ('--no-config-lookup --report-unused-disable-directives-severity foo');

                        assert.strictEqual(log.info.callCount, 0, 'log.info should not be called');
                        assert.strictEqual
                        (log.error.callCount, 1, 'log.error should be called once');
                        assert.deepStrictEqual
                        (
                            log.error.firstCall.args,
                            [
                                'Option report-unused-disable-directives-severity: \'foo\' not ' +
                                'one of off, warn, error, 0, 1, or 2.\n' +
                                'You\'re using eslint.config.js, some command line flags are no ' +
                                'longer available. Please see ' +
                                'https://eslint.org/docs/latest/use/command-line-interface for ' +
                                'details.',
                            ],
                            'has the right text to log.error',
                        );
                        assert.strictEqual(exitCode, 2, 'exit code should be 2');
                    },
                );

                it
                (
                    'fails when passing both --report-unused-disable-directives and ' +
                    '--report-unused-disable-directives-severity',
                    async () =>
                    {
                        const exitCode =
                        await execute
                        (
                            '--no-config-lookup --report-unused-disable-directives ' +
                            '--report-unused-disable-directives-severity warn',
                        );

                        assert.strictEqual(log.info.callCount, 0, 'log.info should not be called');
                        assert.strictEqual
                        (log.error.callCount, 1, 'log.error should be called once');
                        assert.deepStrictEqual
                        (
                            log.error.firstCall.args,
                            [
                                'The --report-unused-disable-directives option and the ' +
                                '--report-unused-disable-directives-severity option cannot be ' +
                                'used together.',
                            ],
                            'has the right text to log.error',
                        );
                        assert.strictEqual(exitCode, 2, 'exit code should be 2');
                    },
                );
            },
        );
    },
);
