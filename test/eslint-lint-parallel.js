import assert                               from 'node:assert/strict';

import fsPromises, { copyFile, cp, mkdir, readFile, realpath, rm, stat, unlink, utimes, writeFile }
from 'node:fs/promises';

import { platform, tmpdir }                 from 'node:os';

import { basename, dirname, extname, join, relative, resolve }
from 'node:path';

import { setImmediate }                     from 'node:timers/promises';
import { fileURLToPath }                    from 'node:url';
import { setEnvironmentData }               from 'node:worker_threads';
import createImportAs                       from '../lib/create-import-as.js';
import eslintDirURL                         from '../lib/default-eslint-dir-url.js';
import patchESLint                          from '../lib/patch-eslint.js';
import { createCustomTeardown, unIndent }   from './_utils/index.js';
import sinon                                from 'sinon';

async function getESLint()
{
    const { ESLint } = await import('eslint');
    await patchESLint(eslintDirURL, ESLint);
    return ESLint;
}

const ESLint = await getESLint();

const tmpDir = await realpath(tmpdir());
const fixtureDir = join(tmpDir, 'eslint/fixtures');
const originalDir = process.cwd();

async function directoryExists(filename)
{
    const stats = await tryStat(filename);
    return stats ? stats.isDirectory() : false;
}

/**
 * Create the ESLint object by mocking some of the plugins
 * @param {Object} options options for ESLint
 * @returns {ESLint} engine object
 * @private
 */
async function eslintWithPlugins(options)
{
    const engine =
    await ESLint.fromCLIOptions
    (
        {
            ...options,
            plugin:
            [
                'eslint-plugin-example',
                '@eslint/eslint-plugin-example',
                'eslint-plugin-processor',
            ],
            resolvePluginsRelativeTo: getFixturePath('plugins'),
        },
    );
    return engine;
}

async function fileExists(filename)
{
    const stats = await tryStat(filename);
    return stats ? stats.isFile() : false;
}

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

// copy into clean area so as not to get "infected" by this project's .eslintrc files
async function setUpFixtures()
{
    /*
     * GitHub Actions Windows and macOS runners occasionally exhibit
     * extremely slow filesystem operations, during which copying fixtures
     * exceeds the default test timeout, so raise it just for this hook.
     * Mocha uses `this` to set timeouts on an individual hook level.
     */
    this.timeout(60 * 1000);
    await cp('test/fixtures', fixtureDir, { recursive: true });
}

async function tearDownFixtures()
{
    await rm(fixtureDir, { force: true, recursive: true });
}

async function tryStat(filename)
{
    try
    {
        const stats = await stat(filename);
        return stats;
    }
    catch (error)
    {
        if (error.code !== 'ENOENT')
            throw error;
    }
}

function useFixtures()
{
    before(setUpFixtures);

    after(tearDownFixtures);
}

(
    (title, fn) =>
    {
        describe(title, () => fn([]));
        describe
        (
            `${title} with flag unstable_config_lookup_from_file`,
            () => fn(['unstable_config_lookup_from_file']),
        );
    }
)
(
    'lintParallel()',
    flag =>
    {
        let eslint;

        useFixtures();

        it
        (
            'should use correct parser when custom parser is specified',
            async () =>
            {
                const parserURL =
                new URL('./fixtures/configurations/parser/custom.js', import.meta.url);
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        cwd:    originalDir,
                        ignore: false,
                        parser: fileURLToPath(parserURL),
                    },
                );
                const results = await eslint.lintParallel([fileURLToPath(import.meta.url)]);

                assert.equal(results.length, 1);
                assert.equal(results[0].messages.length, 1);
                assert.equal(results[0].messages[0].message, 'Parsing error: Boom!');
                assert.equal(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should report zero messages when given a config file and a valid file',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        cwd:    originalDir,
                        config: 'test/fixtures/simple-valid-project/eslint.config.js',
                    },
                );
                const results =
                await eslint.lintParallel(['test/fixtures/simple-valid-project/**/foo*.js']);

                assert.equal(results.length, 2);
                assert.equal(results[0].messages.length, 0);
                assert.equal(results[1].messages.length, 0);
                assert.equal(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should handle multiple patterns with overlapping files',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        cwd:    originalDir,
                        config: 'test/fixtures/simple-valid-project/eslint.config.js',
                    },
                );
                const results = await eslint.lintParallel
                (
                    [
                        'test/fixtures/simple-valid-project/**/foo*.js',
                        'test/fixtures/simple-valid-project/foo.?s',
                        'test/fixtures/simple-valid-project/{foo,src/foobar}.js',
                    ],
                );

                assert.equal(results.length, 2);
                assert.equal(results[0].messages.length, 0);
                assert.equal(results[1].messages.length, 0);
                assert.equal(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should report zero messages when given a config file and a valid file and espree as ' +
            'parser',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        parserOptions:  { ecmaVersion: 2022 },
                        parser:         'espree',
                    },
                );
                const results = await eslint.lintParallel(['lib/eslint-p.js']);

                assert.equal(results.length, 1);
                assert.equal(results[0].messages.length, 0);
                assert.equal(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should report zero messages when given a config file and a valid file and esprima ' +
            'as parser',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        parser: 'esprima',
                        ignore: false,
                    },
                );
                const results = await eslint.lintParallel(['test/fixtures/passing.js']);

                assert.equal(results.length, 1);
                assert.equal(results[0].messages.length, 0);
                assert.equal(results[0].suppressedMessages.length, 0);
            },
        );

        describe
        (
            'Missing Configuration File',
            () =>
            {
                const workDir = join(tmpDir, 'eslint/no-config');

                // copy into clean area so as not to get "infected" by other config files
                before
                (
                    async () =>
                    {
                        await cp
                        (
                            'test/fixtures/no-config-file',
                            join(workDir, 'no-config-file'),
                            { recursive: true },
                        );
                    },
                );

                after
                (async () => { await rm(workDir, { force: true, recursive: true }); });

                it
                (
                    'should throw if eslint.config.js file is not present',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            workDir,
                                configLookup:   true,
                            },
                        );
                        await assert.rejects
                        (eslint.lintParallel('no-config-file/*.js'), /Could not find config file/u);
                    },
                );

                it
                (
                    'should throw if eslint.config.js file is not present even if overrideConfig ' +
                    'was passed',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            workDir,
                                rule:           { 'no-unused-vars': 2 },
                                configLookup:   true,
                            },
                        );
                        await assert.rejects
                        (eslint.lintParallel('no-config-file/*.js'), /Could not find config file/u);
                    },
                );

                it
                (
                    'should throw if eslint.config.js file is not present even if overrideConfig ' +
                    'was passed and a file path is given',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            workDir,
                                rule:           { 'no-unused-vars': 2 },
                                configLookup:   true,
                            },
                        );
                        await assert.rejects
                        (
                            eslint.lintParallel('no-config-file/foo.js'),
                            /Could not find config file/u,
                        );
                    },
                );

                it
                (
                    'should not throw if eslint.config.js file is not present and ' +
                    'overrideConfigFile is `true`',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd: workDir,
                            },
                        );
                        await eslint.lintParallel('no-config-file/*.js');
                    },
                );

                it
                (
                    'should not throw if eslint.config.js file is not present and ' +
                    'overrideConfigFile is path to a config file',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:    workDir,
                                config: join(fixtureDir, 'configurations/quotes-error.js'),
                            },
                        );
                        await eslint.lintParallel('no-config-file/*.js');
                    },
                );
            },
        );

        it
        (
            'should throw if overrideConfigFile is path to a file that doesn\'t exist',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        cwd:    getFixturePath(),
                        config: 'does-not-exist.js',
                    },
                );
                await assert.rejects(eslint.lintParallel('undef*.js'), { code: 'ENOENT' });
            },
        );

        it
        (
            'should throw an error when given a config file and a valid file and invalid parser',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        overrideConfig: { languageOptions: { parser: 'test11' } },
                    },
                );
                await assert.rejects
                (
                    eslint.lintParallel(['lib/eslint-p.js']),
                    /Expected object with parse\(\) or parseForESLint\(\) method/u,
                );
            },
        );

        describe
        (
            'Overlapping searches',
            () =>
            {
                it
                (
                    'should not lint the same file multiple times when the file path was passed ' +
                    'multiple times',
                    async () =>
                    {
                        const cwd = getFixturePath();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                            },
                        );
                        const results =
                        await eslint.lintParallel
                        (['files/foo.js', 'files/../files/foo.js', 'files/foo.js']);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].filePath, join(cwd, 'files/foo.js'));
                        assert.equal(results[0].messages.length, 0);
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should not lint the same file multiple times when the file path and a ' +
                    'pattern that matches the file were passed',
                    async () =>
                    {
                        const cwd = getFixturePath();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                            },
                        );
                        const results = await eslint.lintParallel(['files/foo.js', 'files/foo*']);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].filePath, join(cwd, 'files/foo.js'));
                        assert.equal(results[0].messages.length, 0);
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should not lint the same file multiple times when multiple patterns that ' +
                    'match the file were passed',
                    async () =>
                    {
                        const cwd = getFixturePath();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                            },
                        );
                        const results = await eslint.lintParallel(['files/f*.js', 'files/foo*']);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].filePath, join(cwd, 'files/foo.js'));
                        assert.equal(results[0].messages.length, 0);
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );
            },
        );

        describe
        (
            'Invalid inputs',
            () =>
            {
                [
                    ['a string with a single space', ' '],
                    ['an array with one empty string', ['']],
                    ['an array with two empty strings', ['', '']],
                    ['undefined', undefined],
                ]
                .forEach
                (
                    ([name, value]) =>
                    {
                        it
                        (
                            `should throw an error when passed ${name}`,
                            async () =>
                            {
                                eslint = await ESLint.fromCLIOptions({ flag });
                                await assert.rejects
                                (
                                    eslint.lintParallel(value),
                                    {
                                        message:
                                        '\'patterns\' must be a non-empty string or an array of ' +
                                        'non-empty strings',
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
            'Normalized inputs', () =>
            {
                [
                    ['an empty string', ''],
                    ['an empty array', []],
                ]
                .forEach
                (
                    ([name, value]) =>
                    {
                        it
                        (
                            `should normalize to '.' when ${name} is passed`,
                            async () =>
                            {
                                eslint =
                                await ESLint.fromCLIOptions
                                (
                                    {
                                        flag,
                                        ignore:         false,
                                        cwd:            getFixturePath('files'),
                                        overrideConfig: { files: ['**/*.js'] },
                                        config:         getFixturePath('eslint.config.js'),
                                    },
                                );
                                const results = await eslint.lintParallel(value);

                                assert.equal(results.length, 2);
                                assert.equal(results[0].filePath, getFixturePath('files/.bar.js'));
                                assert.equal(results[0].messages.length, 0);
                                assert.equal(results[1].filePath, getFixturePath('files/foo.js'));
                                assert.equal(results[1].messages.length, 0);
                                assert.equal(results[0].suppressedMessages.length, 0);
                            },
                        );

                        it
                        (
                            `should return an empty array when ${name} is passed with ` +
                            'passOnNoPatterns: true',
                            async () =>
                            {
                                eslint =
                                await ESLint.fromCLIOptions
                                (
                                    {
                                        flag,
                                        ignore:             false,
                                        cwd:                getFixturePath('files'),
                                        overrideConfig:     { files: ['**/*.js'] },
                                        config:             getFixturePath('eslint.config.js'),
                                        passOnNoPatterns:   true,
                                    },
                                );
                                const results = await eslint.lintParallel(value);

                                assert.equal(results.length, 0);
                            },
                        );
                    },
                );
            },
        );

        it
        (
            'should report zero messages when given a directory with a .js2 file',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        cwd:            join(fixtureDir, '..'),
                        config:         getFixturePath('eslint.config.js'),
                        overrideConfig: { files: ['**/*.js2'] },
                    },
                );
                const results = await eslint.lintParallel([getFixturePath('files/foo.js2')]);

                assert.equal(results.length, 1);
                assert.equal(results[0].messages.length, 0);
                assert.equal(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should report zero messages when given a directory with a .js and a .js2 file',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        ignore:         false,
                        cwd:            getFixturePath('..'),
                        overrideConfig: { files: ['**/*.js', '**/*.js2'] },
                        config:         getFixturePath('eslint.config.js'),
                    },
                );
                const results = await eslint.lintParallel(['fixtures/files/']);

                assert.equal(results.length, 3);
                assert.equal(results[0].messages.length, 0);
                assert.equal(results[1].messages.length, 0);
                assert.equal(results[0].suppressedMessages.length, 0);
            },
        );

        // https://github.com/eslint/eslint/issues/18550
        it
        (
            'should skip files with non-standard extensions when they\'re matched only by a ' +
            '\'*\' files pattern',
            async () =>
            {
                const cwd = getFixturePath('files');
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        cwd,
                        overrideConfig: { files: ['*'] },
                    },
                );
                const results = await eslint.lintParallel(['.']);

                assert.equal(results.length, 2);
                assert
                (
                    results.every(result => /^\.[cm]?js$/u.test(extname(result.filePath))),
                    'File with a non-standard extension was linted',
                );
            },
        );

        // https://github.com/eslint/eslint/issues/16413
        it
        (
            'should find files and report zero messages when given a parent directory with a .js',
            async () =>
            {
                const cwd = getFixturePath('example-app/subdir');
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        ignore:         false,
                        cwd,
                        configLookup:   true,
                    },
                );
                const results = await eslint.lintParallel(['../*.js']);

                assert.equal(results.length, 2);
                assert.equal(results[0].messages.length, 0);
                assert.equal(results[0].suppressedMessages.length, 0);
                assert.equal(results[1].messages.length, 0);
                assert.equal(results[1].suppressedMessages.length, 0);
            },
        );

        // https://github.com/eslint/eslint/issues/16038
        it
        (
            'should allow files patterns with \'..\' inside',
            async () =>
            {
                const cwd = getFixturePath('dots-in-files');
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        ignore: false,
                        cwd,
                    },
                );
                const results = await eslint.lintParallel(['.']);

                assert.equal(results.length, 2);
                assert.equal(results[0].messages.length, 0);
                assert.equal(results[0].filePath, getFixturePath('dots-in-files/a..b.js'));
                assert.equal(results[0].suppressedMessages.length, 0);
            },
        );

        // https://github.com/eslint/eslint/issues/16299
        it
        (
            'should only find files in the subdir1 directory when given a directory name',
            async () =>
            {
                const cwd = getFixturePath('example-app2');
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        ignore: false,
                        cwd,
                    },
                );
                const results = await eslint.lintParallel(['subdir1']);

                assert.equal(results.length, 1);
                assert.equal(results[0].messages.length, 0);
                assert.equal(results[0].filePath, getFixturePath('example-app2/subdir1/a.js'));
                assert.equal(results[0].suppressedMessages.length, 0);
            },
        );

        // https://github.com/eslint/eslint/issues/14742
        it
        (
            'should run',
            async () =>
            {
                const cwd = getFixturePath('{curly-path}', 'server');
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        cwd,
                        configLookup: true,
                    },
                );
                const results = await eslint.lintParallel(['src/**/*.{js,json}']);

                assert.equal(results.length, 1);
                assert.equal(results[0].messages.length, 1);
                assert.equal(results[0].messages[0].ruleId, 'no-console');
                assert.equal(results[0].filePath, getFixturePath('{curly-path}/server/src/two.js'));
                assert.equal(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should work with config file that exports a promise',
            async () =>
            {
                const cwd = getFixturePath('promise-config');
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        cwd,
                        configLookup: true,
                    },
                );
                const results = await eslint.lintParallel(['a*.js']);

                assert.equal(results.length, 1);
                assert.equal(results[0].filePath, getFixturePath('promise-config', 'a.js'));
                assert.equal(results[0].messages.length, 1);
                assert.equal(results[0].messages[0].severity, 2);
                assert.equal(results[0].messages[0].ruleId, 'quotes');
            },
        );

        // https://github.com/eslint/eslint/issues/16265
        describe
        (
            'Dot files in searches',
            () =>
            {
                it
                (
                    'should find dot files in current directory when a . pattern is used',
                    async () =>
                    {
                        const cwd = getFixturePath('dot-files');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                                configLookup: true,
                            },
                        );
                        const results = await eslint.lintParallel(['.']);

                        assert.equal(results.length, 3);
                        assert.equal(results[0].messages.length, 0);
                        assert.equal(results[0].filePath, getFixturePath('dot-files/.a.js'));
                        assert.equal(results[0].suppressedMessages.length, 0);
                        assert.equal(results[1].messages.length, 0);
                        assert.equal(results[1].filePath, getFixturePath('dot-files/.c.js'));
                        assert.equal(results[1].suppressedMessages.length, 0);
                        assert.equal(results[2].messages.length, 0);
                        assert.equal(results[2].filePath, getFixturePath('dot-files/b.js'));
                        assert.equal(results[2].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should find dot files in current directory when a *.js pattern is used',
                    async () =>
                    {
                        const cwd = getFixturePath('dot-files');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                                configLookup: true,
                            },
                        );
                        const results = await eslint.lintParallel(['*.js']);

                        assert.equal(results.length, 3);
                        assert.equal(results[0].messages.length, 0);
                        assert.equal(results[0].filePath, getFixturePath('dot-files/.a.js'));
                        assert.equal(results[0].suppressedMessages.length, 0);
                        assert.equal(results[1].messages.length, 0);
                        assert.equal(results[1].filePath, getFixturePath('dot-files/.c.js'));
                        assert.equal(results[1].suppressedMessages.length, 0);
                        assert.equal(results[2].messages.length, 0);
                        assert.equal(results[2].filePath, getFixturePath('dot-files/b.js'));
                        assert.equal(results[2].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should find dot files in current directory when a .a.js pattern is used',
                    async () =>
                    {
                        const cwd = getFixturePath('dot-files');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                            },
                        );
                        const results = await eslint.lintParallel(['.a.js']);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 0);
                        assert.equal(results[0].filePath, getFixturePath('dot-files/.a.js'));
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );
            },
        );

        // https://github.com/eslint/eslint/issues/16275
        describe
        (
            'Glob patterns without matches',
            () =>
            {
                it
                (
                    'should throw an error for a missing pattern when combined with a found ' +
                    'pattern',
                    async () =>
                    {
                        const cwd = getFixturePath('example-app2');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                ignore: false,
                                cwd,
                            },
                        );
                        await assert.rejects
                        (
                            eslint.lintParallel(['subdir1', 'doesnotexist/*.js']),
                            /No files matching 'doesnotexist\/\*\.js' were found/u,
                        );
                    },
                );

                it
                (
                    'should throw an error for an ignored directory pattern when combined with a ' +
                    'found pattern',
                    async () =>
                    {
                        const cwd = getFixturePath('example-app2');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                                ignorePattern: ['subdir2'],
                            },
                        );
                        await assert.rejects
                        (
                            eslint.lintParallel(['subdir1/*.js', 'subdir2/*.js']),
                            /All files matched by 'subdir2\/\*\.js' are ignored/u,
                        );
                    },
                );

                it
                (
                    'should throw an error for an ignored file pattern when combined with a ' +
                    'found pattern',
                    async () =>
                    {
                        const cwd = getFixturePath('example-app2');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                                ignorePattern: ['subdir2/*.js'],
                            },
                        );
                        await assert.rejects
                        (
                            eslint.lintParallel(['subdir1/*.js', 'subdir2/*.js']),
                            /All files matched by 'subdir2\/\*\.js' are ignored/u,
                        );
                    },
                );

                it
                (
                    'should always throw an error for the first unmatched file pattern',
                    async () =>
                    {
                        const cwd = getFixturePath('example-app2');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                                ignorePattern: ['subdir1/*.js', 'subdir2/*.js'],
                            },
                        );
                        await assert.rejects
                        (
                            eslint.lintParallel(['doesnotexist1/*.js', 'doesnotexist2/*.js']),
                            /No files matching 'doesnotexist1\/\*\.js' were found/u,
                        );
                        await assert.rejects
                        (
                            eslint.lintParallel(['doesnotexist1/*.js', 'subdir1/*.js']),
                            /No files matching 'doesnotexist1\/\*\.js' were found/u,
                        );
                        await assert.rejects
                        (
                            eslint.lintParallel(['subdir1/*.js', 'doesnotexist1/*.js']),
                            /All files matched by 'subdir1\/\*\.js' are ignored/u,
                        );
                        await assert.rejects
                        (
                            eslint.lintParallel(['subdir1/*.js', 'subdir2/*.js']),
                            /All files matched by 'subdir1\/\*\.js' are ignored/u,
                        );
                    },
                );

                it
                (
                    'should not throw an error for an ignored file pattern when ' +
                    'errorOnUnmatchedPattern is false',
                    async () =>
                    {
                        const cwd = getFixturePath('example-app2');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                                errorOnUnmatchedPattern:    false,
                                ignorePattern:              ['subdir2/*.js'],
                            },
                        );
                        const results = await eslint.lintParallel(['subdir2/*.js']);

                        assert.equal(results.length, 0);
                    },
                );

                it
                (
                    'should not throw an error for a non-existing file pattern when ' +
                    'errorOnUnmatchedPattern is false',
                    async () =>
                    {
                        const cwd = getFixturePath('example-app2');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                                errorOnUnmatchedPattern: false,
                            },
                        );
                        const results = await eslint.lintParallel(['doesexist/*.js']);

                        assert.equal(results.length, 0);
                    },
                );
            },
        );

        // https://github.com/eslint/eslint/issues/16260
        describe
        (
            'Globbing based on configs',
            () =>
            {
                it
                (
                    'should report zero messages when given a directory with a .js and config ' +
                    'file specifying a subdirectory',
                    async () =>
                    {
                        const cwd = getFixturePath('shallow-glob');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                ignore:         false,
                                cwd,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['target-dir']);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 0);
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should glob for .jsx file in a subdirectory of the passed-in directory and ' +
                    'not glob for any other patterns',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                ignore: false,
                                overrideConfig:
                                {
                                    files:              ['subdir/**/*.jsx', 'target-dir/*.js'],
                                    languageOptions:    { parserOptions: { jsx: true } },
                                },
                                cwd:    getFixturePath('shallow-glob'),
                            },
                        );
                        const results = await eslint.lintParallel(['subdir/subsubdir']);

                        assert.equal(results.length, 2);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal
                        (
                            results[0].filePath,
                            getFixturePath('shallow-glob/subdir/subsubdir/broken.js'),
                        );
                        assert(results[0].messages[0].fatal, 'Fatal error expected.');
                        assert.equal(results[0].suppressedMessages.length, 0);
                        assert.equal
                        (
                            results[1].filePath,
                            getFixturePath('shallow-glob/subdir/subsubdir/plain.jsx'),
                        );
                        assert.equal(results[1].messages.length, 0);
                        assert.equal(results[1].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should glob for all files in subdir when passed-in on the command line with ' +
                    'a partial matching glob',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                ignore: false,
                                overrideConfig:
                                {
                                    files:              ['s*/subsubdir/*.jsx', 'target-dir/*.js'],
                                    languageOptions:    { parserOptions: { jsx: true } },
                                },
                                cwd:    getFixturePath('shallow-glob'),
                            },
                        );
                        const results = await eslint.lintParallel(['subdir']);

                        assert.equal(results.length, 3);
                        assert.equal(results[0].messages.length, 1);
                        assert(results[0].messages[0].fatal, 'Fatal error expected.');
                        assert.equal(results[0].suppressedMessages.length, 0);
                        assert.equal(results[1].messages.length, 1);
                        assert(results[0].messages[0].fatal, 'Fatal error expected.');
                        assert.equal(results[1].suppressedMessages.length, 0);
                        assert.equal(results[2].messages.length, 0);
                        assert.equal(results[2].suppressedMessages.length, 0);
                    },
                );
            },
        );

        it
        (
            'should report zero messages when given a \'**\' pattern with a .js and a .js2 file',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        ignore:         false,
                        cwd:            join(fixtureDir, '..'),
                        overrideConfig: { files: ['**/*.js', '**/*.js2'] },
                        config:         getFixturePath('eslint.config.js'),
                    },
                );
                const results = await eslint.lintParallel(['fixtures/files/*']);

                assert.equal(results.length, 3);
                assert.equal(results[0].messages.length, 0);
                assert.equal(results[1].messages.length, 0);
                assert.equal(results[2].messages.length, 0);
                assert.equal(results[0].suppressedMessages.length, 0);
                assert.equal(results[1].suppressedMessages.length, 0);
                assert.equal(results[2].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should resolve globs when \'globInputPaths\' option is true',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        ignore:         false,
                        cwd:            getFixturePath('..'),
                        overrideConfig: { files: ['**/*.js', '**/*.js2'] },
                        config:         getFixturePath('eslint.config.js'),
                    },
                );
                const results = await eslint.lintParallel(['fixtures/files/*']);

                assert.equal(results.length, 3);
                assert.equal(results[0].messages.length, 0);
                assert.equal(results[1].messages.length, 0);
                assert.equal(results[2].messages.length, 0);
                assert.equal(results[0].suppressedMessages.length, 0);
                assert.equal(results[1].suppressedMessages.length, 0);
                assert.equal(results[2].suppressedMessages.length, 0);
            },
        );

        // only works on a Windows machine
        if (platform() === 'win32')
        {
            it
            (
                'should resolve globs with Windows slashes when \'globInputPaths\' option is true',
                async () =>
                {
                    eslint =
                    await ESLint.fromCLIOptions
                    (
                        {
                            flag,
                            ignore:         false,
                            cwd:            getFixturePath('..'),
                            overrideConfig: { files: ['**/*.js', '**/*.js2'] },
                            config:         getFixturePath('eslint.config.js'),
                        },
                    );
                    const results = await eslint.lintParallel(['fixtures\\files\\*']);

                    assert.equal(results.length, 3);
                    assert.equal(results[0].messages.length, 0);
                    assert.equal(results[1].messages.length, 0);
                    assert.equal(results[2].messages.length, 0);
                    assert.equal(results[0].suppressedMessages.length, 0);
                    assert.equal(results[1].suppressedMessages.length, 0);
                    assert.equal(results[2].suppressedMessages.length, 0);
                },
            );
        }

        it
        (
            'should not resolve globs when \'globInputPaths\' option is false',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        ignore:         false,
                        cwd:            getFixturePath('..'),
                        overrideConfig: { files: ['**/*.js', '**/*.js2'] },
                        globInputPaths: false,
                    },
                );
                await assert.rejects
                (
                    eslint.lintParallel(['fixtures/files/*']),
                    /No files matching 'fixtures\/files\/\*' were found \(glob was disabled\)\./u,
                );
            },
        );

        describe
        (
            'Ignoring Files',
            () =>
            {
                it
                (
                    'should report on a file in the node_modules folder passed explicitly, even ' +
                    'if ignored by default',
                    async () =>
                    {
                        const cwd = getFixturePath('cli-engine');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                            },
                        );
                        const results = await eslint.lintParallel(['node_modules/foo.js']);
                        const expectedMsg =
                        'File ignored by default because it is located under the node_modules ' +
                        'directory. Use ignore pattern "!**/node_modules/" to disable file ' +
                        'ignore settings or use "--no-warn-ignored" to suppress this warning.';

                        assert.equal(results.length, 1);
                        assert.equal(results[0].errorCount, 0);
                        assert.equal(results[0].warningCount, 1);
                        assert.equal(results[0].fatalErrorCount, 0);
                        assert.equal(results[0].fixableErrorCount, 0);
                        assert.equal(results[0].fixableWarningCount, 0);
                        assert.equal(results[0].messages[0].severity, 1);
                        assert.equal(results[0].messages[0].message, expectedMsg);
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should report on a file in a node_modules subfolder passed explicitly, even ' +
                    'if ignored by default',
                    async () =>
                    {
                        const cwd = getFixturePath('cli-engine');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                            },
                        );
                        const results =
                        await eslint.lintParallel
                        (['nested_node_modules/subdir/node_modules/text.js']);
                        const expectedMsg =
                        'File ignored by default because it is located under the node_modules ' +
                        'directory. Use ignore pattern "!**/node_modules/" to disable file ' +
                        'ignore settings or use "--no-warn-ignored" to suppress this warning.';

                        assert.equal(results.length, 1);
                        assert.equal(results[0].errorCount, 0);
                        assert.equal(results[0].warningCount, 1);
                        assert.equal(results[0].fatalErrorCount, 0);
                        assert.equal(results[0].fixableErrorCount, 0);
                        assert.equal(results[0].fixableWarningCount, 0);
                        assert.equal(results[0].messages[0].severity, 1);
                        assert.equal(results[0].messages[0].message, expectedMsg);
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should report on an ignored file with "node_modules" in its name',
                    async () =>
                    {
                        const cwd = getFixturePath('cli-engine');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                                ignorePattern: ['*.js'],
                            },
                        );
                        const results = await eslint.lintParallel(['node_modules_cleaner.js']);
                        const expectedMsg =
                        'File ignored because of a matching ignore pattern. Use "--no-ignore" to ' +
                        'disable file ignore settings or use "--no-warn-ignored" to suppress ' +
                        'this warning.';

                        assert.equal(results.length, 1);
                        assert.equal(results[0].errorCount, 0);
                        assert.equal(results[0].warningCount, 1);
                        assert.equal(results[0].fatalErrorCount, 0);
                        assert.equal(results[0].fixableErrorCount, 0);
                        assert.equal(results[0].fixableWarningCount, 0);
                        assert.equal(results[0].messages[0].severity, 1);
                        assert.equal(results[0].messages[0].message, expectedMsg);
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should suppress the warning when a file in the node_modules folder passed ' +
                    'explicitly and warnIgnored is false',
                    async () =>
                    {
                        const cwd = getFixturePath('cli-engine');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                                warnIgnored: false,
                            },
                        );
                        const results = await eslint.lintParallel(['node_modules/foo.js']);

                        assert.equal(results.length, 0);
                    },
                );

                it
                (
                    'should report on globs with explicit inclusion of dotfiles',
                    async () =>
                    {
                        const cwd = getFixturePath('cli-engine');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                                rule: { quotes: [2, 'single'] },
                            },
                        );
                        const results = await eslint.lintParallel(['hidden/.hiddenfolder/*.js']);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].errorCount, 1);
                        assert.equal(results[0].warningCount, 0);
                        assert.equal(results[0].fatalErrorCount, 0);
                        assert.equal(results[0].fixableErrorCount, 1);
                        assert.equal(results[0].fixableWarningCount, 0);
                    },
                );

                it
                (
                    'should ignore node_modules files when using ignore file',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd: getFixturePath('cli-engine'),
                            },
                        );
                        await assert.rejects
                        (
                            eslint.lintParallel(['node_modules']),
                            /All files matched by 'node_modules' are ignored\./u,
                        );
                    },
                );

                // https://github.com/eslint/eslint/issues/5547
                it
                (
                    'should ignore node_modules files even with ignore: false',
                    async () =>
                    {
                        const cwd = getFixturePath('cli-engine');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                                ignore: false,
                            },
                        );
                        await assert.rejects
                        (
                            eslint.lintParallel(['node_modules']),
                            /All files matched by 'node_modules' are ignored\./u,
                        );
                    },
                );

                it
                (
                    'should throw an error when all given files are ignored',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                config: getFixturePath('eslint.config-with-ignores.js'),
                            },
                        );
                        await assert.rejects
                        (
                            eslint.lintParallel(['test/fixtures/cli-engine/']),
                            /All files matched by 'test\/fixtures\/cli-engine\/' are ignored\./u,
                        );
                    },
                );

                it
                (
                    'should throw an error when all given files are ignored even with a `./` ' +
                    'prefix',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                config: getFixturePath('eslint.config-with-ignores.js'),
                            },
                        );
                        const expectedRegExp =
                        /All files matched by '\.\/test\/fixtures\/cli-engine\/' are ignored\./u;
                        await assert.rejects
                        (eslint.lintParallel(['./test/fixtures/cli-engine/']), expectedRegExp);
                    },
                );

                // https://github.com/eslint/eslint/issues/3788
                it
                (
                    'should ignore one-level down node_modules by default',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                rule:   { quotes: [2, 'double'] },
                                cwd:    getFixturePath('cli-engine', 'nested_node_modules'),
                            },
                        );
                        const results = await eslint.lintParallel(['.']);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].errorCount, 0);
                        assert.equal(results[0].warningCount, 0);
                        assert.equal(results[0].fatalErrorCount, 0);
                        assert.equal(results[0].fixableErrorCount, 0);
                        assert.equal(results[0].fixableWarningCount, 0);
                    },
                );

                // https://github.com/eslint/eslint/issues/3812
                it
                (
                    'should ignore all files and throw an error when **/fixtures/** is in ' +
                    '`ignores` in the config file',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                config:
                                getFixturePath('cli-engine/eslint.config-with-ignores2.js'),
                                rule: { quotes: [2, 'double'] },
                            },
                        );
                        const expectedRegExp =
                        /All files matched by '\.\/test\/fixtures\/cli-engine\/' are ignored\./u;
                        await assert.rejects
                        (eslint.lintParallel(['./test/fixtures/cli-engine/']), expectedRegExp);
                    },
                );

                it
                (
                    'should throw an error when all given files are ignored via ignorePatterns',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                ignorePattern: ['test/fixtures/single-quoted.js'],
                            },
                        );
                        await assert.rejects
                        (
                            eslint.lintParallel(['test/fixtures/*-quoted.js']),
                            /All files matched by 'test\/fixtures\/\*-quoted\.js' are ignored\./u,
                        );
                    },
                );

                it
                (
                    'should not throw an error when ignorePatterns is an empty array',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                ignorePattern: [],
                            },
                        );
                        await assert.doesNotReject
                        (async () => { await eslint.lintParallel(['*.js']); });
                    },
                );

                it
                (
                    'should return a warning when an explicitly given file is ignored',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                config: 'eslint.config-with-ignores.js',
                                cwd:    getFixturePath(),
                            },
                        );
                        const filePath = getFixturePath('passing.js');
                        const results = await eslint.lintParallel([filePath]);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].filePath, filePath);
                        assert.equal(results[0].messages[0].severity, 1);
                        assert.equal
                        (
                            results[0].messages[0].message,
                            'File ignored because of a matching ignore pattern. Use ' +
                            '"--no-ignore" to disable file ignore settings or use ' +
                            '"--no-warn-ignored" to suppress this warning.',
                        );
                        assert.equal(results[0].errorCount, 0);
                        assert.equal(results[0].warningCount, 1);
                        assert.equal(results[0].fatalErrorCount, 0);
                        assert.equal(results[0].fixableErrorCount, 0);
                        assert.equal(results[0].fixableWarningCount, 0);
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should return a warning when an explicitly given file has no matching config',
                    async () =>
                    {
                        const cwd = getFixturePath();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                            },
                        );
                        const filePath = getFixturePath('files', 'foo.js2');
                        const results = await eslint.lintParallel([filePath]);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].filePath, filePath);
                        assert.equal(results[0].messages[0].severity, 1);
                        assert.equal
                        (
                            results[0].messages[0].message,
                            'File ignored because no matching configuration was supplied.',
                        );
                        assert.equal(results[0].errorCount, 0);
                        assert.equal(results[0].warningCount, 1);
                        assert.equal(results[0].fatalErrorCount, 0);
                        assert.equal(results[0].fixableErrorCount, 0);
                        assert.equal(results[0].fixableWarningCount, 0);
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should return a warning when an explicitly given file is outside the base ' +
                    'path',
                    async () =>
                    {
                        const cwd = getFixturePath('files');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                            },
                        );
                        const filePath = getFixturePath('passing.js');
                        const results = await eslint.lintParallel([filePath]);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].filePath, filePath);
                        assert.equal(results[0].messages[0].severity, 1);
                        assert.equal
                        (
                            results[0].messages[0].message,
                            'File ignored because outside of base path.',
                        );
                        assert.equal(results[0].errorCount, 0);
                        assert.equal(results[0].warningCount, 1);
                        assert.equal(results[0].fatalErrorCount, 0);
                        assert.equal(results[0].fixableErrorCount, 0);
                        assert.equal(results[0].fixableWarningCount, 0);
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should suppress the warning when an explicitly given file is ignored and ' +
                    'warnIgnored is false',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                config:         'eslint.config-with-ignores.js',
                                cwd:            getFixturePath(),
                                warnIgnored:    false,
                            },
                        );
                        const filePath = getFixturePath('passing.js');
                        const results = await eslint.lintParallel([filePath]);

                        assert.equal(results.length, 0);
                    },
                );

                it
                (
                    'should return a warning about matching ignore patterns when an explicitly ' +
                    'given dotfile is ignored',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                config: 'eslint.config-with-ignores.js',
                                cwd:    getFixturePath(),
                            },
                        );
                        const filePath = getFixturePath('dot-files/.a.js');
                        const results = await eslint.lintParallel([filePath]);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].filePath, filePath);
                        assert.equal(results[0].messages[0].severity, 1);
                        assert.equal
                        (
                            results[0].messages[0].message,
                            'File ignored because of a matching ignore pattern. Use ' +
                            '"--no-ignore" to disable file ignore settings or use ' +
                            '"--no-warn-ignored" to suppress this warning.',
                        );
                        assert.equal(results[0].errorCount, 0);
                        assert.equal(results[0].warningCount, 1);
                        assert.equal(results[0].fatalErrorCount, 0);
                        assert.equal(results[0].fixableErrorCount, 0);
                        assert.equal(results[0].fixableWarningCount, 0);
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should return two messages when given a file in excluded files list while ' +
                    'ignore is off',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:    getFixturePath(),
                                ignore: false,
                                config: getFixturePath('eslint.config-with-ignores.js'),
                                rule:   { 'no-undef': 2 },
                            },
                        );
                        const filePath = getFixturePath('undef.js');
                        const results = await eslint.lintParallel([filePath]);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].filePath, filePath);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[1].ruleId, 'no-undef');
                        assert.equal(results[0].messages[1].severity, 2);
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                // https://github.com/eslint/eslint/issues/16300
                it
                (
                    'should process ignore patterns relative to basePath not cwd',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            getFixturePath('ignores-relative/subdir'),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['**/*.js']);

                        assert.equal(results.length, 1);
                        assert.equal
                        (results[0].filePath, getFixturePath('ignores-relative/subdir/a.js'));
                    },
                );

                // https://github.com/eslint/eslint/issues/16354
                it
                (
                    'should skip subdirectory files when ignore pattern matches deep subdirectory',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            getFixturePath('ignores-directory'),
                                configLookup:   true,
                            },
                        );
                        await assert.rejects
                        (
                            eslint.lintParallel(['subdir/**']),
                            /All files matched by 'subdir\/\*\*' are ignored\./u,
                        );
                        await assert.rejects
                        (
                            eslint.lintParallel(['subdir/subsubdir/**']),
                            /All files matched by 'subdir\/subsubdir\/\*\*' are ignored\./u,
                        );
                        const results = await eslint.lintParallel(['subdir/subsubdir/a.js']);
                        assert.equal(results.length, 1);
                        assert.equal
                        (
                            results[0].filePath,
                            getFixturePath('ignores-directory/subdir/subsubdir/a.js'),
                        );
                        assert.equal(results[0].warningCount, 1);
                        assert
                        (
                            results[0].messages[0].message.startsWith('File ignored'),
                            'Should contain file ignored warning',
                        );
                    },
                );

                // https://github.com/eslint/eslint/issues/16414
                it
                (
                    'should skip subdirectory files when ignore pattern matches subdirectory',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            getFixturePath('ignores-subdirectory'),
                                configLookup:   true,
                            },
                        );
                        await assert.rejects
                        (
                            eslint.lintParallel(['subdir/**/*.js']),
                            /All files matched by 'subdir\/\*\*\/\*\.js' are ignored\./u,
                        );
                        const results = await eslint.lintParallel(['subdir/subsubdir/a.js']);
                        assert.equal(results.length, 1);
                        assert.equal
                        (
                            results[0].filePath,
                            getFixturePath('ignores-subdirectory/subdir/subsubdir/a.js'),
                        );
                        assert.equal(results[0].warningCount, 1);
                        assert
                        (
                            results[0].messages[0].message.startsWith('File ignored'),
                            'Should contain file ignored warning',
                        );

                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            getFixturePath('ignores-subdirectory/subdir'),
                                configLookup:   true,
                            },
                        );
                        await assert.rejects
                        (
                            eslint.lintParallel(['subsubdir/**/*.js']),
                            /All files matched by 'subsubdir\/\*\*\/\*\.js' are ignored\./u,
                        );
                    },
                );

                // https://github.com/eslint/eslint/issues/16340
                it
                (
                    'should lint files even when cwd directory name matches ignores pattern',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            getFixturePath('ignores-self'),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['*.js']);

                        assert.equal(results.length, 1);
                        assert.equal
                        (results[0].filePath, getFixturePath('ignores-self/eslint.config.js'));
                        assert.equal(results[0].errorCount, 0);
                        assert.equal(results[0].warningCount, 0);
                    },
                );

                // https://github.com/eslint/eslint/issues/16416
                it
                (
                    'should allow reignoring of previously ignored files',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd: getFixturePath('ignores-relative'),
                                ignorePattern:
                                [
                                    '*.js',
                                    '!a*.js',
                                    'a.js',
                                ],
                            },
                        );
                        const results = await eslint.lintParallel(['a.js']);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].errorCount, 0);
                        assert.equal(results[0].warningCount, 1);
                        assert.equal(results[0].filePath, getFixturePath('ignores-relative/a.js'));
                    },
                );

                // https://github.com/eslint/eslint/issues/16415
                it
                (
                    'should allow directories to be unignored',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd: getFixturePath('ignores-directory'),
                                ignorePattern:
                                [
                                    'subdir/*',
                                    '!subdir/subsubdir',
                                ],
                            },
                        );
                        const results = await eslint.lintParallel(['subdir/**/*.js']);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].errorCount, 0);
                        assert.equal(results[0].warningCount, 0);
                        assert.equal
                        (
                            results[0].filePath,
                            getFixturePath('ignores-directory/subdir/subsubdir/a.js'),
                        );
                    },
                );

                // https://github.com/eslint/eslint/issues/17964#issuecomment-1879840650
                it
                (
                    'should allow directories to be unignored without also unignoring all files ' +
                    'in them',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd: getFixturePath('ignores-directory-deep'),
                                ignorePattern:
                                [
                                    // ignore all files and directories
                                    'tests/format/**/*',
                                    // unignore all directories
                                    '!tests/format/**/*/',
                                    // unignore only specific files
                                    '!tests/format/**/jsfmt.spec.js',
                                ],
                            },
                        );
                        const results = await eslint.lintParallel(['.']);

                        assert.equal(results.length, 2);
                        assert.equal(results[0].errorCount, 0);
                        assert.equal(results[0].warningCount, 0);
                        assert.equal
                        (
                            results[0].filePath,
                            getFixturePath('ignores-directory-deep/tests/format/jsfmt.spec.js'),
                        );
                        assert.equal(results[1].errorCount, 0);
                        assert.equal(results[1].warningCount, 0);
                        assert.equal
                        (
                            results[1].filePath,
                            getFixturePath
                            ('ignores-directory-deep/tests/format/subdir/jsfmt.spec.js'),
                        );
                    },
                );

                it
                (
                    'should allow only subdirectories to be ignored by a pattern ending with \'/\'',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            getFixturePath('ignores-directory-deep'),
                                ignorePattern:  ['tests/format/*/'],
                            },
                        );
                        const results = await eslint.lintParallel(['.']);

                        assert.equal(results.length, 2);
                        assert.equal(results[0].errorCount, 0);
                        assert.equal(results[0].warningCount, 0);
                        assert.equal
                        (
                            results[0].filePath,
                            getFixturePath('ignores-directory-deep/tests/format/foo.js'),
                        );
                        assert.equal(results[1].errorCount, 0);
                        assert.equal(results[1].warningCount, 0);
                        assert.equal
                        (
                            results[1].filePath,
                            getFixturePath('ignores-directory-deep/tests/format/jsfmt.spec.js'),
                        );
                    },
                );

                it
                (
                    'should allow only contents of a directory but not the directory itself to ' +
                    'be ignored by a pattern ending with \'**/*\'',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd: getFixturePath('ignores-directory-deep'),
                                ignorePattern:
                                [
                                    'tests/format/**/*',
                                    '!tests/format/jsfmt.spec.js',
                                ],
                            },
                        );
                        const results = await eslint.lintParallel(['.']);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].errorCount, 0);
                        assert.equal(results[0].warningCount, 0);
                        assert.equal
                        (
                            results[0].filePath,
                            getFixturePath('ignores-directory-deep/tests/format/jsfmt.spec.js'),
                        );
                    },
                );

                it
                (
                    'should skip ignored files in an unignored directory',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd: getFixturePath('ignores-directory-deep'),
                                ignorePattern:
                                [
                                    // ignore 'tests/format/' and all its contents
                                    'tests/format/**',
                                    // unignore 'tests/format/', but its contents is still ignored
                                    '!tests/format/',
                                ],
                            },
                        );
                        await assert.rejects
                        (eslint.lintParallel(['.']), /All files matched by '.' are ignored/u);
                    },
                );

                it
                (
                    'should skip files in an ignored directory even if they are matched by a ' +
                    'negated pattern',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd: getFixturePath('ignores-directory-deep'),
                                ignorePattern:
                                [
                                    // ignore 'tests/format/' and all its contents
                                    'tests/format/**',
                                    // this patterns match some or all of its contents, but
                                    // 'tests/format/' is still ignored
                                    '!tests/format/jsfmt.spec.js',
                                    '!tests/format/**/jsfmt.spec.js',
                                    '!tests/format/*',
                                    '!tests/format/**/*',
                                ],
                            },
                        );
                        await assert.rejects
                        (eslint.lintParallel(['.']), /All files matched by '.' are ignored/u);
                    },
                );

                // https://github.com/eslint/eslint/issues/18597
                it
                (
                    'should skip files ignored by a pattern with escape character \'\\\'',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            getFixturePath(),
                                // ignore file named `{a,b}.js`, not files named `a.js` or `b.js`
                                ignorePattern:  ['curly-files/\\{a,b}.js'],
                                rule:           { 'no-undef': 'warn' },
                            },
                        );
                        const results = await eslint.lintParallel(['curly-files']);

                        assert.equal(results.length, 2);
                        assert.equal(results[0].filePath, getFixturePath('curly-files', 'a.js'));
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 1);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                        assert.equal(results[0].messages[0].messageId, 'undef');
                        assert.match(results[0].messages[0].message, /'bar'/u);
                        assert.equal(results[1].filePath, getFixturePath('curly-files', 'b.js'));
                        assert.equal(results[1].messages.length, 1);
                        assert.equal(results[1].messages[0].severity, 1);
                        assert.equal(results[1].messages[0].ruleId, 'no-undef');
                        assert.equal(results[1].messages[0].messageId, 'undef');
                        assert.match(results[1].messages[0].message, /'baz'/u);
                    },
                );

                // https://github.com/eslint/eslint/issues/18706
                it
                (
                    'should disregard ignore pattern \'/\'',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:                        getFixturePath('ignores-relative'),
                                ignorePattern:              ['/'],
                                plugin:                     ['no-program'],
                                resolvePluginsRelativeTo:   getFixturePath('plugins'),
                                rule:                       { 'no-program/no-program': 'warn' },
                            },
                        );
                        const results = await eslint.lintParallel(['**/a.js']);

                        assert.equal(results.length, 2);
                        assert.equal
                        (results[0].filePath, getFixturePath('ignores-relative', 'a.js'));
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 1);
                        assert.equal(results[0].messages[0].ruleId, 'no-program/no-program');
                        assert.equal(results[0].messages[0].message, 'Program is disallowed.');
                        assert.equal
                        (results[1].filePath, getFixturePath('ignores-relative', 'subdir', 'a.js'));
                        assert.equal(results[1].messages.length, 1);
                        assert.equal(results[1].messages[0].severity, 1);
                        assert.equal(results[1].messages[0].ruleId, 'no-program/no-program');
                        assert.equal(results[1].messages[0].message, 'Program is disallowed.');
                    },
                );

                it
                (
                    'should not skip an unignored file in base path when all files are initially ' +
                    'ignored by \'**\'',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:                        getFixturePath('ignores-relative'),
                                ignorePattern:              ['**', '!a.js'],
                                plugin:                     ['no-program'],
                                resolvePluginsRelativeTo:   getFixturePath('plugins'),
                                rule:                       { 'no-program/no-program': 'warn' },
                            },
                        );
                        const results = await eslint.lintParallel(['**/a.js']);

                        assert.equal(results.length, 1);
                        assert.equal
                        (results[0].filePath, getFixturePath('ignores-relative', 'a.js'));
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 1);
                        assert.equal(results[0].messages[0].ruleId, 'no-program/no-program');
                        assert.equal(results[0].messages[0].message, 'Program is disallowed.');
                    },
                );
            },
        );

        it
        (
            'should report zero messages when given a pattern with a .js and a .js2 file',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        overrideConfig: { files: ['**/*.js', '**/*.js2'] },
                        ignore:         false,
                        cwd:            join(fixtureDir, '..'),
                    },
                );
                const results = await eslint.lintParallel(['fixtures/files/*.?s*']);

                assert.equal(results.length, 3);
                assert.equal(results[0].messages.length, 0);
                assert.equal(results[0].suppressedMessages.length, 0);
                assert.equal(results[1].messages.length, 0);
                assert.equal(results[1].suppressedMessages.length, 0);
                assert.equal(results[2].messages.length, 0);
                assert.equal(results[2].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should return one error message when given a config with rules with options and ' +
            'severity level set to error',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        cwd:    getFixturePath(),
                        rule:   { quotes: ['error', 'double'] },
                        ignore: false,
                    },
                );
                const results = await eslint.lintParallel([getFixturePath('single-quoted.js')]);

                assert.equal(results.length, 1);
                assert.equal(results[0].messages.length, 1);
                assert.equal(results[0].messages[0].ruleId, 'quotes');
                assert.equal(results[0].messages[0].severity, 2);
                assert.equal(results[0].errorCount, 1);
                assert.equal(results[0].warningCount, 0);
                assert.equal(results[0].fatalErrorCount, 0);
                assert.equal(results[0].fixableErrorCount, 1);
                assert.equal(results[0].fixableWarningCount, 0);
                assert.equal(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should return 5 results when given a config and a directory of 5 valid files',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        cwd: join(fixtureDir, '..'),
                        rule:
                        {
                            semi:   1,
                            strict: 0,
                        },
                    },
                );

                const formattersDir = getFixturePath('formatters');
                const results = await eslint.lintParallel([formattersDir]);

                assert.equal(results.length, 5);
                assert.equal(relative(formattersDir, results[0].filePath), 'async.js');
                assert.equal(results[0].errorCount, 0);
                assert.equal(results[0].warningCount, 0);
                assert.equal(results[0].fatalErrorCount, 0);
                assert.equal(results[0].fixableErrorCount, 0);
                assert.equal(results[0].fixableWarningCount, 0);
                assert.equal(results[0].messages.length, 0);
                assert.equal(results[0].suppressedMessages.length, 0);
                assert.equal(relative(formattersDir, results[1].filePath), 'broken.js');
                assert.equal(results[1].errorCount, 0);
                assert.equal(results[1].warningCount, 0);
                assert.equal(results[1].fatalErrorCount, 0);
                assert.equal(results[1].fixableErrorCount, 0);
                assert.equal(results[1].fixableWarningCount, 0);
                assert.equal(results[1].messages.length, 0);
                assert.equal(results[1].suppressedMessages.length, 0);
                assert.equal(relative(formattersDir, results[2].filePath), 'cwd.js');
                assert.equal(results[2].errorCount, 0);
                assert.equal(results[2].warningCount, 0);
                assert.equal(results[2].fatalErrorCount, 0);
                assert.equal(results[2].fixableErrorCount, 0);
                assert.equal(results[2].fixableWarningCount, 0);
                assert.equal(results[2].messages.length, 0);
                assert.equal(results[2].suppressedMessages.length, 0);
                assert.equal(relative(formattersDir, results[3].filePath), 'simple.js');
                assert.equal(results[3].errorCount, 0);
                assert.equal(results[3].warningCount, 0);
                assert.equal(results[3].fatalErrorCount, 0);
                assert.equal(results[3].fixableErrorCount, 0);
                assert.equal(results[3].fixableWarningCount, 0);
                assert.equal(results[3].messages.length, 0);
                assert.equal(results[3].suppressedMessages.length, 0);
                assert.equal
                (relative(formattersDir, results[4].filePath), join('test', 'simple.js'));
                assert.equal(results[4].errorCount, 0);
                assert.equal(results[4].warningCount, 0);
                assert.equal(results[4].fatalErrorCount, 0);
                assert.equal(results[4].fixableErrorCount, 0);
                assert.equal(results[4].fixableWarningCount, 0);
                assert.equal(results[4].messages.length, 0);
                assert.equal(results[4].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should return zero messages when given a config with browser globals',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        cwd:    join(fixtureDir, '..'),
                        config: getFixturePath('configurations', 'env-browser.js'),
                    },
                );
                const results = await eslint.lintParallel([getFixturePath('globals-browser.js')]);

                assert.equal(results.length, 1);
                assert.equal(results[0].messages.length, 0, 'Should have no messages.');
                assert.equal(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should return zero messages when given an option to add browser globals',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        cwd:    join(fixtureDir, '..'),
                        global: ['window'],
                        rule:
                        {
                            'no-alert': 0,
                            'no-undef': 2,
                        },
                    },
                );
                const results = await eslint.lintParallel([getFixturePath('globals-browser.js')]);

                assert.equal(results.length, 1);
                assert.equal(results[0].messages.length, 0);
                assert.equal(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should return zero messages when given a config with sourceType set to commonjs and ' +
            'Node.js globals',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        cwd:    join(fixtureDir, '..'),
                        config: getFixturePath('configurations', 'env-node.js'),
                    },
                );
                const results = await eslint.lintParallel([getFixturePath('globals-node.js')]);

                assert.equal(results.length, 1);
                assert.equal(results[0].messages.length, 0, 'Should have no messages.');
                assert.equal(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should not return results from previous call when calling more than once',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        cwd:    join(fixtureDir, '..'),
                        config: getFixturePath('eslint.config.js'),
                        ignore: false,
                        rule:   { semi: 2 },
                    },
                );
                const failFilePath = getFixturePath('missing-semicolon.js');
                const passFilePath = getFixturePath('passing.js');
                let results = await eslint.lintParallel([failFilePath]);

                assert.equal(results.length, 1);
                assert.equal(results[0].filePath, failFilePath);
                assert.equal(results[0].messages.length, 1);
                assert.equal(results[0].messages[0].ruleId, 'semi');
                assert.equal(results[0].suppressedMessages.length, 0);
                assert.equal(results[0].messages[0].severity, 2);

                results = await eslint.lintParallel([passFilePath]);

                assert.equal(results.length, 1);
                assert.equal(results[0].filePath, passFilePath);
                assert.equal(results[0].messages.length, 0);
                assert.equal(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should return zero messages when executing a file with a shebang',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        ignore: false,
                        cwd:    getFixturePath(),
                        config: getFixturePath('eslint.config.js'),
                    },
                );
                const results = await eslint.lintParallel([getFixturePath('shebang.js')]);

                assert.equal(results.length, 1);
                assert.equal(results[0].messages.length, 0, 'Should have lint messages.');
                assert.equal(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should return zero messages when executing without a config file',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        cwd:    getFixturePath(),
                        ignore: false,
                    },
                );
                const filePath = getFixturePath('missing-semicolon.js');
                const results = await eslint.lintParallel([filePath]);

                assert.equal(results.length, 1);
                assert.equal(results[0].filePath, filePath);
                assert.equal(results[0].messages.length, 0);
                assert.equal(results[0].suppressedMessages.length, 0);
            },
        );

        // working
        describe
        (
            'Deprecated Rules',
            () =>
            {
                it
                (
                    'should warn when deprecated rules are configured',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd: originalDir,
                                rule:
                                {
                                    'indent-legacy':    1,
                                    'callback-return':  1,
                                },
                            },
                        );
                        const results = await eslint.lintParallel(['lib/eslint-*.js']);

                        assert.deepEqual
                        (
                            results[0].usedDeprecatedRules,
                            [
                                { ruleId: 'indent-legacy', replacedBy: ['indent'] },
                                { ruleId: 'callback-return', replacedBy: [] },
                            ],
                        );
                    },
                );

                it
                (
                    'should not warn when deprecated rules are not configured',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd: originalDir,
                                rule:
                                {
                                    eqeqeq:             1,
                                    'callback-return':  0,
                                },
                            },
                        );
                        const results = await eslint.lintParallel(['lib/eslint-*.js']);

                        assert.deepEqual(results[0].usedDeprecatedRules, []);
                    },
                );

                it
                (
                    'should warn when deprecated rules are found in a config',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd: originalDir,
                                config:
                                'test/fixtures/cli-engine/deprecated-rule-config/eslint.config.js',
                            },
                        );
                        const results = await eslint.lintParallel(['lib/eslint-*.js']);

                        assert.deepEqual
                        (
                            results[0].usedDeprecatedRules,
                            [{ ruleId: 'indent-legacy', replacedBy: ['indent'] }],
                        );
                    },
                );
            },
        );

        // working
        describe
        (
            'Fix Mode',
            () =>
            {
                it
                (
                    'correctly autofixes semicolon-conflicting-fixes',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd: join(fixtureDir, '..'),
                                fix: true,
                            },
                        );
                        const inputPath = getFixturePath('autofix/semicolon-conflicting-fixes.js');
                        const outputPath =
                        getFixturePath('autofix/semicolon-conflicting-fixes.expected.js');
                        const results = await eslint.lintParallel([inputPath]);
                        const expectedOutput = await readFile(outputPath, 'utf8');

                        assert.equal(results[0].output, expectedOutput);
                    },
                );

                it
                (
                    'correctly autofixes return-conflicting-fixes',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd: join(fixtureDir, '..'),
                                fix: true,
                            },
                        );
                        const inputPath = getFixturePath('autofix/return-conflicting-fixes.js');
                        const outputPath =
                        getFixturePath('autofix/return-conflicting-fixes.expected.js');
                        const results = await eslint.lintParallel([inputPath]);
                        const expectedOutput = await readFile(outputPath, 'utf8');

                        assert.equal(results[0].output, expectedOutput);
                    },
                );

                it
                (
                    'should return fixed text on multiple files when in fix mode',
                    async () =>
                    {
                        /**
                         * Converts CRLF to LF in output.
                         * This is a workaround for git's autocrlf option on Windows.
                         * @param {Object} result A result object to convert.
                         * @returns {void}
                         */
                        function convertCRLF(result)
                        {
                            if (result && result.output)
                                result.output = result.output.replace(/\r\n/gu, '\n');
                        }

                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd: join(fixtureDir, '..'),
                                fix: true,
                                rule:
                                {
                                    semi:              2,
                                    quotes:            [2, 'double'],
                                    eqeqeq:            2,
                                    'no-undef':        2,
                                    'space-infix-ops': 2,
                                },
                            },
                        );
                        const results = await eslint.lintParallel([join(fixtureDir, 'fixmode')]);
                        results.forEach(convertCRLF);

                        assert.deepEqual
                        (
                            results,
                            [
                                {
                                    filePath:
                                    join(fixtureDir, 'fixmode/multipass.js'),
                                    messages:               [],
                                    suppressedMessages:     [],
                                    errorCount:             0,
                                    warningCount:           0,
                                    fatalErrorCount:        0,
                                    fixableErrorCount:      0,
                                    fixableWarningCount:    0,
                                    output:                 'true ? "yes" : "no";\n',
                                    usedDeprecatedRules:
                                    [
                                        {
                                            replacedBy: [],
                                            ruleId:     'semi',
                                        },
                                        {
                                            replacedBy: [],
                                            ruleId:     'quotes',
                                        },
                                        {
                                            replacedBy: [],
                                            ruleId:     'space-infix-ops',
                                        },
                                    ],
                                },
                                {
                                    filePath:               join(fixtureDir, 'fixmode/ok.js'),
                                    messages:               [],
                                    suppressedMessages:     [],
                                    errorCount:             0,
                                    warningCount:           0,
                                    fatalErrorCount:        0,
                                    fixableErrorCount:      0,
                                    fixableWarningCount:    0,
                                    usedDeprecatedRules:
                                    [
                                        {
                                            replacedBy: [],
                                            ruleId:     'semi',
                                        },
                                        {
                                            replacedBy: [],
                                            ruleId:     'quotes',
                                        },
                                        {
                                            replacedBy: [],
                                            ruleId:     'space-infix-ops',
                                        },
                                    ],
                                },
                                {
                                    filePath:
                                    join(fixtureDir, 'fixmode/quotes-semi-eqeqeq.js'),
                                    messages:
                                    [
                                        {
                                            column:    9,
                                            line:      2,
                                            endColumn: 11,
                                            endLine:   2,
                                            message:   'Expected \'===\' and instead saw \'==\'.',
                                            messageId: 'unexpected',
                                            nodeType:  'BinaryExpression',
                                            ruleId:    'eqeqeq',
                                            severity:  2,
                                        },
                                    ],
                                    suppressedMessages:     [],
                                    errorCount:             1,
                                    warningCount:           0,
                                    fatalErrorCount:        0,
                                    fixableErrorCount:      0,
                                    fixableWarningCount:    0,
                                    output:
                                    'var msg = "hi";\nif (msg == "hi") {\n\n}\n',
                                    usedDeprecatedRules:
                                    [
                                        {
                                            replacedBy: [],
                                            ruleId:     'semi',
                                        },
                                        {
                                            replacedBy: [],
                                            ruleId:     'quotes',
                                        },
                                        {
                                            replacedBy: [],
                                            ruleId:     'space-infix-ops',
                                        },
                                    ],
                                },
                                {
                                    filePath:
                                    join(fixtureDir, 'fixmode/quotes.js'),
                                    messages:
                                    [
                                        {
                                            column:    18,
                                            line:      1,
                                            endColumn: 21,
                                            endLine:   1,
                                            messageId: 'undef',
                                            message:   '\'foo\' is not defined.',
                                            nodeType:  'Identifier',
                                            ruleId:    'no-undef',
                                            severity:  2,
                                        },
                                    ],
                                    suppressedMessages:     [],
                                    errorCount:             1,
                                    warningCount:           0,
                                    fatalErrorCount:        0,
                                    fixableErrorCount:      0,
                                    fixableWarningCount:    0,
                                    output:                 'var msg = "hi" + foo;\n',
                                    usedDeprecatedRules:
                                    [
                                        {
                                            replacedBy: [],
                                            ruleId:     'semi',
                                        },
                                        {
                                            replacedBy: [],
                                            ruleId:     'quotes',
                                        },
                                        {
                                            replacedBy: [],
                                            ruleId:     'space-infix-ops',
                                        },
                                    ],
                                },
                            ],
                        );
                    },
                );

                // Cannot be run properly until cache is implemented
                it
                (
                    'should run autofix even if files are cached without autofix results',
                    async () =>
                    {
                        const baseOptions =
                        {
                            flag,
                            cwd: join(fixtureDir, '..'),
                            rule:
                            {
                                semi:              2,
                                quotes:            [2, 'double'],
                                eqeqeq:            2,
                                'no-undef':        2,
                                'space-infix-ops': 2,
                            },
                        };
                        eslint =
                        await ESLint.fromCLIOptions({ ...baseOptions, cache: true, fix: false });
                        // Do initial lint run and populate the cache file
                        await eslint.lintParallel([join(fixtureDir, 'fixmode')]);
                        eslint =
                        await ESLint.fromCLIOptions({ ...baseOptions, cache: true, fix: true });
                        const results =
                        await eslint.lintParallel([join(fixtureDir, 'fixmode')]);

                        assert(results.some(result => result.output));
                    },
                );
            },
        );

        describe
        (
            'plugins',
            () =>
            {
                it
                (
                    'should return two messages when executing with config file that specifies a ' +
                    'plugin',
                    async () =>
                    {
                        eslint =
                        await eslintWithPlugins
                        (
                            {
                                flag,
                                cwd:    join(fixtureDir, '..'),
                                config: getFixturePath('configurations', 'plugins-with-prefix.js'),
                            },
                        );
                        const results =
                        await eslint.lintParallel
                        ([getFixturePath('rules', 'test/test-custom-rule.js')]);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2, 'Expected two messages.');
                        assert.equal(results[0].messages[0].ruleId, 'example/example-rule');
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should return two messages when executing with cli option that specifies a ' +
                    'plugin',
                    async () =>
                    {
                        eslint =
                        await eslintWithPlugins
                        (
                            {
                                flag,
                                cwd:    join(fixtureDir, '..'),
                                rule:   { 'example/example-rule': 1 },
                            },
                        );
                        const results =
                        await eslint.lintParallel
                        ([getFixturePath('rules', 'test', 'test-custom-rule.js')]);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2);
                        assert.equal(results[0].messages[0].ruleId, 'example/example-rule');
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should return two messages when executing with cli option that specifies ' +
                    'preloaded plugin',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:                        join(fixtureDir, '..'),
                                rule:                       { 'test/example-rule': 1 },
                                plugin:                     ['test'],
                                resolvePluginsRelativeTo:   getFixturePath('plugins'),
                            },
                        );
                        const results =
                        await eslint.lintParallel
                        ([getFixturePath('rules', 'test', 'test-custom-rule.js')]);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2);
                        assert.equal(results[0].messages[0].ruleId, 'test/example-rule');
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );
            },
        );

        describe
        (
            'processors',
            () =>
            {
                it
                (
                    'should return two messages when executing with config file that specifies ' +
                    'preloaded processor',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                config: 'fixtures/eslint-config-test-processor-1.js',
                                cwd:    join(fixtureDir, '..'),
                            },
                        );
                        const results =
                        await eslint.lintParallel
                        ([getFixturePath('processors', 'test', 'test-processor.txt')]);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2);
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should run processors when calling lintParallel with config file that ' +
                    'specifies preloaded processor',
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                config: 'fixtures/eslint-config-test-processor-2.js',
                                cwd:    join(fixtureDir, '..'),
                            },
                        );
                        const results =
                        await eslint.lintParallel
                        ([getFixturePath('processors', 'test', 'test-processor.txt')]);

                        assert.equal
                        (results[0].messages[0].message, '\'b\' is defined but never used.');
                        assert.equal(results[0].messages[0].ruleId, 'post-processed');
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );
            },
        );

        describe
        (
            'Patterns which match no file should throw errors.',
            () =>
            {
                beforeEach
                (
                    async () =>
                    {
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd: getFixturePath('cli-engine'),
                            },
                        );
                    },
                );

                it
                (
                    'one file',
                    async () =>
                    {
                        await assert.rejects
                        (
                            eslint.lintParallel(['non-exist.js']),
                            /No files matching 'non-exist\.js' were found\./u,
                        );
                    },
                );

                it
                (
                    'should throw if the directory exists and is empty',
                    async () =>
                    {
                        await mkdir(getFixturePath('cli-engine/empty'), { recursive: true });
                        await assert.rejects
                        (eslint.lintParallel(['empty']), /No files matching 'empty' were found\./u);
                    },
                );

                it
                (
                    'one glob pattern',
                    async () =>
                    {
                        await assert.rejects
                        (
                            eslint.lintParallel(['non-exist/**/*.js']),
                            /No files matching 'non-exist\/\*\*\/\*\.js' were found\./u,
                        );
                    },
                );

                it
                (
                    'two files',
                    async () =>
                    {
                        await assert.rejects
                        (
                            eslint.lintParallel(['aaa.js', 'bbb.js']),
                            /No files matching 'aaa\.js' were found\./u,
                        );
                    },
                );

                it
                (
                    'a mix of an existing file and a non-existing file',
                    async () =>
                    {
                        await assert.rejects
                        (
                            eslint.lintParallel(['console.js', 'non-exist.js']),
                            /No files matching 'non-exist\.js' were found\./u,
                        );
                    },
                );

                // https://github.com/eslint/eslint/issues/16275
                it
                (
                    'a mix of an existing glob pattern and a non-existing glob pattern',
                    async () =>
                    {
                        await assert.rejects
                        (
                            eslint.lintParallel(['*.js', 'non-exist/*.js']),
                            /No files matching 'non-exist\/\*\.js' were found\./u,
                        );
                    },
                );
            },
        );

        describe
        (
            'multiple processors',
            () =>
            {
                const root = join(tmpDir, 'eslint/eslint/multiple-processors');
                let commonFiles;

                // unique directory for each test to avoid quirky disk-cleanup errors
                let id;

                before
                (
                    async () =>
                    {
                        commonFiles =
                        {
                            'node_modules/pattern-processor/index.js':
                            await readFile
                            (
                                new URL
                                ('./fixtures/processors/pattern-processor.js', import.meta.url),
                                'utf8',
                            ),
                            'node_modules/eslint-plugin-markdown/index.js':
                            `
                            const { defineProcessor } = require("pattern-processor");
                            const processor = defineProcessor(${/```(\w+)\n([\s\S]+?)\n```/gu});
                            exports.processors =
                            {
                                "markdown":     { ...processor, supportsAutofix: true },
                                "non-fixable":  processor,
                            };
                            `,
                            'node_modules/eslint-plugin-html/index.js':
                            `
                            const { defineProcessor } = require("pattern-processor");
                            const processor =
                            defineProcessor
                            (${/<script lang="(\w*)">\n([\s\S]+?)\n<\/script>/gu});
                            const legacyProcessor =
                            defineProcessor
                            (${/<script lang="(\w*)">\n([\s\S]+?)\n<\/script>/gu}, true);
                            exports.processors =
                            {
                                "html": { ...processor, supportsAutofix: true },
                                "non-fixable": processor,
                                "legacy": legacyProcessor,
                            };
                            `,
                            'test.md':
                            unIndent`
                            \`\`\`js
                            console.log("hello")
                            \`\`\`
                            \`\`\`html
                            <div>Hello</div>
                            <script lang="js">
                                console.log("hello")
                            </script>
                            <script lang="ts">
                                console.log("hello")
                            </script>
                            \`\`\`
                            `,
                        };
                    },
                );

                beforeEach
                (
                    () =>
                    {
                        id = Date.now().toString();
                    },
                );

                afterEach(async () => await rm(root, { recursive: true, force: true }));

                it
                (
                    'should lint only JavaScript blocks.',
                    async () =>
                    {
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd: join(root, id),
                                files:
                                {
                                    ...commonFiles,
                                    'eslint.config.js':
                                    `module.exports =
                                    [
                                        {
                                            plugins:
                                            {
                                                markdown:   require("eslint-plugin-markdown"),
                                                html:       require("eslint-plugin-html"),
                                            },
                                        },
                                        {
                                            files: ["**/*.js"],
                                            rules: { semi: "error" },
                                        },
                                        {
                                            files:      ["**/*.md"],
                                            processor:  "markdown/markdown",
                                        },
                                    ];`,
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.md']);

                        assert.equal(results.length, 1, 'Should have one result.');
                        assert.equal(results[0].messages.length, 1, 'Should have one message.');
                        assert.equal(results[0].messages[0].ruleId, 'semi');
                        assert.equal
                        (results[0].messages[0].line, 2, 'Message should be on line 2.');
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should lint HTML blocks as well with multiple processors if represented in ' +
                    'config.',
                    async () =>
                    {
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd: join(root, id),
                                files:
                                {
                                    ...commonFiles,
                                    'eslint.config.js':
                                    `module.exports =
                                    [
                                        {
                                            plugins:
                                            {
                                                markdown:   require("eslint-plugin-markdown"),
                                                html:       require("eslint-plugin-html"),
                                            },
                                        },
                                        {
                                            files: ["**/*.js"],
                                            rules: { semi: "error" },
                                        },
                                        {
                                            files:      ["**/*.md"],
                                            processor:  "markdown/markdown",
                                        },
                                        {
                                            files: ["**/*.html"],
                                            processor: "html/html",
                                        },
                                    ];`,
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            teardown.getPath(),
                                overrideConfig: { files: ['**/*.html'] },
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.md']);

                        assert.equal(results.length, 1, 'Should have one result.');
                        assert.equal(results[0].messages.length, 2, 'Should have two messages.');
                        assert.equal(results[0].messages[0].ruleId, 'semi'); // JS block
                        assert.equal
                        (results[0].messages[0].line, 2, 'First error should be on line 2');
                        // JS block in HTML block
                        assert.equal(results[0].messages[1].ruleId, 'semi');
                        assert.equal
                        (results[0].messages[1].line, 7, 'Second error should be on line 7.');
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should fix HTML blocks as well with multiple processors if represented in ' +
                    'config.',
                    async () =>
                    {
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd: join(root, id),
                                files:
                                {
                                    ...commonFiles,
                                    'eslint.config.js':
                                    `module.exports =
                                    [
                                        {
                                            plugins:
                                            {
                                                markdown:   require("eslint-plugin-markdown"),
                                                html:       require("eslint-plugin-html"),
                                            },
                                        },
                                        {
                                            files: ["**/*.js"],
                                            rules: { semi: "error" },
                                        },
                                        {
                                            files:      ["**/*.md"],
                                            processor:  "markdown/markdown",
                                        },
                                        {
                                            files: ["**/*.html"],
                                            processor: "html/html",
                                        },
                                    ];`,
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            teardown.getPath(),
                                overrideConfig: { files: ['**/*.html'] },
                                fix:            true,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.md']);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 0);
                        assert.equal(results[0].suppressedMessages.length, 0);
                        assert.equal
                        (
                            results[0].output,
                            unIndent`
                \`\`\`js
                console.log("hello");${/* ← fixed */''}
                \`\`\`
                \`\`\`html
                <div>Hello</div>
                <script lang="js">
                    console.log("hello");${/* ← fixed */''}
                </script>
                <script lang="ts">
                    console.log("hello")${/* ← ignored */''}
                </script>
                \`\`\`
            `,
                        );
                    },
                );

                it
                (
                    'should use the config \'**/*.html/*.js\' to lint JavaScript blocks in HTML.',
                    async () =>
                    {
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                flag,
                                cwd: join(root, id),
                                files:
                                {
                                    ...commonFiles,
                                    'eslint.config.js':
                                    `module.exports =
                                    [
                                        {
                                            plugins:
                                            {
                                                markdown:   require("eslint-plugin-markdown"),
                                                html:       require("eslint-plugin-html"),
                                            },
                                        },
                                        {
                                            files: ["**/*.js"],
                                            rules: { semi: "error" },
                                        },
                                        {
                                            files:      ["**/*.md"],
                                            processor:  "markdown/markdown",
                                        },
                                        {
                                            files:      ["**/*.html"],
                                            processor:  "html/html",
                                        },
                                        {
                                            files: ["**/*.html/*.js"],
                                            rules:
                                            {
                                                semi: "off",
                                                "no-console": "error",
                                            },
                                        },
                                    ];`,
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            teardown.getPath(),
                                overrideConfig: { files: ['**/*.html'] },
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.md']);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2);
                        assert.equal(results[0].messages[0].ruleId, 'semi');
                        assert.equal(results[0].messages[0].line, 2);
                        assert.equal(results[0].messages[1].ruleId, 'no-console');
                        assert.equal(results[0].messages[1].line, 7);
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should use the same config as one which has \'processor\' property in order ' +
                    'to lint blocks in HTML if the processor was legacy style.',
                    async () =>
                    {
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd: join(root, id),
                                files:
                                {
                                    ...commonFiles,
                                    'eslint.config.js':
                                    `module.exports =
                                    [
                                        {
                                            plugins:
                                            {
                                                markdown:   require("eslint-plugin-markdown"),
                                                html:       require("eslint-plugin-html"),
                                            },
                                            rules: { semi: "error" },
                                        },
                                        {
                                            files:      ["**/*.md"],
                                            processor:  "markdown/markdown",
                                        },
                                        {
                                            files:      ["**/*.html"],
                                            // this processor returns strings rather than
                                            // '{ text, filename }'
                                            processor:  "html/legacy",
                                            rules:
                                            {
                                                semi:           "off",
                                                "no-console":   "error",
                                            },
                                        },
                                        {
                                            files: ["**/*.html/*.js"],
                                            rules:
                                            {
                                                semi:           "error",
                                                "no-console":   "off",
                                            },
                                        },
                                    ];`,
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            teardown.getPath(),
                                overrideConfig: { files: ['**/*.html'] },
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.md']);

                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 3);
                        assert.equal(results[0].messages[0].ruleId, 'semi');
                        assert.equal(results[0].messages[0].line, 2);
                        assert.equal(results[0].messages[1].ruleId, 'no-console');
                        assert.equal(results[0].messages[1].line, 7);
                        assert.equal(results[0].messages[2].ruleId, 'no-console');
                        assert.equal(results[0].messages[2].line, 10);
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should throw an error if invalid processor was specified.',
                    async () =>
                    {
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd: join(root, id),
                                files:
                                {
                                    ...commonFiles,
                                    'eslint.config.js':
                                    `module.exports =
                                    [
                                        {
                                            plugins:
                                            {
                                                markdown:   require("eslint-plugin-markdown"),
                                                html:       require("eslint-plugin-html"),
                                            },
                                        },
                                        {
                                            files:      ["**/*.md"],
                                            processor:  "markdown/unknown",
                                        },
                                    ];`,
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        await assert.rejects
                        (
                            eslint.lintParallel(['test.md']),
                            /Key "processor": Could not find "unknown" in plugin "markdown"/u,
                        );
                    },
                );
            },
        );

        describe
        (
            'glob pattern \'[ab].js\'',
            () =>
            {
                const root = getFixturePath('cli-engine/unmatched-glob');

                let cleanup;

                beforeEach
                (
                    () =>
                    {
                        cleanup = () => { };
                    },
                );

                afterEach(() => cleanup());

                it
                (
                    'should match \'[ab].js\' if existed.',
                    async () =>
                    {
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd: root,
                                files:
                                {
                                    'a.js':             '',
                                    'b.js':             '',
                                    'ab.js':            '',
                                    '[ab].js':          '',
                                    'eslint.config.js': 'module.exports = [];',
                                },
                            },
                        );
                        await teardown.prepare();
                        ({ cleanup } = teardown);
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['[ab].js']);
                        const filenames = results.map(r => basename(r.filePath));

                        assert.deepEqual(filenames, ['[ab].js']);
                    },
                );

                it
                (
                    'should match \'a.js\' and \'b.js\' if \'[ab].js\' didn\'t existed.',
                    async () =>
                    {
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd: root,
                                files:
                                {
                                    'a.js':             '',
                                    'b.js':             '',
                                    'ab.js':            '',
                                    'eslint.config.js': 'module.exports = [];',
                                },
                            },
                        );
                        await teardown.prepare();
                        ({ cleanup } = teardown);
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['[ab].js']);
                        const filenames = results.map(r => basename(r.filePath));

                        assert.deepEqual(filenames, ['a.js', 'b.js']);
                    },
                );
            },
        );

        describe
        (
            'with \'noInlineConfig\' setting',
            () =>
            {
                const root = getFixturePath('cli-engine/noInlineConfig');

                let cleanup;

                beforeEach
                (
                    () =>
                    {
                        cleanup = () => { };
                    },
                );

                afterEach(() => cleanup());

                it
                (
                    'should warn directive comments if \'noInlineConfig\' was given.',
                    async () =>
                    {
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd: root,
                                files:
                                {
                                    'test.js': '/* globals foo */',
                                    'eslint.config.js':
                                    'module.exports = [{ linterOptions: { noInlineConfig: true } ' +
                                    '}];',
                                },
                            },
                        );
                        await teardown.prepare();
                        ({ cleanup } = teardown);
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.equal(messages.length, 1);
                        assert.equal
                        (
                            messages[0].message,
                            '\'/* globals foo */\' has no effect because you have ' +
                            '\'noInlineConfig\' setting in your config.',
                        );
                    },
                );
            },
        );

        describe
        (
            'with \'reportUnusedDisableDirectives\' setting',
            () =>
            {
                const root = getFixturePath('cli-engine/reportUnusedDisableDirectives');

                let cleanup;
                let i = 0;

                beforeEach
                (
                    () =>
                    {
                        cleanup = () => { };
                        i++;
                    },
                );

                afterEach(() => cleanup());

                it
                (
                    'should error unused \'eslint-disable\' comments if ' +
                    '\'reportUnusedDisableDirectives = error\'.',
                    async () =>
                    {
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd: `${root}${i}`,
                                files:
                                {
                                    'test.js': '/* eslint-disable eqeqeq */',
                                    'eslint.config.js':
                                    'module.exports = { linterOptions: { ' +
                                    'reportUnusedDisableDirectives: \'error\' } }',
                                },
                            },
                        );
                        await teardown.prepare();
                        ({ cleanup } = teardown);
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.equal(messages.length, 1);
                        assert.equal(messages[0].severity, 2);
                        assert.equal
                        (
                            messages[0].message,
                            'Unused eslint-disable directive (no problems were reported from ' +
                            '\'eqeqeq\').',
                        );
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should error unused \'eslint-disable\' comments if ' +
                    '\'reportUnusedDisableDirectives = 2\'.',
                    async () =>
                    {
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd: `${root}${i}`,
                                files:
                                {
                                    'test.js': '/* eslint-disable eqeqeq */',
                                    'eslint.config.js':
                                    'module.exports = { linterOptions: { ' +
                                    'reportUnusedDisableDirectives: 2 } }',
                                },
                            },
                        );
                        await teardown.prepare();
                        ({ cleanup } = teardown);
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.equal(messages.length, 1);
                        assert.equal(messages[0].severity, 2);
                        assert.equal
                        (
                            messages[0].message,
                            'Unused eslint-disable directive (no problems were reported from ' +
                            '\'eqeqeq\').',
                        );
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should warn unused \'eslint-disable\' comments if ' +
                    '\'reportUnusedDisableDirectives = warn\'.',
                    async () =>
                    {
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd: `${root}${i}`,
                                files:
                                {
                                    'test.js': '/* eslint-disable eqeqeq */',
                                    'eslint.config.js':
                                    'module.exports = { linterOptions: { ' +
                                    'reportUnusedDisableDirectives: \'warn\' } }',
                                },
                            },
                        );
                        await teardown.prepare();
                        ({ cleanup } = teardown);
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.equal(messages.length, 1);
                        assert.equal(messages[0].severity, 1);
                        assert.equal
                        (
                            messages[0].message,
                            'Unused eslint-disable directive (no problems were reported from ' +
                            '\'eqeqeq\').',
                        );
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should warn unused \'eslint-disable\' comments if ' +
                    '\'reportUnusedDisableDirectives = 1\'.',
                    async () =>
                    {
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd: `${root}${i}`,
                                files:
                                {
                                    'test.js': '/* eslint-disable eqeqeq */',
                                    'eslint.config.js':
                                    'module.exports = { linterOptions: { ' +
                                    'reportUnusedDisableDirectives: 1 } }',
                                },
                            },
                        );
                        await teardown.prepare();
                        ({ cleanup } = teardown);
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.equal(messages.length, 1);
                        assert.equal(messages[0].severity, 1);
                        assert.equal
                        (
                            messages[0].message,
                            'Unused eslint-disable directive (no problems were reported from ' +
                            '\'eqeqeq\').',
                        );
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should warn unused \'eslint-disable\' comments if ' +
                    '\'reportUnusedDisableDirectives = true\'.',
                    async () =>
                    {
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd: `${root}${i}`,
                                files:
                                {
                                    'test.js': '/* eslint-disable eqeqeq */',
                                    'eslint.config.js':
                                    'module.exports = { linterOptions: { ' +
                                    'reportUnusedDisableDirectives: true } }',
                                },
                            },
                        );
                        await teardown.prepare();
                        ({ cleanup } = teardown);
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.equal(messages.length, 1);
                        assert.equal(messages[0].severity, 1);
                        assert.equal
                        (
                            messages[0].message,
                            'Unused eslint-disable directive (no problems were reported from ' +
                            '\'eqeqeq\').',
                        );
                        assert.equal(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should not warn unused \'eslint-disable\' comments if ' +
                    '\'reportUnusedDisableDirectives = false\'.',
                    async () =>
                    {
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd: `${root}${i}`,
                                files:
                                {
                                    'test.js': '/* eslint-disable eqeqeq */',
                                    'eslint.config.js':
                                    'module.exports = { linterOptions: { ' +
                                    'reportUnusedDisableDirectives: false } }',
                                },
                            },
                        );
                        await teardown.prepare();
                        ({ cleanup } = teardown);
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.equal(messages.length, 0);
                    },
                );

                it
                (
                    'should not warn unused \'eslint-disable\' comments if ' +
                    '\'reportUnusedDisableDirectives = off\'.',
                    async () =>
                    {
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd: `${root}${i}`,
                                files:
                                {
                                    'test.js': '/* eslint-disable eqeqeq */',
                                    'eslint.config.js':
                                    'module.exports = { linterOptions: { ' +
                                    'reportUnusedDisableDirectives: \'off\' } }',
                                },
                            },
                        );
                        await teardown.prepare();
                        ({ cleanup } = teardown);
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.equal(messages.length, 0);
                    },
                );

                it
                (
                    'should not warn unused \'eslint-disable\' comments if ' +
                    '\'reportUnusedDisableDirectives = 0\'.',
                    async () =>
                    {
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd: `${root}${i}`,
                                files:
                                {
                                    'test.js': '/* eslint-disable eqeqeq */',
                                    'eslint.config.js':
                                    'module.exports = { linterOptions: { ' +
                                    'reportUnusedDisableDirectives: 0 } }',
                                },
                            },
                        );
                        await teardown.prepare();
                        ({ cleanup } = teardown);
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.equal(messages.length, 0);
                    },
                );

                describe
                (
                    'the runtime option overrides config files.',
                    () =>
                    {
                        it
                        (
                            'should not warn unused \'eslint-disable\' comments if ' +
                            '\'reportUnusedDisableDirectives=off\' was given in runtime.',
                            async () =>
                            {
                                const teardown =
                                createCustomTeardown
                                (
                                    {
                                        cwd: `${root}${i}`,
                                        files:
                                        {
                                            'test.js': '/* eslint-disable eqeqeq */',
                                            'eslint.config.js':
                                            'module.exports = [{ linterOptions: { ' +
                                            'reportUnusedDisableDirectives: true } }]',
                                        },
                                    },
                                );
                                await teardown.prepare();
                                ({ cleanup } = teardown);
                                eslint =
                                await ESLint.fromCLIOptions
                                (
                                    {
                                        flag,
                                        cwd:                                    teardown.getPath(),
                                        reportUnusedDisableDirectivesSeverity:  'off',
                                        configLookup:                           true,
                                    },
                                );
                                const results = await eslint.lintParallel(['test.js']);
                                const [{ messages }] = results;

                                assert.equal(messages.length, 0);
                            },
                        );

                        it
                        (
                            'should warn unused \'eslint-disable\' comments as error if ' +
                            '\'reportUnusedDisableDirectives=error\' was given in runtime.',
                            async () =>
                            {
                                const teardown =
                                createCustomTeardown
                                (
                                    {
                                        cwd: `${root}${i}`,
                                        files:
                                        {
                                            'test.js': '/* eslint-disable eqeqeq */',
                                            'eslint.config.js':
                                            'module.exports = [{ linterOptions: { ' +
                                            'reportUnusedDisableDirectives: true } }]',
                                        },
                                    },
                                );
                                await teardown.prepare();
                                ({ cleanup } = teardown);
                                eslint =
                                await ESLint.fromCLIOptions
                                (
                                    {
                                        flag,
                                        cwd:                            teardown.getPath(),
                                        reportUnusedDisableDirectives:  true,
                                        configLookup:                   true,
                                    },
                                );
                                const results = await eslint.lintParallel(['test.js']);
                                const [{ messages }] = results;

                                assert.equal(messages.length, 1);
                                assert.equal(messages[0].severity, 2);
                                assert.equal
                                (
                                    messages[0].message,
                                    'Unused eslint-disable directive (no problems were reported ' +
                                    'from \'eqeqeq\').',
                                );
                                assert.equal(results[0].suppressedMessages.length, 0);
                            },
                        );
                    },
                );
            },
        );

        it
        (
            'should throw if non-boolean value is given to \'options.warnIgnored\' option',
            async () =>
            {
                eslint = await ESLint.fromCLIOptions({ flag });
                await assert.rejects
                (
                    eslint.lintParallel(777),
                    /'patterns' must be a non-empty string or an array of non-empty strings/u,
                );
                await assert.rejects
                (
                    eslint.lintParallel([null]),
                    /'patterns' must be a non-empty string or an array of non-empty strings/u,
                );
            },
        );

        describe
        (
            'Alternate config files',
            () =>
            {
                it
                (
                    'should find eslint.config.mjs when present',
                    async () =>
                    {
                        const cwd = getFixturePath('mjs-config');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                                configLookup: true,
                            },
                        );
                        const results = await eslint.lintParallel('foo.js');

                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should find eslint.config.cjs when present',
                    async () =>
                    {
                        const cwd = getFixturePath('cjs-config');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                                configLookup: true,
                            },
                        );
                        const results = await eslint.lintParallel('foo.js');

                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 1);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should favor eslint.config.js when eslint.config.mjs and eslint.config.cjs ' +
                    'are present',
                    async () =>
                    {
                        const cwd = getFixturePath('js-mjs-cjs-config');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                                configLookup: true,
                            },
                        );
                        const results = await eslint.lintParallel('foo.js');

                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 0);
                    },
                );

                it
                (
                    'should favor eslint.config.mjs when eslint.config.cjs is present',
                    async () =>
                    {
                        const cwd = getFixturePath('mjs-cjs-config');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                                configLookup: true,
                            },
                        );
                        const results = await eslint.lintParallel('foo.js');

                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );
            },
        );

        describe
        (
            'TypeScript config files',
            () =>
            {
                const typeModule = JSON.stringify({ type: 'module' }, null, 2);
                const typeCommonJS = JSON.stringify({ type: 'commonjs' }, null, 2);
                const newFlag = [...flag, 'unstable_ts_config'];

                it
                (
                    'should find and load eslint.config.ts when present',
                    async () =>
                    {
                        const cwd = getFixturePath('ts-config-files', 'ts');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel('foo.js');

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts when we have "type": "commonjs" in nearest ' +
                    '`package.json`',
                    async () =>
                    {
                        const cwd = getFixturePath('ts-config-files', 'ts', 'with-type-commonjs');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel('foo.js');

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts when we have "type": "module" in nearest ' +
                    '`package.json`',
                    async () =>
                    {
                        const cwd = getFixturePath('ts-config-files', 'ts', 'with-type-module');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel('foo.js');

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with ESM syntax and "type": "commonjs" in ' +
                    'nearest `package.json`',
                    async () =>
                    {
                        const cwd =
                        getFixturePath('ts-config-files', 'ts', 'with-type-commonjs', 'ESM-syntax');
                        const config = [{ rules: { 'no-undef': 2 } }];
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../helper";
                        export default ${JSON.stringify(config, null, 2)} satisfies FlatConfig[];
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'package.json':     typeCommonJS,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo;',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with CJS syntax and "type": "module" in ' +
                    'nearest `package.json`',
                    async () =>
                    {
                        const cwd =
                        getFixturePath('ts-config-files', 'ts', 'with-type-module', 'CJS-syntax');
                        const config = [{ rules: { 'no-undef': 2 } }];
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../helper";
                        module.exports = ${JSON.stringify(config, null, 2)} satisfies FlatConfig[];
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'package.json':     typeModule,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo;',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with CJS syntax and "type": "commonjs" in ' +
                    'nearest `package.json`',
                    async () =>
                    {
                        const cwd =
                        getFixturePath('ts-config-files', 'ts', 'with-type-commonjs', 'CJS-syntax');
                        const config = [{ rules: { 'no-undef': 2 } }];
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../helper";
                        module.exports = ${JSON.stringify(config, null, 2)} satisfies FlatConfig[];
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'package.json':     typeCommonJS,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo;',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with CJS syntax, "type": "module" in nearest ' +
                    '`package.json` and top-level await syntax',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        (
                            'ts-config-files',
                            'ts',
                            'with-type-module',
                            'CJS-syntax',
                            'top-level-await',
                        );
                        const config = [{ rules: { 'no-undef': 2 } }];
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../../helper";
                        module.exports =
                        await Promise.resolve(${JSON.stringify(config, null, 2)}) satisfies
                        FlatConfig[];
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'package.json':     typeModule,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo;',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with CJS syntax, "type": "commonjs" in nearest ' +
                    '`package.json` and top-level await syntax',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        (
                            'ts-config-files',
                            'ts',
                            'with-type-commonjs',
                            'CJS-syntax',
                            'top-level-await',
                        );
                        const config = [{ rules: { 'no-undef': 2 } }];
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../../helper";
                        module.exports =
                        await Promise.resolve(${JSON.stringify(config, null, 2)}) satisfies
                        FlatConfig[];
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'package.json':     typeCommonJS,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo;',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with CJS syntax, "type": "module" in nearest ' +
                    '`package.json` and top-level await syntax (named import)',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        (
                            'ts-config-files',
                            'ts',
                            'with-type-module',
                            'top-level-await',
                            'named-import',
                        );
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../../helper";
                        const { rules } = await import("./rules");
                        module.exports = [{ rules }] satisfies FlatConfig[];
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'rules.ts':         'export const rules = { \'no-undef\': 2 };',
                                    'package.json':     typeModule,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo;',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with CJS syntax, "type": "commonjs" in nearest ' +
                    '`package.json` and top-level await syntax (named import)',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        (
                            'ts-config-files',
                            'ts',
                            'with-type-commonjs',
                            'top-level-await',
                            'named-import',
                        );
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../../helper";
                        const { rules } = await import("./rules");
                        module.exports = [{ rules }] satisfies FlatConfig[];
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'rules.ts':         `export const rules = ${
                                    JSON.stringify
                                    (
                                        {
                                            'no-undef': 2,
                                        }, null, 2,
                                    )
                                    };`,
                                    'package.json':     typeCommonJS,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo;',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with CJS syntax, "type": "module" in nearest ' +
                    '`package.json` and top-level await syntax (import default)',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        (
                            'ts-config-files',
                            'ts',
                            'with-type-module',
                            'top-level-await',
                            'import-default',
                        );
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../../helper";
                        const { default: rules } = await import("./rules");
                        module.exports = [{ rules }] satisfies FlatConfig[];
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'rules.ts':         'export default { \'no-undef\': 2 };',
                                    'package.json':     typeModule,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo;',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with CJS syntax, "type": "commonjs" in nearest ' +
                    '`package.json` and top-level await syntax (import default)',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        (
                            'ts-config-files',
                            'ts',
                            'with-type-commonjs',
                            'top-level-await',
                            'import-default',
                        );
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../../helper";
                        const { default: rules } = await import("./rules");
                        module.exports = [{ rules }] satisfies FlatConfig[];
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'rules.ts':         'export default { \'no-undef\': 2 };',
                                    'package.json':     typeCommonJS,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo;',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with CJS syntax, "type": "module" in nearest ' +
                    '`package.json` and top-level await syntax (default and named imports)',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        (
                            'ts-config-files',
                            'ts',
                            'with-type-module',
                            'top-level-await',
                            'import-default-and-named',
                        );
                        const rulesFileContent =
                        `
                        import type { RulesRecord } from "../../../../helper";
                        export const enum Level { Error = 2, Warn = 1, Off = 0, };
                        export default { 'no-undef': 2 } satisfies RulesRecord;
                        `;
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../../helper";
                        const { default: rules, Level } = await import("./rules");
                        module.exports =
                        [{ rules: { ...rules, semi: Level.Error } }] satisfies FlatConfig[];
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'rules.ts':         rulesFileContent,
                                    'package.json':     typeModule,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[1].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with TypeScript\'s CJS syntax (import and ' +
                    'export assignment), "type": "module" in nearest `package.json`',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        (
                            'ts-config-files',
                            'ts',
                            'with-type-module',
                            'import-and-export-assignment',
                        );
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../helper";
                        import rulesModule = require("./rules");
                        const { rules, Level } = rulesModule;
                        export =
                        [{ rules: { ...rules, semi: Level.Error } }] satisfies FlatConfig[];
                        `;
                        const rulesFileContent =
                        `
                        import type { RulesRecord } from "../../../helper";
                        import { Severity } from "../../../helper";
                        const enum Level { Error = 2, Warn = 1, Off = 0 };
                        export =
                        { rules: { "no-undef": Severity.Error }, Level } satisfies RulesRecord;
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'rules.ts':         rulesFileContent,
                                    'package.json':     typeModule,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[1].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with TypeScript\'s CJS syntax (import and ' +
                    'export assignment), "type": "commonjs" in nearest `package.json`',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        (
                            'ts-config-files',
                            'ts',
                            'with-type-commonjs',
                            'import-and-export-assignment',
                        );
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../helper";
                        import rulesModule = require("./rules");
                        const { rules, Level } = rulesModule;
                        export =
                        [{ rules: { ...rules, semi: Level.Error } }] satisfies FlatConfig[];
                        `;
                        const rulesFileContent =
                        `
                        import type { RulesRecord } from "../../../helper";
                        import { Severity } from "../../../helper";
                        const enum Level { Error = 2, Warn = 1, Off = 0 };
                        export =
                        { rules: { "no-undef": Severity.Error }, Level } satisfies RulesRecord;
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'rules.ts':         rulesFileContent,
                                    'package.json':     typeCommonJS,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[1].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with wildcard imports, "type": "module" in ' +
                    'nearest `package.json`',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        ('ts-config-files', 'ts', 'with-type-module', 'wildcard-imports');
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../helper";
                        import * as rulesModule from "./rules";
                        const { default: rules, Level } = rulesModule;
                        export =
                        [{ rules: { ...rules, semi: Level.Error } }] satisfies FlatConfig[];
                        `;
                        const rulesFileContent =
                        `
                        import type { RulesRecord } from "../../../helper";
                        import { Severity } from "../../../helper";
                        export const enum Level { Error = 2, Warn = 1, Off = 0 };
                        export default { "no-undef": Severity.Error } satisfies RulesRecord;
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'rules.ts':         rulesFileContent,
                                    'package.json':     typeModule,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[1].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with wildcard imports, "type": "commonjs" in ' +
                    'nearest `package.json`',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        ('ts-config-files', 'ts', 'with-type-commonjs', 'wildcard-imports');
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../helper";
                        import * as rulesModule from "./rules";
                        const { default: rules ,Level } = rulesModule;
                        export =
                        [{ rules: { ...rules, semi: Level.Error } }] satisfies FlatConfig[];
                        `;
                        const rulesFileContent =
                        `
                        import type { RulesRecord } from "../../../helper";
                        import { Severity } from "../../../helper";
                        export const enum Level { Error = 2, Warn = 1, Off = 0 };
                        export default { "no-undef": Severity.Error } satisfies RulesRecord;
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'rules.ts':         rulesFileContent,
                                    'package.json':     typeCommonJS,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[1].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with CJS-ESM mixed syntax (import and ' +
                    'module.exports), "type": "module" in nearest `package.json`',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        (
                            'ts-config-files',
                            'ts',
                            'with-type-module',
                            'CJS-ESM-mixed-syntax',
                            'import-and-module-exports',
                        );
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../../helper";
                        import rules, { Level } from "./rules";
                        module.exports =
                        [{ rules: { ...rules, semi: Level.Error } }] satisfies FlatConfig[];
                        `;
                        const config = { 'no-undef': 2 };
                        const rulesFileContent =
                        `
                        import type { RulesRecord } from "../../../../helper";
                        export const enum Level { Error = 2, Warn = 1, Off = 0 };
                        export default ${JSON.stringify(config, null, 2)} satisfies RulesRecord;
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'rules.ts':         rulesFileContent,
                                    'package.json':     typeModule,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[1].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with CJS-ESM mixed syntax (import and ' +
                    'module.exports), "type": "commonjs" in nearest `package.json`',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        (
                            'ts-config-files',
                            'ts',
                            'with-type-commonjs',
                            'CJS-ESM-mixed-syntax',
                            'import-and-module-exports',
                        );
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../../helper";
                        import rules, { Level } from "./rules";
                        module.exports =
                        [{ rules: { ...rules, semi: Level.Error } }] satisfies FlatConfig[];
                        `;
                        const config = { 'no-undef': 2 };
                        const rulesFileContent =
                        `
                        import type { RulesRecord } from "../../../../helper";
                        export const enum Level { Error = 2, Warn = 1, Off = 0 };
                        export default ${JSON.stringify(config, null, 2)} satisfies RulesRecord;
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'rules.ts':         rulesFileContent,
                                    'package.json':     typeCommonJS,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[1].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with CJS-ESM mixed syntax (require and export ' +
                    'default), "type": "module" in nearest `package.json`',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        (
                            'ts-config-files',
                            'ts',
                            'with-type-module',
                            'CJS-ESM-mixed-syntax',
                            'require-and-export-default',
                        );
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../../helper";
                        const { default: rules, Level } = require("./rules");
                        export
                        default [{ rules: { ...rules, semi: Level.Error } }] satisfies FlatConfig[];
                        `;
                        const rulesFileContent =
                        `
                        import type { RulesRecord } from "../../../../helper";
                        import { Severity } from "../../../../helper";
                        export const enum Level { Error = 2, Warn = 1, Off = 0 };
                        export default { "no-undef": Severity.Error } satisfies RulesRecord;
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'rules.ts':         rulesFileContent,
                                    'package.json':     typeModule,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[1].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with CJS-ESM mixed syntax (require and export ' +
                    'default), "type": "commonjs" in nearest `package.json`',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        (
                            'ts-config-files',
                            'ts',
                            'with-type-commonjs',
                            'CJS-ESM-mixed-syntax',
                            'require-and-export-default',
                        );
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../../helper";
                        const { default: rules, Level } = require("./rules");
                        export
                        default [{ rules: { ...rules, semi: Level.Error } }] satisfies FlatConfig[];
                        `;
                        const rulesFileContent =
                        `
                        import type { RulesRecord } from "../../../../helper";
                        import { Severity } from "../../../../helper";
                        export const enum Level { Error = 2, Warn = 1, Off = 0 };
                        export default { "no-undef": Severity.Error } satisfies RulesRecord;
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'rules.ts':         rulesFileContent,
                                    'package.json':     typeCommonJS,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[1].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with CJS-ESM mixed syntax (import assignment ' +
                    'and export default), "type": "module" in nearest `package.json`',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        (
                            'ts-config-files',
                            'ts',
                            'with-type-module',
                            'CJS-ESM-mixed-syntax',
                            'import-assignment-and-export-default',
                        );
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../../helper";
                        import rulesModule = require("./rules");
                        const { default: rules, Level } = rulesModule;
                        export
                        default [{ rules: { ...rules, semi: Level.Error } }] satisfies FlatConfig[];
                        `;
                        const rulesFileContent =
                        `
                        import type { RulesRecord } from "../../../../helper";
                        import { Severity } from "../../../../helper";
                        export const enum Level { Error = 2, Warn = 1, Off = 0 };
                        export default { "no-undef": Severity.Error } satisfies RulesRecord;
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'rules.ts':         rulesFileContent,
                                    'package.json':     typeModule,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[1].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with CJS-ESM mixed syntax (import assignment ' +
                    'and export default), "type": "commonjs" in nearest `package.json`',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        (
                            'ts-config-files',
                            'ts',
                            'with-type-commonjs',
                            'CJS-ESM-mixed-syntax',
                            'import-assignment-and-export-default',
                        );
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../../../helper";
                        import rulesModule = require("./rules");
                        const { default: rules, Level } = rulesModule;
                        export
                        default [{ rules: { ...rules, semi: Level.Error } }] satisfies FlatConfig[];
                        `;
                        const rulesFileContent =
                        `
                        import type { RulesRecord } from "../../../../helper";
                        import { Severity } from "../../../../helper";
                        export const enum Level { Error = 2, Warn = 1, Off = 0 };
                        export default { "no-undef": Severity.Error } satisfies RulesRecord;
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'rules.ts':         rulesFileContent,
                                    'package.json':     typeCommonJS,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[1].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with CJS-ESM mixed syntax (import and export ' +
                    'assignment), "type": "module" in nearest `package.json`',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        (
                            'ts-config-files',
                            'ts',
                            'with-type-module',
                            'CJS-ESM-mixed-syntax',
                            'import-and-export-assignment',
                        );
                        const configFileContent =
                        `
                        import helpers = require("../../../../helper");
                        import rulesModule = require("./rules");
                        const { default: rules, Level } = rulesModule;
                        const allExports =
                        [{ rules: { ...rules, semi: Level.Error } }] satisfies helpers.FlatConfig[];
                        export = allExports;
                        `;
                        const rulesFileContent =
                        `
                        import helpers = require("../../../../helper");
                        const enum Level { Error = 2, Warn = 1, Off = 0 };
                        const rules =
                        { "no-undef": helpers.Severity.Error } satisfies helpers.RulesRecord;
                        const allExports = { default: rules, Level };
                        export = allExports;
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'rules.ts':         rulesFileContent,
                                    'package.json':     typeModule,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[1].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with CJS-ESM mixed syntax (import and export ' +
                    'assignment), "type": "commonjs" in nearest `package.json`',
                    async () =>
                    {
                        const cwd =
                        getFixturePath
                        (
                            'ts-config-files',
                            'ts',
                            'with-type-commonjs',
                            'CJS-ESM-mixed-syntax',
                            'import-and-export-assignment',
                        );
                        const configFileContent =
                        `
                        import helpers = require("../../../../helper");
                        import rulesModule = require("./rules");
                        const { default: rules, Level } = rulesModule;
                        const allExports =
                        [{ rules: { ...rules, semi: Level.Error } }] satisfies helpers.FlatConfig[];
                        export = allExports;
                        `;
                        const rulesFileContent =
                        `
                        import helpers = require("../../../../helper");
                        const enum Level { Error = 2, Warn = 1, Off = 0 };
                        const rules =
                        { "no-undef": helpers.Severity.Error } satisfies helpers.RulesRecord;
                        const allExports = { default: rules, Level };
                        export = allExports;
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'rules.ts':         rulesFileContent,
                                    'package.json':     typeCommonJS,
                                    'eslint.config.ts': configFileContent,
                                    'foo.js':           'foo',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 2);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[1].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with const enums',
                    async () =>
                    {
                        const cwd = getFixturePath('ts-config-files', 'ts', 'const-enums');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel('foo.js');

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.ts with local namespace',
                    async () =>
                    {
                        const cwd = getFixturePath('ts-config-files', 'ts', 'local-namespace');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel('foo.js');

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should allow passing a TS config file to `overrideConfigFile`',
                    async () =>
                    {
                        const cwd = getFixturePath('ts-config-files', 'ts', 'custom-config');
                        const config = join(cwd, 'eslint.custom.config.ts');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag: newFlag,
                                config,
                            },
                        );
                        const results = await eslint.lintParallel('foo.js');

                        assert.equal(await eslint.findConfigFile(), config);
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should find and load eslint.config.mts when present',
                    async () =>
                    {
                        const cwd = getFixturePath('ts-config-files', 'mts');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel('foo.js');

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.mts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.mts when we have "type": "commonjs" in nearest ' +
                    '`package.json`',
                    async () =>
                    {
                        const cwd = getFixturePath('ts-config-files', 'mts', 'with-type-commonjs');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel('foo.js');

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.mts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.mts config file when we have "type": "module" in ' +
                    'nearest `package.json`',
                    async () =>
                    {
                        const cwd = getFixturePath('ts-config-files', 'mts', 'with-type-module');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel('foo.js');

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.mts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should find and load eslint.config.cts when present',
                    async () =>
                    {
                        const cwd = getFixturePath('ts-config-files', 'cts');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel('foo.js');

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.cts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load eslint.config.cts config file when we have "type": "commonjs" ' +
                    'in nearest `package.json`',
                    async () =>
                    {
                        const cwd = getFixturePath('ts-config-files', 'cts', 'with-type-commonjs');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel('foo.js');

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.cts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should load .cts config file when we have "type": "module" in nearest ' +
                    '`package.json`',
                    async () =>
                    {
                        const cwd = getFixturePath('ts-config-files', 'cts', 'with-type-module');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel('foo.js');

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.cts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );

                it
                (
                    'should not load extensions other than .ts, .mts or .cts',
                    async () =>
                    {
                        const cwd = getFixturePath('ts-config-files', 'wrong-extension');
                        const config = [{ rules: { 'no-undef': 2 } }];
                        const configFileContent =
                        `
                        import type { FlatConfig } from "../../helper";
                        export default ${JSON.stringify(config, null, 2)} satisfies FlatConfig[];
                        `;
                        const teardown =
                        createCustomTeardown
                        (
                            {
                                cwd,
                                files:
                                {
                                    'package.json':       typeCommonJS,
                                    'eslint.config.mcts': configFileContent,
                                    'foo.js':             'foo;',
                                },
                            },
                        );
                        await teardown.prepare();
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                config: 'eslint.config.mcts',
                                flag:   newFlag,
                            },
                        );

                        assert.equal
                        (await eslint.findConfigFile(), join(cwd, 'eslint.config.mcts'));
                        await assert.rejects(eslint.lintParallel(['foo.js']));
                    },
                );

                it
                (
                    'should not load TS config files when `"unstable_ts_config"` flag is not set',
                    async () =>
                    {
                        const cwd = getFixturePath('ts-config-files', 'ts');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag,
                                config: 'eslint.config.ts',
                            },
                        );

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        await assert.rejects(eslint.lintParallel(['foo.js']));
                    },
                );

                it
                (
                    'should fallback to JS config files when `"unstable_ts_config"` flag is not ' +
                    'set',
                    async () =>
                    {
                        const cwd = getFixturePath('ts-config-files', 'ts');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag,
                                configLookup: true,
                            },
                        );

                        assert.equal
                        (await eslint.findConfigFile(), join(cwd, '../../eslint.config.js'));
                        await assert.doesNotReject(() => eslint.lintParallel(['foo.js']));
                    },
                );

                it
                (
                    'should successfully load a TS config file that exports a promise',
                    async () =>
                    {
                        const cwd = getFixturePath('ts-config-files', 'ts', 'exports-promise');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                flag:           newFlag,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['foo*.js']);

                        assert.equal(await eslint.findConfigFile(), join(cwd, 'eslint.config.ts'));
                        assert.equal(results.length, 1);
                        assert.equal(results[0].filePath, join(cwd, 'foo.js'));
                        assert.equal(results[0].messages.length, 1);
                        assert.equal(results[0].messages[0].severity, 2);
                        assert.equal(results[0].messages[0].ruleId, 'no-undef');
                    },
                );
            },
        );

        it
        (
            'should stop linting files if a rule crashes',
            async () =>
            {
                let createCallCountArray;

                function doBefore()
                {
                    createCallCountArray =
                    new Uint32Array(new SharedArrayBuffer(Uint32Array.BYTES_PER_ELEMENT));
                    setEnvironmentData('create-call-count-array', createCallCountArray);
                }

                function doAfter()
                {
                    createCallCountArray = undefined;
                    setEnvironmentData('create-call-count-array', undefined);
                }

                async function doTest()
                {
                    const cwd = getFixturePath('autofix');
                    const concurrency = 2;
                    const eslint =
                    await ESLint.fromCLIOptions
                    (
                        {
                            flag,
                            concurrency,
                            cwd,
                            plugin:                     ['boom'],
                            resolvePluginsRelativeTo:   getFixturePath('plugins'),
                            rule:                       { 'boom/boom': 'error' },
                        },
                    );
                    await assert.rejects
                    (
                        eslint.lintParallel('*.js'),
                        ({ message }) =>
                        message.startsWith('Error while loading rule \'boom/boom\': Boom!\n'),
                    );
                    // Wait until all worker threads have terminated.
                    while (process.getActiveResourcesInfo().includes('MessagePort'))
                        await setImmediate();
                    const [createCallCount] = createCallCountArray;
                    assert
                    (
                        createCallCount <= concurrency,
                        `Expected no more calls that there are worker threads but got ${
                        createCallCount}`,
                    );
                }

                doBefore();
                try
                {
                    await doTest();
                }
                finally
                {
                    doAfter();
                }
            },
        );

        describe
        (
            'Error while globbing',
            () =>
            {
                it
                (
                    'should throw an error with a glob pattern if an invalid config was provided',
                    async () =>
                    {
                        const cwd = getFixturePath('files');
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                flag,
                                cwd,
                                overrideConfig: [{ invalid: 'foobar' }],
                            },
                        );
                        await assert.rejects(eslint.lintParallel('*.js'));
                    },
                );
            },
        );
    },
);

(
    (title, fn) =>
    {
        describe(title, () => fn([]));
        describe
        (
            `${title} with flag unstable_config_lookup_from_file`,
            () => fn(['unstable_config_lookup_from_file']),
        );
    }
)
(
    'Fix Types',
    flag =>
    {
        let eslint;

        useFixtures();

        it
        (
            'should throw an error when an invalid fix type is specified',
            async () =>
            {
                await assert.rejects
                (
                    ESLint.fromCLIOptions
                    (
                        {
                            flag,
                            cwd:        join(fixtureDir, '..'),
                            fix:        true,
                            fixType:    ['layou'],
                        },
                    ),
                    {
                        message:
                        'Invalid Options:\n' +
                        '- \'fixTypes\' must be an array of any of "directive", "problem", ' +
                        '"suggestion", and "layout".',
                    },
                );
            },
        );

        it
        (
            'should not fix any rules when fixTypes is used without fix',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        cwd:        join(fixtureDir, '..'),
                        fix:        false,
                        fixType:    ['layout'],
                    },
                );
                const inputPath = getFixturePath('fix-types/fix-only-semi.js');
                const results = await eslint.lintParallel([inputPath]);

                assert.equal(results[0].output, undefined);
            },
        );

        it
        (
            'should not fix non-style rules when fixTypes has only \'layout\'',
            async () =>
            {
                let results;
                let expectedOutput;
                await Promise.all
                (
                    [
                        (async () => {
                            eslint =
                            await ESLint.fromCLIOptions
                            (
                                {
                                    flag,
                                    cwd:        join(fixtureDir, '..'),
                                    fix:        true,
                                    fixType:    ['layout'],
                                },
                            );
                            const inputPath = getFixturePath('fix-types/fix-only-semi.js');
                            results = await eslint.lintParallel([inputPath]);
                        })(),
                        (async () => {
                            const outputPath =
                            getFixturePath('fix-types/fix-only-semi.expected.js');
                            expectedOutput = await readFile(outputPath, 'utf8');
                        })(),
                    ],
                );

                assert.equal(results[0].output, expectedOutput);
            },
        );

        it
        (
            'should not fix style or problem rules when fixTypes has only \'suggestion\'',
            async () =>
            {
                let results;
                let expectedOutput;
                await Promise.all
                (
                    [
                        (async () => {
                            eslint =
                            await ESLint.fromCLIOptions
                            (
                                {
                                    flag,
                                    cwd:        join(fixtureDir, '..'),
                                    fix:        true,
                                    fixType:    ['suggestion'],
                                },
                            );
                            const inputPath =
                            getFixturePath('fix-types/fix-only-prefer-arrow-callback.js');
                            results = await eslint.lintParallel([inputPath]);
                        })(),
                        (async () => {
                            const outputPath =
                            getFixturePath('fix-types/fix-only-prefer-arrow-callback.expected.js');
                            expectedOutput = await readFile(outputPath, 'utf8');
                        })(),
                    ],
                );

                assert.equal(results[0].output, expectedOutput);
            },
        );

        it
        (
            'should fix both style and problem rules when fixTypes has \'suggestion\' and ' +
            '\'layout\'',
            async () =>
            {
                let results;
                let expectedOutput;
                await Promise.all
                (
                    [
                        (async () => {
                            eslint =
                            await ESLint.fromCLIOptions
                            (
                                {
                                    flag,
                                    cwd:        join(fixtureDir, '..'),
                                    fix:        true,
                                    fixType:    ['suggestion', 'layout'],
                                },
                            );
                            const inputPath =
                            getFixturePath('fix-types/fix-both-semi-and-prefer-arrow-callback.js');
                            results = await eslint.lintParallel([inputPath]);
                        })(),
                        (async () => {
                            const outputPath =
                            getFixturePath
                            ('fix-types/fix-both-semi-and-prefer-arrow-callback.expected.js');
                            expectedOutput = await readFile(outputPath, 'utf8');
                        })(),
                    ],
                );

                assert.equal(results[0].output, expectedOutput);
            },
        );
    },
);

(
    (title, fn) =>
    {
        describe(title, () => fn([]));
        describe
        (
            `${title} with flag unstable_config_lookup_from_file`,
            () => fn(['unstable_config_lookup_from_file']),
        );
    }
)
(
    'Use stats option',
    flag =>
    {
        useFixtures();

        it
        (
            'should report stats',
            async () =>
            {
                const engine =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        rule:   { 'no-regex-spaces': 'error' },
                        cwd:    getFixturePath('stats-example'),
                        stats:  true,
                    },
                );
                const results = await engine.lintParallel(['file-to-fix.js']);

                assert.equal(results[0].stats.fixPasses, 0);
                assert.equal(results[0].stats.times.passes.length, 1);
                assert(Number.isFinite(results[0].stats.times.passes[0].parse.total));
                assert
                (Number.isFinite(results[0].stats.times.passes[0].rules['no-regex-spaces'].total));
                assert(Number.isFinite(results[0].stats.times.passes[0].rules['wrap-regex'].total));
                assert.equal(results[0].stats.times.passes[0].fix.total, 0);
                assert(Number.isFinite(results[0].stats.times.passes[0].total));
            },
        );

        it
        (
            'should report stats with fix',
            async () =>
            {
                const engine =
                await ESLint.fromCLIOptions
                (
                    {
                        flag,
                        rule:   { 'no-regex-spaces': 'error' },
                        cwd:    getFixturePath('stats-example'),
                        fix:    true,
                        stats:  true,
                    },
                );
                const results = await engine.lintParallel(['file-to-fix.js']);

                assert.equal(results[0].stats.fixPasses, 2);
                assert.equal(results[0].stats.times.passes.length, 3);
                assert(Number.isFinite(results[0].stats.times.passes[0].parse.total));
                assert(Number.isFinite(results[0].stats.times.passes[1].parse.total));
                assert(Number.isFinite(results[0].stats.times.passes[2].parse.total));
                assert
                (Number.isFinite(results[0].stats.times.passes[0].rules['no-regex-spaces'].total));
                assert(Number.isFinite(results[0].stats.times.passes[0].rules['wrap-regex'].total));
                assert
                (Number.isFinite(results[0].stats.times.passes[1].rules['no-regex-spaces'].total));
                assert(Number.isFinite(results[0].stats.times.passes[1].rules['wrap-regex'].total));
                assert
                (Number.isFinite(results[0].stats.times.passes[2].rules['no-regex-spaces'].total));
                assert(Number.isFinite(results[0].stats.times.passes[2].rules['wrap-regex'].total));
                assert(Number.isFinite(results[0].stats.times.passes[0].fix.total));
                assert(Number.isFinite(results[0].stats.times.passes[1].fix.total));
                assert.equal(results[0].stats.times.passes[2].fix.total, 0);
                assert(Number.isFinite(results[0].stats.times.passes[0].total));
                assert(Number.isFinite(results[0].stats.times.passes[1].total));
                assert(Number.isFinite(results[0].stats.times.passes[2].total));
            },
        );
    },
);

describe
(
    'cache',
    () =>
    {
        /**
         * helper method to delete a file without caring about exceptions
         * @param {string} filePath The file path
         * @returns {void}
         */
        async function doDelete(filePath)
        {
            try
            {
                await unlink(filePath);
            }
            catch
            {
                /*
                 * we don't care if the file didn't exist, since our
                 * intention was to remove the file
                 */
            }
        }

        /**
         * hash the given string
         * @param {string} str the string to hash
         * @returns {string} the hash
         */
        function hash(str)
        {
            return murmur(str).result().toString(36);
        }

        let cacheFilePath;
        let eslint;
        let fCache;
        let murmur;

        useFixtures();

        before
        (
            async () =>
            {
                const importAsESLint = createImportAs(eslintDirURL);
                [{ default: fCache }, { default: murmur }] =
                await Promise.all
                ([importAsESLint('file-entry-cache'), importAsESLint('imurmurhash')]);
            },
        );

        after
        (
            () =>
            {
                fCache = undefined;
                murmur = undefined;
            },
        );

        beforeEach
        (() => { cacheFilePath = undefined; });

        afterEach
        (
            async () =>
            {
                sinon.restore();
                if (cacheFilePath)
                    await doDelete(cacheFilePath);
            },
        );

        describe
        (
            'when cacheLocation is a directory or looks like a directory',
            () =>
            {
                const cwd = getFixturePath();

                /**
                 * helper method to delete the directory used in testing
                 * @returns {void}
                 */
                async function deleteCacheDir()
                {
                    try
                    {
                        await rm
                        (join(cwd, 'tmp/.cacheFileDir/'), { recursive: true, force: true });
                    }
                    catch
                    {
                        /*
                         * we don't care if the file didn't exist, since our
                         * intention was to remove the file
                         */
                    }
                }

                beforeEach(deleteCacheDir);

                afterEach(deleteCacheDir);

                it
                (
                    'should create the directory and the cache file inside it when ' +
                    'cacheLocation ends with a slash',
                    async () =>
                    {
                        assert
                        (
                            !await directoryExists(join(cwd, './tmp/.cacheFileDir/')),
                            'the cache directory already exists and wasn\'t successfully ' +
                            'deleted',
                        );

                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                // specifying cache true the cache will be created
                                cache:          true,
                                cacheLocation:  './tmp/.cacheFileDir/',
                                rule:
                                {
                                    'no-console':       0,
                                    'no-unused-vars':   2,
                                },
                                ignore:         false,
                            },
                        );
                        const file = getFixturePath('cache/src', 'test-file.js');
                        await eslint.lintParallel([file]);

                        assert
                        (
                            await fileExists
                            (join(cwd, `./tmp/.cacheFileDir/.cache_${hash(cwd)}`)),
                            'the cache for eslint should have been created',
                        );
                    },
                );

                it
                (
                    'should create the cache file inside existing cacheLocation ' +
                    'directory when cacheLocation ends with a slash',
                    async () =>
                    {
                        assert
                        (
                            !await directoryExists(join(cwd, './tmp/.cacheFileDir/')),
                            'the cache directory already exists and wasn\'t successfully ' +
                            'deleted',
                        );

                        await mkdir(join(cwd, './tmp/.cacheFileDir/'), { recursive: true });
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                // specifying cache true the cache will be created
                                cache:          true,
                                cacheLocation:  './tmp/.cacheFileDir/',
                                rule:
                                {
                                    'no-console':       0,
                                    'no-unused-vars':   2,
                                },
                                ignore:         false,
                            },
                        );
                        const file = getFixturePath('cache/src', 'test-file.js');
                        await eslint.lintParallel([file]);

                        assert
                        (
                            await fileExists
                            (join(cwd, `./tmp/.cacheFileDir/.cache_${hash(cwd)}`)),
                            'the cache for eslint should have been created',
                        );
                    },
                );

                it
                (
                    'should create the cache file inside existing cacheLocation ' +
                    'directory when cacheLocation doesn\'t end with a path separator',
                    async () =>
                    {
                        assert
                        (
                            !await directoryExists(join(cwd, './tmp/.cacheFileDir/')),
                            'the cache directory already exists and wasn\'t successfully ' +
                            'deleted',
                        );

                        await mkdir(join(cwd, './tmp/.cacheFileDir/'), { recursive: true });
                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                // specifying cache true the cache will be created
                                cache:          true,
                                cacheLocation:  './tmp/.cacheFileDir',
                                rule:
                                {
                                    'no-console':       0,
                                    'no-unused-vars':   2,
                                },
                                ignore:         false,
                            },
                        );
                        const file = getFixturePath('cache/src', 'test-file.js');
                        await eslint.lintParallel([file]);

                        assert
                        (
                            await fileExists
                            (join(cwd, `./tmp/.cacheFileDir/.cache_${hash(cwd)}`)),
                            'the cache for eslint should have been created',
                        );
                    },
                );
            },
        );

        it
        (
            'should create the cache file inside cwd when no cacheLocation provided',
            async () =>
            {
                const cwd = getFixturePath('cli-engine');
                cacheFilePath = join(cwd, '.eslintcache');
                await doDelete(cacheFilePath);
                assert
                (
                    !await fileExists(cacheFilePath),
                    'the cache file already exists and wasn\'t successfully deleted',
                );

                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        cache:  true,
                        cwd,
                        rule:   { 'no-console': 0 },
                        ignore: false,
                    },
                );
                const file = getFixturePath('cli-engine', 'console.js');
                await eslint.lintParallel([file]);

                assert
                (
                    await fileExists(cacheFilePath),
                    'the cache for eslint should have been created at provided cwd',
                );
            },
        );

        it
        (
            'should invalidate the cache if the overrideConfig changed between executions',
            async () =>
            {
                const cwd = getFixturePath('cache/src');
                cacheFilePath = join(cwd, '.eslintcache');
                await doDelete(cacheFilePath);
                assert
                (
                    !await fileExists(cacheFilePath),
                    'the cache file already exists and wasn\'t successfully deleted',
                );

                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        cwd,
                        // specifying cache true the cache will be created
                        cache:  true,
                        rule:
                        {
                            'no-console':       0,
                            'no-unused-vars':   2,
                        },
                        ignore: false,
                    },
                );
                eslint.createLintSingleFileModuleURL = '#create-lint-single-file-with-cache-test';
                const file = join(cwd, 'test-file.js');
                const results = await eslint.lintParallel([file]);

                for (const { errorCount, warningCount, readFileCalled } of results)
                {
                    assert.equal
                    (
                        errorCount + warningCount,
                        0,
                        'the file should have passed linting without errors or warnings',
                    );
                    assert
                    (
                        readFileCalled,
                        'ESLint should have read the file because there was no cache file',
                    );
                }
                assert
                (
                    await fileExists(cacheFilePath),
                    'the cache for eslint should have been created',
                );

                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        cwd,
                        // specifying cache true the cache will be created
                        cache:  true,
                        rule:
                        {
                            'no-console':       2,
                            'no-unused-vars':   2,
                        },
                        ignore: false,
                    },
                );
                eslint.createLintSingleFileModuleURL = '#create-lint-single-file-with-cache-test';
                const [newResult] = await eslint.lintParallel([file]);

                assert
                (
                    newResult.readFileCalled,
                    'ESLint should have read the file again because it\'s considered ' +
                    'changed because the config changed',
                );
                assert.equal
                (
                    newResult.errorCount,
                    1,
                    'since configuration changed the cache should have not been used and ' +
                    'one error should have been reported',
                );
                assert.equal(newResult.messages[0].ruleId, 'no-console');
                assert
                (
                    await fileExists(cacheFilePath),
                    'The cache for ESLint should still exist',
                );
            },
        );

        it
        (
            'should remember the files from a previous run and do not operate on them if ' +
            'not changed',
            async () =>
            {
                const cwd = getFixturePath('cache/src');
                cacheFilePath = join(cwd, '.eslintcache');
                await doDelete(cacheFilePath);
                assert
                (
                    !await fileExists(cacheFilePath),
                    'the cache file already exists and wasn\'t successfully deleted',
                );

                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        cwd,
                        // specifying cache true the cache will be created
                        cache:  true,
                        rule:
                        {
                            'no-console':       0,
                            'no-unused-vars':   2,
                        },
                        ignore: false,
                    },
                );
                eslint.createLintSingleFileModuleURL = '#create-lint-single-file-with-cache-test';
                const file = getFixturePath('cache/src', 'test-file.js');
                const results = await eslint.lintParallel([file]);

                assert
                (
                    results[0].readFileCalled,
                    'ESLint should have read the file because there was no cache file',
                );
                assert
                (
                    await fileExists(cacheFilePath),
                    'the cache for eslint should have been created',
                );

                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        cwd,
                        // specifying cache true the cache will be created
                        cache:  true,
                        rule:
                        {
                            'no-console':       0,
                            'no-unused-vars':   2,
                        },
                        ignore: false,
                    },
                );
                eslint.createLintSingleFileModuleURL = '#create-lint-single-file-with-cache-test';
                const cachedResults = await eslint.lintParallel([file]);

                assert.deepEqual
                (
                    { ...results[0], readFileCalled: undefined },
                    { ...cachedResults[0], readFileCalled: undefined },
                    'the result should have been the same',
                );

                // assert the file was not processed because the cache was used
                assert(!cachedResults[0].readFileCalled, 'the file should not have been reloaded');
            },
        );

        it
        (
            'when `cacheLocation` is specified, should create the cache file with ' +
            '`cache:true` and then delete it with `cache:false`',
            async () =>
            {
                cacheFilePath = getFixturePath('.eslintcache');
                await doDelete(cacheFilePath);
                assert
                (
                    !await fileExists(cacheFilePath),
                    'the cache file already exists and wasn\'t successfully deleted',
                );

                const cliOptions =
                {
                    // specifying cache true the cache will be created
                    cache:          true,
                    cacheLocation:  cacheFilePath,
                    rule:
                    {
                        'no-console':       0,
                        'no-unused-vars':   2,
                    },
                    cwd:            join(fixtureDir, '..'),
                };
                eslint = await ESLint.fromCLIOptions(cliOptions);
                const file = getFixturePath('cache/src', 'test-file.js');
                await eslint.lintParallel([file]);

                assert
                (
                    await fileExists(cacheFilePath),
                    'the cache for eslint should have been created',
                );

                cliOptions.cache = false;
                eslint = await ESLint.fromCLIOptions(cliOptions);
                await eslint.lintParallel([file]);

                assert
                (
                    !await fileExists(cacheFilePath),
                    'the cache for eslint should have been deleted since last run did ' +
                    'not use the cache',
                );
            },
        );

        it
        (
            'should not throw an error if the cache file to be deleted does not exist on ' +
            'a read-only file system',
            async () =>
            {
                cacheFilePath = getFixturePath('.eslintcache');
                await doDelete(cacheFilePath);
                assert
                (
                    !await fileExists(cacheFilePath),
                    'the cache file already exists and wasn\'t successfully deleted',
                );

                // Simulate a read-only file system.
                sinon.stub(fsPromises, 'unlink').rejects
                (Object.assign(Error('read-only file system'), { code: 'EROFS' }));
                const cliOptions =
                {
                    // specifying cache false the cache will be deleted
                    cache:          false,
                    cacheLocation:  cacheFilePath,
                    rule:
                    {
                        'no-console':       0,
                        'no-unused-vars':   2,
                    },
                    cwd:            join(fixtureDir, '..'),
                };
                eslint = await ESLint.fromCLIOptions(cliOptions);
                const file = getFixturePath('cache/src', 'test-file.js');
                await eslint.lintParallel([file]);

                assert
                (
                    fsPromises.unlink.calledWithExactly(cacheFilePath),
                    'Expected attempt to delete the cache was not made.',
                );
            },
        );

        it
        (
            'should store in the cache a file that has lint messages and a file that ' +
            'doesn\'t have lint messages',
            async () =>
            {
                cacheFilePath = getFixturePath('.eslintcache');
                await doDelete(cacheFilePath);
                assert
                (
                    !await fileExists(cacheFilePath),
                    'the cache file already exists and wasn\'t successfully deleted',
                );

                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        cwd:            join(fixtureDir, '..'),
                        // specifying cache true the cache will be created
                        cache:          true,
                        cacheLocation:  cacheFilePath,
                        rule:
                        {
                            'no-console':       0,
                            'no-unused-vars':   2,
                        },
                    },
                );
                const badFile = getFixturePath('cache/src', 'fail-file.js');
                const goodFile = getFixturePath('cache/src', 'test-file.js');
                const result = await eslint.lintParallel([badFile, goodFile]);
                const [badFileResult, goodFileResult] = result;

                assert.notEqual
                (
                    badFileResult.errorCount + badFileResult.warningCount,
                    0,
                    'the bad file should have some lint errors or warnings',
                );
                assert.equal
                (
                    goodFileResult.errorCount + badFileResult.warningCount,
                    0,
                    'the good file should have passed linting without errors or warnings',
                );
                assert
                (
                    await fileExists(cacheFilePath),
                    'the cache for eslint should have been created',
                );

                const fileCache = fCache.createFromFile(cacheFilePath);
                const { cache } = fileCache;

                assert.equal
                (
                    typeof cache.getKey(goodFile),
                    'object',
                    'the entry for the good file should have been in the cache',
                );
                assert.equal
                (
                    typeof cache.getKey(badFile),
                    'object',
                    'the entry for the bad file should have been in the cache',
                );

                const cachedResult = await eslint.lintParallel([badFile, goodFile]);

                assert.deepEqual
                (result, cachedResult, 'result should be the same with or without cache');
            },
        );

        it
        (
            'should not contain in the cache a file that was deleted',
            async () =>
            {
                cacheFilePath = getFixturePath('.eslintcache');
                await doDelete(cacheFilePath);
                assert
                (
                    !await fileExists(cacheFilePath),
                    'the cache file already exists and wasn\'t successfully deleted',
                );

                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        cwd:            join(fixtureDir, '..'),
                        // specifying cache true the cache will be created
                        cache:          true,
                        cacheLocation:  cacheFilePath,
                        rule:
                        {
                            'no-console':       0,
                            'no-unused-vars':   2,
                        },
                    },
                );
                const badFile = getFixturePath('cache/src', 'fail-file.js');
                const goodFile = getFixturePath('cache/src', 'test-file.js');
                const toBeDeletedFile = getFixturePath('cache/src', 'file-to-delete.js');
                await eslint.lintParallel([badFile, goodFile, toBeDeletedFile]);
                const fileCache = fCache.createFromFile(cacheFilePath);
                let { cache } = fileCache;

                assert.equal
                (
                    typeof cache.getKey(toBeDeletedFile),
                    'object',
                    'the entry for the file to be deleted should have been in the cache',
                );

                // delete the file from the file system
                await unlink(toBeDeletedFile);

                /*
                 * file-entry-cache@2.0.0 will remove from the cache deleted files
                 * even when they were not part of the array of files to be analyzed
                 */
                await eslint.lintParallel([badFile, goodFile]);

                cache = JSON.parse(await readFile(cacheFilePath));

                assert.equal
                (
                    typeof cache[0][toBeDeletedFile],
                    'undefined',
                    'the entry for the file to be deleted should not have been in the ' +
                    'cache',
                );
                // make sure that the previos assertion checks the right place
                assert.notEqual
                (
                    typeof cache[0][badFile],
                    'undefined',
                    'the entry for the bad file should have been in the cache',
                );
                assert.notEqual
                (
                    typeof cache[0][goodFile],
                    'undefined',
                    'the entry for the good file should have been in the cache',
                );
            },
        );

        it
        (
            'should contain files that were not visited in the cache provided they still ' +
            'exist',
            async () =>
            {
                cacheFilePath = getFixturePath('.eslintcache');
                await doDelete(cacheFilePath);
                assert
                (
                    !await fileExists(cacheFilePath),
                    'the cache file already exists and wasn\'t successfully deleted',
                );

                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        cwd:            join(fixtureDir, '..'),
                        // specifying cache true the cache will be created
                        cache:          true,
                        cacheLocation:  cacheFilePath,
                        rule:
                        {
                            'no-console':       0,
                            'no-unused-vars':   2,
                        },
                    },
                );
                const badFile = getFixturePath('cache/src', 'fail-file.js');
                const goodFile = getFixturePath('cache/src', 'test-file.js');
                const testFile2 = getFixturePath('cache/src', 'test-file2.js');
                await eslint.lintParallel([badFile, goodFile, testFile2]);
                let fileCache = fCache.createFromFile(cacheFilePath);
                let { cache } = fileCache;

                assert.equal
                (
                    typeof cache.getKey(testFile2),
                    'object',
                    'the entry for the test-file2 should have been in the cache',
                );

                /*
                 * we pass a different set of files (minus test-file2)
                 * previous version of file-entry-cache would remove the non visited
                 * entries. 2.0.0 version will keep them unless they don't exist
                 */
                await eslint.lintParallel([badFile, goodFile]);
                fileCache = fCache.createFromFile(cacheFilePath);
                ({ cache } = fileCache);

                assert.equal
                (
                    typeof cache.getKey(testFile2),
                    'object',
                    'the entry for the test-file2 should have been in the cache',
                );
            },
        );

        it
        (
            'should not delete cache when executing on files with --cache flag',
            async () =>
            {
                cacheFilePath = getFixturePath('.eslintcache');
                await doDelete(cacheFilePath);
                assert
                (
                    !await fileExists(cacheFilePath),
                    'the cache file already exists and wasn\'t successfully deleted',
                );

                await writeFile(cacheFilePath, '');
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        cwd:            join(fixtureDir, '..'),
                        cache:          true,
                        cacheLocation:  cacheFilePath,
                        rule:
                        {
                            'no-console':       0,
                            'no-unused-vars':   2,
                        },
                    },
                );
                const file = getFixturePath('cli-engine', 'console.js');

                assert
                (await fileExists(cacheFilePath), 'the cache for eslint should exist');

                await eslint.lintParallel([file]);

                assert
                (
                    await fileExists(cacheFilePath),
                    'the cache for eslint should still exist',
                );
            },
        );

        it
        (
            'should delete cache when executing on files without --cache flag',
            async () =>
            {
                cacheFilePath = getFixturePath('.eslintcache');
                await doDelete(cacheFilePath);
                assert
                (
                    !await fileExists(cacheFilePath),
                    'the cache file already exists and wasn\'t successfully deleted',
                );

                // intenationally invalid to additionally make sure it isn't used
                await writeFile(cacheFilePath, '[]');
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        cwd:            join(fixtureDir, '..'),
                        cacheLocation:  cacheFilePath,
                        rule:
                        {
                            'no-console':       0,
                            'no-unused-vars':   2,
                        },
                    },
                );
                const file = getFixturePath('cli-engine', 'console.js');

                assert
                (await fileExists(cacheFilePath), 'the cache for eslint should exist');

                await eslint.lintParallel([file]);

                assert
                (
                    !await fileExists(cacheFilePath),
                    'the cache for eslint should have been deleted',
                );
            },
        );

        it
        (
            'should use the specified cache file',
            async () =>
            {
                cacheFilePath = resolve('.cache/custom-cache');
                await doDelete(cacheFilePath);
                assert
                (
                    !await fileExists(cacheFilePath),
                    'the cache file already exists and wasn\'t successfully deleted',
                );

                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        // specify a custom cache file
                        cacheLocation:  cacheFilePath,
                        // specifying cache true the cache will be created
                        cache:          true,
                        rule:
                        {
                            'no-console':       0,
                            'no-unused-vars':   2,
                        },
                        cwd:            join(fixtureDir, '..'),
                    },
                );
                const badFile = getFixturePath('cache/src', 'fail-file.js');
                const goodFile = getFixturePath('cache/src', 'test-file.js');
                const result = await eslint.lintParallel([badFile, goodFile]);

                assert
                (
                    await fileExists(cacheFilePath),
                    'the cache for eslint should have been created',
                );

                const fileCache = fCache.createFromFile(cacheFilePath);
                const { cache } = fileCache;

                assert
                (
                    typeof cache.getKey(goodFile) === 'object',
                    'the entry for the good file should have been in the cache',
                );
                assert
                (
                    typeof cache.getKey(badFile) === 'object',
                    'the entry for the bad file should have been in the cache',
                );

                const cachedResult = await eslint.lintParallel([badFile, goodFile]);

                assert.deepEqual
                (result, cachedResult, 'result should be the same with or without cache');
            },
        );

        // https://github.com/eslint/eslint/issues/13507
        it
        (
            'should not store `usedDeprecatedRules` in the cache file',
            async () =>
            {
                cacheFilePath = getFixturePath('.eslintcache');
                await doDelete(cacheFilePath);
                assert
                (
                    !await fileExists(cacheFilePath),
                    'the cache file already exists and wasn\'t successfully deleted',
                );

                const deprecatedRuleId = 'space-in-parens';
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        cwd:            join(fixtureDir, '..'),
                        // specifying cache true the cache will be created
                        cache:          true,
                        cacheLocation:  cacheFilePath,
                        rule:           { [deprecatedRuleId]: 2 },
                    },
                );
                const filePath = getFixturePath('cache/src', 'test-file.js');

                /*
                 * Run linting on the same file 3 times to cover multiple cases:
                 *   Run 1: Lint result wasn't already cached.
                 *   Run 2: Lint result was already cached. The cached lint result is used
                 *     but the cache is reconciled before the run ends.
                 *   Run 3: Lint result was already cached. The cached lint result was being
                 *     used throughout the previous run, so possible mutations in the
                 *     previous run that occured after the cache was reconciled may have
                 *     side effects for this run.
                 */
                for (let i = 0; i < 3; i++)
                {
                    const [result] = await eslint.lintParallel([filePath]);

                    assert
                    (
                        result.usedDeprecatedRules &&
                        result.usedDeprecatedRules.some
                        (rule => rule.ruleId === deprecatedRuleId),
                        'the deprecated rule should have been in ' +
                        'result.usedDeprecatedRules',
                    );
                    assert
                    (
                        await fileExists(cacheFilePath),
                        'the cache for eslint should have been created',
                    );

                    const fileCache = fCache.create(cacheFilePath);
                    const descriptor = fileCache.getFileDescriptor(filePath);

                    assert
                    (
                        typeof descriptor === 'object',
                        'an entry for the file should have been in the cache file',
                    );
                    assert
                    (
                        typeof descriptor.meta.results === 'object',
                        'lint result for the file should have been in its cache entry in ' +
                        'the cache file',
                    );
                    assert
                    (
                        typeof descriptor.meta.results.usedDeprecatedRules === 'undefined',
                        'lint result in the cache file contains `usedDeprecatedRules`',
                    );
                }
            },
        );

        // https://github.com/eslint/eslint/issues/13507
        it
        (
            'should store `source` as `null` in the cache file if the lint result has ' +
            '`source` property',
            async () =>
            {
                cacheFilePath = getFixturePath('.eslintcache');
                await doDelete(cacheFilePath);
                assert
                (
                    !await fileExists(cacheFilePath),
                    'the cache file already exists and wasn\'t successfully deleted',
                );

                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        cwd:            join(fixtureDir, '..'),
                        // specifying cache true the cache will be created
                        cache:          true,
                        cacheLocation:  cacheFilePath,
                        rule:           { 'no-unused-vars': 2 },
                    },
                );
                const filePath = getFixturePath('cache/src', 'fail-file.js');

                /*
                 * Run linting on the same file 3 times to cover multiple cases:
                 *   Run 1: Lint result wasn't already cached.
                 *   Run 2: Lint result was already cached. The cached lint result is used
                 *     but the cache is reconciled before the run ends.
                 *   Run 3: Lint result was already cached. The cached lint result was being
                 *     used throughout the previous run, so possible mutations in the
                 *     previous run that occured after the cache was reconciled may have
                 *     side effects for this run.
                 */
                for (let i = 0; i < 3; i++)
                {
                    const [result] = await eslint.lintParallel([filePath]);

                    assert
                    (
                        typeof result.source === 'string',
                        'the result should have contained the `source` property',
                    );

                    assert
                    (
                        await fileExists(cacheFilePath),
                        'the cache for eslint should have been created',
                    );

                    const fileCache = fCache.create(cacheFilePath);
                    const descriptor = fileCache.getFileDescriptor(filePath);

                    assert
                    (
                        typeof descriptor === 'object',
                        'an entry for the file should have been in the cache file',
                    );
                    assert
                    (
                        typeof descriptor.meta.results === 'object',
                        'lint result for the file should have been in its cache entry in ' +
                        'the cache file',
                    );
                    // if the lint result contains `source`, it should be stored as `null`
                    // in the cache file
                    assert.equal
                    (
                        descriptor.meta.results.source,
                        null,
                        'lint result in the cache file contains non-null `source`',
                    );
                }
            },
        );

        describe
        (
            'cacheStrategy',
            () =>
            {
                it
                (
                    'should detect changes using a file\'s modification time when set to ' +
                    '\'metadata\'',
                    async () =>
                    {
                        cacheFilePath = getFixturePath('.eslintcache');
                        await doDelete(cacheFilePath);
                        assert
                        (
                            !await fileExists(cacheFilePath),
                            'the cache file already exists and wasn\'t successfully ' +
                            'deleted',
                        );

                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd:            join(fixtureDir, '..'),
                                // specifying cache true the cache will be created
                                cache:          true,
                                cacheLocation:  cacheFilePath,
                                cacheStrategy:  'metadata',
                                rule:
                                {
                                    'no-console':       0,
                                    'no-unused-vars':   2,
                                },
                            },
                        );
                        const badFile = getFixturePath('cache/src', 'fail-file.js');
                        const goodFile = getFixturePath('cache/src', 'test-file.js');
                        await eslint.lintParallel([badFile, goodFile]);
                        let fileCache = fCache.createFromFile(cacheFilePath);
                        const entries = fileCache.normalizeEntries([badFile, goodFile]);

                        entries.forEach
                        (
                            entry =>
                            {
                                assert
                                (
                                    entry.changed === false,
                                    `the entry for ${entry.key} should have been ` +
                                    'initially unchanged',
                                );
                            },
                        );

                        // this should result in a changed entry
                        const now = new Date();
                        await utimes(goodFile, now, now);
                        fileCache = fCache.createFromFile(cacheFilePath);

                        assert
                        (
                            fileCache.getFileDescriptor(badFile).changed === false,
                            `the entry for ${badFile} should have been unchanged`,
                        );
                        assert
                        (
                            fileCache.getFileDescriptor(goodFile).changed === true,
                            `the entry for ${goodFile} should have been changed`,
                        );
                    },
                );

                it
                (
                    'should not detect changes using a file\'s modification time when ' +
                    'set to \'content\'',
                    async () =>
                    {
                        cacheFilePath = getFixturePath('.eslintcache');
                        await doDelete(cacheFilePath);
                        assert
                        (
                            !await fileExists(cacheFilePath),
                            'the cache file already exists and wasn\'t successfully ' +
                            'deleted',
                        );

                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd:            join(fixtureDir, '..'),
                                // specifying cache true the cache will be created
                                cache:          true,
                                cacheLocation:  cacheFilePath,
                                cacheStrategy:  'content',
                                rule:
                                {
                                    'no-console':       0,
                                    'no-unused-vars':   2,
                                },
                            },
                        );
                        const badFile = getFixturePath('cache/src', 'fail-file.js');
                        const goodFile = getFixturePath('cache/src', 'test-file.js');
                        await eslint.lintParallel([badFile, goodFile]);
                        let fileCache = fCache.createFromFile(cacheFilePath, true);
                        let entries = fileCache.normalizeEntries([badFile, goodFile]);

                        entries.forEach
                        (
                            entry =>
                            {
                                assert
                                (
                                    entry.changed === false,
                                    `the entry for ${entry.key} should have been ` +
                                    'initially unchanged',
                                );
                            },
                        );

                        // this should NOT result in a changed entry
                        const now = new Date();
                        await utimes(goodFile, now, now);
                        fileCache = fCache.createFromFile(cacheFilePath, true);
                        entries = fileCache.normalizeEntries([badFile, goodFile]);

                        entries.forEach
                        (
                            entry =>
                            {
                                assert
                                (
                                    entry.changed === false,
                                    `the entry for ${entry.key} should have remained ` +
                                    'unchanged',
                                );
                            },
                        );
                    },
                );

                it
                (
                    'should detect changes using a file\'s contents when set to ' +
                    '\'content\'',
                    async () =>
                    {
                        cacheFilePath = getFixturePath('.eslintcache');
                        await doDelete(cacheFilePath);
                        assert
                        (
                            !await fileExists(cacheFilePath),
                            'the cache file already exists and wasn\'t successfully ' +
                            'deleted',
                        );

                        eslint =
                        await ESLint.fromCLIOptions
                        (
                            {
                                cwd:            join(fixtureDir, '..'),
                                // specifying cache true the cache will be created
                                cache:          true,
                                cacheLocation:  cacheFilePath,
                                cacheStrategy:  'content',
                                rule:
                                {
                                    'no-console':       0,
                                    'no-unused-vars':   2,
                                },
                            },
                        );
                        const badFile = getFixturePath('cache/src', 'fail-file.js');
                        const goodFile = getFixturePath('cache/src', 'test-file.js');
                        const goodFileCopy =
                        join(`${dirname(goodFile)}`, 'test-file-copy.js');
                        await copyFile(goodFile, goodFileCopy);
                        await eslint.lintParallel([badFile, goodFileCopy]);
                        let fileCache = fCache.createFromFile(cacheFilePath, true);
                        const entries = fileCache.normalizeEntries([badFile, goodFileCopy]);

                        entries.forEach
                        (
                            entry =>
                            {
                                assert
                                (
                                    entry.changed === false,
                                    `the entry for ${entry.key} should have been ` +
                                    'initially unchanged',
                                );
                            },
                        );

                        // this should result in a changed entry
                        const oldContent = await readFile(goodFileCopy, 'utf8');
                        await writeFile(goodFileCopy, oldContent.replace('abc', 'xyz'));
                        fileCache = fCache.createFromFile(cacheFilePath, true);

                        assert
                        (
                            fileCache.getFileDescriptor(badFile).changed === false,
                            `the entry for ${badFile} should have been unchanged`,
                        );
                        assert
                        (
                            fileCache.getFileDescriptor(goodFileCopy).changed === true,
                            `the entry for ${goodFileCopy} should have been changed`,
                        );
                    },
                );
            },
        );
    },
);

// Custom tests

describe
(
    'Fix types when \'quiet\' option is true',
    () =>
    {
        let eslint;

        useFixtures();

        it
        (
            'should fix all except one problem when \'fixType\' array has only \'suggestion\'',
            async () =>
            {
                eslint =
                await ESLint.fromCLIOptions
                (
                    {
                        cwd:        join(fixtureDir, '..'),
                        fix:        true,
                        fixType:    ['suggestion'],
                        quiet:      true,
                    },
                );
                const inputPath =
                getFixturePath('fix-types/fix-all-except-unicode-bom.js');
                const outputPath =
                getFixturePath('fix-types/fix-all-except-unicode-bom.expected.js');
                const results = await eslint.lintParallel([inputPath]);
                const expectedOutput = await readFile(outputPath, 'utf8');

                assert.equal(results[0].output, expectedOutput);
            },
        );
    },
);

describe
(
    'Cache file deletion',
    () =>
    {
        let cacheFilePath;
        let eslint;

        useFixtures();

        afterEach
        (
            async () =>
            {
                if (cacheFilePath)
                    await rm(cacheFilePath, { force: true, recursive: true });
                cacheFilePath = undefined;
            },
        );

        it
        (
            'should throw an error if the cache file cannot be deleted',
            async () =>
            {
                cacheFilePath = getFixturePath('.eslintcache');
                await rm(cacheFilePath, { force: true, recursive: true });
                assert
                (
                    !await fileExists(cacheFilePath),
                    'the cache file already exists and wasn\'t successfully deleted',
                );

                const error = Object.assign(Error('access denied'), { code: 'EACCES' });
                sinon.stub(fsPromises, 'unlink').rejects(error);
                const cliOptions =
                {
                    // specifying cache false the cache will be deleted
                    cache:          false,
                    cacheLocation:  cacheFilePath,
                    rule:
                    {
                        'no-console':       0,
                        'no-unused-vars':   2,
                    },
                    cwd:            join(fixtureDir, '..'),
                };
                eslint = await ESLint.fromCLIOptions(cliOptions);
                const file = getFixturePath('cache/src', 'test-file.js');
                await assert.rejects(eslint.lintParallel([file]), error);
            },
        );
    },
);
