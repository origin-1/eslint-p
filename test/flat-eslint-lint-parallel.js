/* globals after, afterEach, before, beforeEach, describe, it */

import assert                                           from 'node:assert';

import { mkdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync }
from 'node:fs';

import fsPromises, { rm }                               from 'node:fs/promises';
import { platform, tmpdir }                             from 'node:os';
import { basename, dirname, join, relative, resolve }   from 'node:path';
import { fileURLToPath }                                from 'node:url';
import eslintDirURL                                     from '../lib/default-eslint-dir-url.js';
import patchFlatESLint                                  from '../lib/patch-flat-eslint.js';
import { createCustomTeardown, unIndent }               from './_utils/index.js';
import fCache                                           from 'file-entry-cache';
import murmur                                           from 'imurmurhash';
import shell                                            from 'shelljs';
import sinon                                            from 'sinon';

async function getFlatESLint()
{
    const { default: { FlatESLint } } = await import('eslint/use-at-your-own-risk');
    await patchFlatESLint(FlatESLint, eslintDirURL);
    return FlatESLint;
}

const FlatESLint = await getFlatESLint();

const examplePluginName = 'eslint-plugin-example';
const examplePluginNameWithNamespace = '@eslint/eslint-plugin-example';
const examplePreprocessorName = 'eslint-plugin-processor';
const fixtureDir = join(realpathSync(tmpdir()), 'eslint/fixtures');
const originalDir = process.cwd();

/**
 * Creates a directory if it doesn't already exist.
 * @param {string} dirPath The path to the directory that should exist.
 * @returns {void}
 */
function ensureDirectoryExists(dirPath)
{
    try
    {
        statSync(dirPath);
    }
    catch
    {
        mkdirSync(dirPath);
    }
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
    await FlatESLint.fromCLIOptions
    (
        {
            ...options,
            plugin:
            [
                examplePluginName,
                examplePluginNameWithNamespace,
                examplePreprocessorName,
            ],
            resolvePluginsRelativeTo: getFixturePath('plugins'),
        },
    );
    return engine;
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

/**
 * hash the given string
 * @param {string} str the string to hash
 * @returns {string} the hash
 */
function hash(str)
{
    return murmur(str).result().toString(36);
}

// copy into clean area so as not to get "infected" by this project's .eslintrc files
function setUpFixtures()
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
}

function tearDownFixtures()
{
    shell.rm('-r', fixtureDir);
}

describe
(
    'lintParallel()',
    () =>
    {
        let eslint;

        before(setUpFixtures);

        after(tearDownFixtures);

        it
        (
            'should use correct parser when custom parser is specified',
            async () =>
            {
                const parserURL =
                new URL('./fixtures/configurations/parser/custom.js', import.meta.url);
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:    originalDir,
                        ignore: false,
                        parser: fileURLToPath(parserURL),
                    },
                );
                const results = await eslint.lintParallel([fileURLToPath(import.meta.url)]);

                assert.strictEqual(results.length, 1);
                assert.strictEqual(results[0].messages.length, 1);
                assert.strictEqual(results[0].messages[0].message, 'Parsing error: Boom!');
                assert.strictEqual(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should report zero messages when given a config file and a valid file',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:    originalDir,
                        config: 'test/fixtures/simple-valid-project/eslint.config.js',
                    },
                );
                const results =
                await eslint.lintParallel(['test/fixtures/simple-valid-project/**/foo*.js']);

                assert.strictEqual(results.length, 2);
                assert.strictEqual(results[0].messages.length, 0);
                assert.strictEqual(results[1].messages.length, 0);
                assert.strictEqual(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should handle multiple patterns with overlapping files',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
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

                assert.strictEqual(results.length, 2);
                assert.strictEqual(results[0].messages.length, 0);
                assert.strictEqual(results[1].messages.length, 0);
                assert.strictEqual(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should report zero messages when given a config file and a valid file and espree as ' +
            'parser',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        overrideConfig:
                        { languageOptions: { parserOptions: { ecmaVersion: 2022 } } },
                        parser: 'espree',
                    },
                );
                const results = await eslint.lintParallel(['lib/eslint-p.js']);

                assert.strictEqual(results.length, 1);
                assert.strictEqual(results[0].messages.length, 0);
                assert.strictEqual(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should report zero messages when given a config file and a valid file and esprima ' +
            'as parser',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        parser: 'esprima',
                        ignore: false,
                    },
                );
                const results = await eslint.lintParallel(['test/fixtures/passing.js']);

                assert.strictEqual(results.length, 1);
                assert.strictEqual(results[0].messages.length, 0);
                assert.strictEqual(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should throw if eslint.config.js file is not present',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:            getFixturePath('..'),
                        configLookup:   true,
                    },
                );
                await assert.rejects
                (() => eslint.lintParallel('fixtures/undef*.js'), /Could not find config file/u);
            },
        );

        it
        (
            'should not throw if eslint.config.js file is not present and overrideConfigFile is ' +
            '`true`',
            async () =>
            {
                eslint = await FlatESLint.fromCLIOptions({ cwd: getFixturePath('..') });
                await eslint.lintParallel('fixtures/undef*.js');
            },
        );

        it
        (
            'should not throw if eslint.config.js file is not present and overrideConfigFile is ' +
            'path to a config file',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:    getFixturePath('..'),
                        config: 'fixtures/configurations/quotes-error.js',
                    },
                );
                await eslint.lintParallel('fixtures/undef*.js');
            },
        );

        it
        (
            'should throw if overrideConfigFile is path to a file that doesn\'t exist',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:    getFixturePath(),
                        config: 'does-not-exist.js',
                    },
                );
                await assert.rejects(() => eslint.lintParallel('undef*.js'), { code: 'ENOENT' });
            },
        );

        it
        (
            'should throw an error when given a config file and a valid file and invalid parser',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                ({ overrideConfig: { languageOptions: { parser: 'test11' } } });
                await assert.rejects
                (
                    async () => await eslint.lintParallel(['lib/eslint-p.js']),
                    /Expected object with parse\(\) or parseForESLint\(\) method/u,
                );
            },
        );

        it
        (
            'should report zero messages when given a directory with a .js2 file',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:                join(fixtureDir, '..'),
                        config:             getFixturePath('eslint.config.js'),
                        overrideConfig:     { files: ['**/*.js2'] },
                    },
                );
                const results = await eslint.lintParallel([getFixturePath('files/foo.js2')]);

                assert.strictEqual(results.length, 1);
                assert.strictEqual(results[0].messages.length, 0);
                assert.strictEqual(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should report zero messages when given a directory with a .js and a .js2 file',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        ignore:             false,
                        cwd:                getFixturePath('..'),
                        overrideConfig:     { files: ['**/*.js', '**/*.js2'] },
                        config:             getFixturePath('eslint.config.js'),
                    },
                );
                const results = await eslint.lintParallel(['fixtures/files/']);

                assert.strictEqual(results.length, 3);
                assert.strictEqual(results[0].messages.length, 0);
                assert.strictEqual(results[1].messages.length, 0);
                assert.strictEqual(results[0].suppressedMessages.length, 0);
            },
        );

        // https://github.com/eslint/eslint/issues/16413
        it
        (
            'should find files and report zero messages when given a parent directory with a .js',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        ignore:         false,
                        cwd:            getFixturePath('example-app/subdir'),
                        configLookup:   true,
                    },
                );
                const results = await eslint.lintParallel(['../*.js']);

                assert.strictEqual(results.length, 2);
                assert.strictEqual(results[0].messages.length, 0);
                assert.strictEqual(results[0].suppressedMessages.length, 0);
                assert.strictEqual(results[1].messages.length, 0);
                assert.strictEqual(results[1].suppressedMessages.length, 0);
            },
        );

        // https://github.com/eslint/eslint/issues/16038
        it
        (
            'should allow files patterns with \'..\' inside',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        ignore:         false,
                        cwd:            getFixturePath('dots-in-files'),
                        configLookup:   true,
                    },
                );
                const results = await eslint.lintParallel(['.']);

                assert.strictEqual(results.length, 2);
                assert.strictEqual(results[0].messages.length, 0);
                assert.strictEqual(results[0].filePath, getFixturePath('dots-in-files/a..b.js'));
                assert.strictEqual(results[0].suppressedMessages.length, 0);
            },
        );

        // https://github.com/eslint/eslint/issues/16299
        it
        (
            'should only find files in the subdir1 directory when given a directory name',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        ignore:         false,
                        cwd:            getFixturePath('example-app2'),
                        configLookup:   true,
                    },
                );
                const results = await eslint.lintParallel(['subdir1']);

                assert.strictEqual(results.length, 1);
                assert.strictEqual(results[0].messages.length, 0);
                assert.strictEqual
                (results[0].filePath, getFixturePath('example-app2/subdir1/a.js'));
                assert.strictEqual(results[0].suppressedMessages.length, 0);
            },
        );

        // https://github.com/eslint/eslint/issues/14742
        it
        (
            'should run',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:            getFixturePath('{curly-path}', 'server'),
                        configLookup:   true,
                    },
                );
                const results = await eslint.lintParallel(['src/**/*.{js,json}']);

                assert.strictEqual(results.length, 1);
                assert.strictEqual(results[0].messages.length, 1);
                assert.strictEqual(results[0].messages[0].ruleId, 'no-console');
                assert.strictEqual
                (
                    results[0].filePath,
                    getFixturePath('{curly-path}/server/src/two.js'),
                );
                assert.strictEqual(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should work with config file that exports a promise',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:            getFixturePath('promise-config'),
                        configLookup:   true,
                    },
                );
                const results = await eslint.lintParallel(['a*.js']);

                assert.strictEqual(results.length, 1);
                assert.strictEqual(results[0].filePath, getFixturePath('promise-config', 'a.js'));
                assert.strictEqual(results[0].messages.length, 1);
                assert.strictEqual(results[0].messages[0].severity, 2);
                assert.strictEqual(results[0].messages[0].ruleId, 'quotes');
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
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath('dot-files'),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['.']);

                        assert.strictEqual(results.length, 3);
                        assert.strictEqual(results[0].messages.length, 0);
                        assert.strictEqual(results[0].filePath, getFixturePath('dot-files/.a.js'));
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
                        assert.strictEqual(results[1].messages.length, 0);
                        assert.strictEqual(results[1].filePath, getFixturePath('dot-files/.c.js'));
                        assert.strictEqual(results[1].suppressedMessages.length, 0);
                        assert.strictEqual(results[2].messages.length, 0);
                        assert.strictEqual(results[2].filePath, getFixturePath('dot-files/b.js'));
                        assert.strictEqual(results[2].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should find dot files in current directory when a *.js pattern is used',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath('dot-files'),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['*.js']);

                        assert.strictEqual(results.length, 3);
                        assert.strictEqual(results[0].messages.length, 0);
                        assert.strictEqual(results[0].filePath, getFixturePath('dot-files/.a.js'));
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
                        assert.strictEqual(results[1].messages.length, 0);
                        assert.strictEqual(results[1].filePath, getFixturePath('dot-files/.c.js'));
                        assert.strictEqual(results[1].suppressedMessages.length, 0);
                        assert.strictEqual(results[2].messages.length, 0);
                        assert.strictEqual(results[2].filePath, getFixturePath('dot-files/b.js'));
                        assert.strictEqual(results[2].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should find dot files in current directory when a .a.js pattern is used',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath('dot-files'),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['.a.js']);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].messages.length, 0);
                        assert.strictEqual(results[0].filePath, getFixturePath('dot-files/.a.js'));
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
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
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                ignore:         false,
                                cwd:            getFixturePath('example-app2'),
                                configLookup:   true,
                            },
                        );
                        await assert.rejects
                        (
                            async () =>
                            { await eslint.lintParallel(['subdir1', 'doesnotexist/*.js']); },
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
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath('example-app2'),
                                overrideConfig: { ignores: ['subdir2'] },
                                configLookup:   true,
                            },
                        );
                        await assert.rejects
                        (
                            async () =>
                            { await eslint.lintParallel(['subdir1/*.js', 'subdir2/*.js']); },
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
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath('example-app2'),
                                overrideConfig: { ignores: ['subdir2/*.js'] },
                                configLookup:   true,
                            },
                        );
                        await assert.rejects
                        (
                            async () =>
                            { await eslint.lintParallel(['subdir1/*.js', 'subdir2/*.js']); },
                            /All files matched by 'subdir2\/\*\.js' are ignored/u,
                        );
                    },
                );

                it
                (
                    'should always throw an error for the first unmatched file pattern',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath('example-app2'),
                                overrideConfig: { ignores: ['subdir1/*.js', 'subdir2/*.js'] },
                                configLookup:   true,
                            },
                        );
                        await assert.rejects
                        (
                            async () =>
                            {
                                await eslint.lintParallel
                                (['doesnotexist1/*.js', 'doesnotexist2/*.js']);
                            },
                            /No files matching 'doesnotexist1\/\*\.js' were found/u,
                        );
                        await assert.rejects
                        (
                            async () =>
                            { await eslint.lintParallel(['doesnotexist1/*.js', 'subdir1/*.js']); },
                            /No files matching 'doesnotexist1\/\*\.js' were found/u,
                        );
                        await assert.rejects
                        (
                            async () =>
                            { await eslint.lintParallel(['subdir1/*.js', 'doesnotexist1/*.js']); },
                            /All files matched by 'subdir1\/\*\.js' are ignored/u,
                        );
                        await assert.rejects
                        (
                            async () =>
                            { await eslint.lintParallel(['subdir1/*.js', 'subdir2/*.js']); },
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
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:                        getFixturePath('example-app2'),
                                overrideConfig:             { ignores: ['subdir2/*.js'] },
                                errorOnUnmatchedPattern:    false,
                                configLookup:               true,
                            },
                        );
                        const results = await eslint.lintParallel(['subdir2/*.js']);

                        assert.strictEqual(results.length, 0);
                    },
                );

                it
                (
                    'should not throw an error for a non-existing file pattern when ' +
                    'errorOnUnmatchedPattern is false',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:                        getFixturePath('example-app2'),
                                errorOnUnmatchedPattern:    false,
                                configLookup:               true,
                            },
                        );
                        const results = await eslint.lintParallel(['doesexist/*.js']);

                        assert.strictEqual(results.length, 0);
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
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                ignore:         false,
                                cwd:            getFixturePath('shallow-glob'),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['target-dir']);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].messages.length, 0);
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should glob for .jsx file in a subdirectory of the passed-in directory and ' +
                    'not glob for any other patterns',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                ignore:             false,
                                overrideConfig:
                                {
                                    files:              ['subdir/**/*.jsx', 'target-dir/*.js'],
                                    languageOptions:    { parserOptions: { jsx: true } },
                                },
                                cwd:                getFixturePath('shallow-glob'),
                            },
                        );
                        const results = await eslint.lintParallel(['subdir/subsubdir']);

                        assert.strictEqual(results.length, 2);
                        assert.strictEqual(results[0].messages.length, 1);
                        assert.strictEqual
                        (
                            results[0].filePath,
                            getFixturePath('shallow-glob/subdir/subsubdir/broken.js'),
                        );
                        assert(results[0].messages[0].fatal, 'Fatal error expected.');
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
                        assert.strictEqual
                        (
                            results[1].filePath,
                            getFixturePath('shallow-glob/subdir/subsubdir/plain.jsx'),
                        );
                        assert.strictEqual(results[1].messages.length, 0);
                        assert.strictEqual(results[1].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should glob for all files in subdir when passed-in on the command line with ' +
                    'a partial matching glob',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                ignore:             false,
                                overrideConfig:
                                {
                                    files:              ['s*/subsubdir/*.jsx', 'target-dir/*.js'],
                                    languageOptions:    { parserOptions: { jsx: true } },
                                },
                                cwd:                getFixturePath('shallow-glob'),
                            },
                        );
                        const results = await eslint.lintParallel(['subdir']);

                        assert.strictEqual(results.length, 3);
                        assert.strictEqual(results[0].messages.length, 1);
                        assert(results[0].messages[0].fatal, 'Fatal error expected.');
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
                        assert.strictEqual(results[1].messages.length, 1);
                        assert(results[0].messages[0].fatal, 'Fatal error expected.');
                        assert.strictEqual(results[1].suppressedMessages.length, 0);
                        assert.strictEqual(results[2].messages.length, 0);
                        assert.strictEqual(results[2].suppressedMessages.length, 0);
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
                await FlatESLint.fromCLIOptions
                (
                    {
                        ignore:         false,
                        cwd:            join(fixtureDir, '..'),
                        overrideConfig: { files: ['**/*.js', '**/*.js2'] },
                        config:         getFixturePath('eslint.config.js'),
                    },
                );
                const results = await eslint.lintParallel(['fixtures/files/*']);

                assert.strictEqual(results.length, 3);
                assert.strictEqual(results[0].messages.length, 0);
                assert.strictEqual(results[1].messages.length, 0);
                assert.strictEqual(results[2].messages.length, 0);
                assert.strictEqual(results[0].suppressedMessages.length, 0);
                assert.strictEqual(results[1].suppressedMessages.length, 0);
                assert.strictEqual(results[2].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should resolve globs when \'globInputPaths\' option is true',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        ignore:         false,
                        cwd:            getFixturePath('..'),
                        overrideConfig: { files: ['**/*.js', '**/*.js2'] },
                        config:         getFixturePath('eslint.config.js'),
                    },
                );
                const results = await eslint.lintParallel(['fixtures/files/*']);

                assert.strictEqual(results.length, 3);
                assert.strictEqual(results[0].messages.length, 0);
                assert.strictEqual(results[1].messages.length, 0);
                assert.strictEqual(results[2].messages.length, 0);
                assert.strictEqual(results[0].suppressedMessages.length, 0);
                assert.strictEqual(results[1].suppressedMessages.length, 0);
                assert.strictEqual(results[2].suppressedMessages.length, 0);
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
                    await FlatESLint.fromCLIOptions
                    (
                        {
                            ignore:         false,
                            cwd:            getFixturePath('..'),
                            overrideConfig: { files: ['**/*.js', '**/*.js2'] },
                            config:         getFixturePath('eslint.config.js'),
                        },
                    );
                    const results = await eslint.lintParallel(['fixtures\\files\\*']);

                    assert.strictEqual(results.length, 3);
                    assert.strictEqual(results[0].messages.length, 0);
                    assert.strictEqual(results[1].messages.length, 0);
                    assert.strictEqual(results[2].messages.length, 0);
                    assert.strictEqual(results[0].suppressedMessages.length, 0);
                    assert.strictEqual(results[1].suppressedMessages.length, 0);
                    assert.strictEqual(results[2].suppressedMessages.length, 0);
                },
            );
        }

        it
        (
            'should not resolve globs when \'globInputPaths\' option is false',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        ignore:             false,
                        cwd:                getFixturePath('..'),
                        overrideConfig:     { files: ['**/*.js', '**/*.js2'] },
                        globInputPaths:     false,
                    },
                );
                await assert.rejects
                (
                    async () => { await eslint.lintParallel(['fixtures/files/*']); },
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
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath('cli-engine'),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['node_modules/foo.js']);
                        const expectedMsg =
                        'File ignored by default because it is located under the node_modules ' +
                        'directory. Use ignore pattern "!**/node_modules/" to disable file ' +
                        'ignore settings or use "--no-warn-ignored" to suppress this warning.';

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].errorCount, 0);
                        assert.strictEqual(results[0].warningCount, 1);
                        assert.strictEqual(results[0].fatalErrorCount, 0);
                        assert.strictEqual(results[0].fixableErrorCount, 0);
                        assert.strictEqual(results[0].fixableWarningCount, 0);
                        assert.strictEqual(results[0].messages[0].severity, 1);
                        assert.strictEqual(results[0].messages[0].message, expectedMsg);
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should report on a file in a node_modules subfolder passed explicitly, even ' +
                    'if ignored by default',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath('cli-engine'),
                                configLookup:   true,
                            },
                        );
                        const results =
                        await eslint.lintParallel
                        (['nested_node_modules/subdir/node_modules/text.js']);
                        const expectedMsg =
                        'File ignored by default because it is located under the node_modules ' +
                        'directory. Use ignore pattern "!**/node_modules/" to disable file ' +
                        'ignore settings or use "--no-warn-ignored" to suppress this warning.';

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].errorCount, 0);
                        assert.strictEqual(results[0].warningCount, 1);
                        assert.strictEqual(results[0].fatalErrorCount, 0);
                        assert.strictEqual(results[0].fixableErrorCount, 0);
                        assert.strictEqual(results[0].fixableWarningCount, 0);
                        assert.strictEqual(results[0].messages[0].severity, 1);
                        assert.strictEqual(results[0].messages[0].message, expectedMsg);
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should report on an ignored file with "node_modules" in its name',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath('cli-engine'),
                                ignorePattern:  ['*.js'],
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['node_modules_cleaner.js']);
                        const expectedMsg =
                        'File ignored because of a matching ignore pattern. Use "--no-ignore" to ' +
                        'disable file ignore settings or use "--no-warn-ignored" to suppress ' +
                        'this warning.';

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].errorCount, 0);
                        assert.strictEqual(results[0].warningCount, 1);
                        assert.strictEqual(results[0].fatalErrorCount, 0);
                        assert.strictEqual(results[0].fixableErrorCount, 0);
                        assert.strictEqual(results[0].fixableWarningCount, 0);
                        assert.strictEqual(results[0].messages[0].severity, 1);
                        assert.strictEqual(results[0].messages[0].message, expectedMsg);
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should suppress the warning when a file in the node_modules folder passed ' +
                    'explicitly and warnIgnored is false',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath('cli-engine'),
                                warnIgnored:    false,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['node_modules/foo.js']);

                        assert.strictEqual(results.length, 0);
                    },
                );

                it
                (
                    'should report on globs with explicit inclusion of dotfiles',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath('cli-engine'),
                                overrideConfig: { rules: { quotes: [2, 'single'] } },
                            },
                        );
                        const results = await eslint.lintParallel(['hidden/.hiddenfolder/*.js']);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].errorCount, 1);
                        assert.strictEqual(results[0].warningCount, 0);
                        assert.strictEqual(results[0].fatalErrorCount, 0);
                        assert.strictEqual(results[0].fixableErrorCount, 1);
                        assert.strictEqual(results[0].fixableWarningCount, 0);
                    },
                );

                it
                (
                    'should ignore node_modules files when using ignore file',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions({ cwd: getFixturePath('cli-engine') });
                        await assert.rejects
                        (
                            async () => { await eslint.lintParallel(['node_modules']); },
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
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath('cli-engine'),
                                ignore:         false,
                                configLookup:   true,
                            },
                        );
                        await assert.rejects
                        (
                            async () => { await eslint.lintParallel(['node_modules']); },
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
                        await FlatESLint.fromCLIOptions
                        ({ config: getFixturePath('eslint.config_with_ignores.js') });
                        await assert.rejects
                        (
                            async () =>
                            { await eslint.lintParallel(['test/fixtures/cli-engine/']); },
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
                        await FlatESLint.fromCLIOptions
                        ({ config: getFixturePath('eslint.config_with_ignores.js') });
                        const expectedRegExp =
                        /All files matched by '\.\/test\/fixtures\/cli-engine\/' are ignored\./u;
                        await assert.rejects
                        (
                            async () =>
                            { await eslint.lintParallel(['./test/fixtures/cli-engine/']); },
                            expectedRegExp,
                        );
                    },
                );

                // https://github.com/eslint/eslint/issues/3788
                it
                (
                    'should ignore one-level down node_modules by default',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                overrideConfig: { rules: { quotes: [2, 'double'] } },
                                cwd:            getFixturePath('cli-engine', 'nested_node_modules'),
                            },
                        );
                        const results = await eslint.lintParallel(['.']);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].errorCount, 0);
                        assert.strictEqual(results[0].warningCount, 0);
                        assert.strictEqual(results[0].fatalErrorCount, 0);
                        assert.strictEqual(results[0].fixableErrorCount, 0);
                        assert.strictEqual(results[0].fixableWarningCount, 0);
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                config:
                                getFixturePath('cli-engine/eslint.config_with_ignores2.js'),
                                overrideConfig: { rules: { quotes: [2, 'double'] } },
                            },
                        );
                        const expectedRegExp =
                        /All files matched by '\.\/test\/fixtures\/cli-engine\/' are ignored\./u;
                        await assert.rejects
                        (
                            async () =>
                            { await eslint.lintParallel(['./test/fixtures/cli-engine/']); },
                            expectedRegExp,
                        );
                    },
                );

                it
                (
                    'should throw an error when all given files are ignored via ignorePatterns',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        ({ ignorePattern: ['test/fixtures/single-quoted.js'] });
                        await assert.rejects
                        (
                            async () =>
                            { await eslint.lintParallel(['test/fixtures/*-quoted.js']); },
                            /All files matched by 'test\/fixtures\/\*-quoted\.js' are ignored\./u,
                        );
                    },
                );

                it
                (
                    'should return a warning when an explicitly given file is ignored',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                config: 'eslint.config_with_ignores.js',
                                cwd:    getFixturePath(),
                            },
                        );
                        const filePath = getFixturePath('passing.js');
                        const results = await eslint.lintParallel([filePath]);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].filePath, filePath);
                        assert.strictEqual(results[0].messages[0].severity, 1);
                        assert.strictEqual
                        (
                            results[0].messages[0].message,
                            'File ignored because of a matching ignore pattern. Use ' +
                            '"--no-ignore" to disable file ignore settings or use ' +
                            '"--no-warn-ignored" to suppress this warning.',
                        );
                        assert.strictEqual(results[0].errorCount, 0);
                        assert.strictEqual(results[0].warningCount, 1);
                        assert.strictEqual(results[0].fatalErrorCount, 0);
                        assert.strictEqual(results[0].fixableErrorCount, 0);
                        assert.strictEqual(results[0].fixableWarningCount, 0);
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should suppress the warning when an explicitly given file is ignored and ' +
                    'warnIgnored is false',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                config:         'eslint.config_with_ignores.js',
                                cwd:            getFixturePath(),
                                warnIgnored:    false,
                            },
                        );
                        const filePath = getFixturePath('passing.js');
                        const results = await eslint.lintParallel([filePath]);

                        assert.strictEqual(results.length, 0);
                    },
                );

                it
                (
                    'should return a warning about matching ignore patterns when an explicitly ' +
                    'given dotfile is ignored',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                config: 'eslint.config_with_ignores.js',
                                cwd:    getFixturePath(),
                            },
                        );
                        const filePath = getFixturePath('dot-files/.a.js');
                        const results = await eslint.lintParallel([filePath]);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].filePath, filePath);
                        assert.strictEqual(results[0].messages[0].severity, 1);
                        assert.strictEqual
                        (
                            results[0].messages[0].message,
                            'File ignored because of a matching ignore pattern. Use ' +
                            '"--no-ignore" to disable file ignore settings or use ' +
                            '"--no-warn-ignored" to suppress this warning.',
                        );
                        assert.strictEqual(results[0].errorCount, 0);
                        assert.strictEqual(results[0].warningCount, 1);
                        assert.strictEqual(results[0].fatalErrorCount, 0);
                        assert.strictEqual(results[0].fixableErrorCount, 0);
                        assert.strictEqual(results[0].fixableWarningCount, 0);
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should return two messages when given a file in excluded files list while ' +
                    'ignore is off',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath(),
                                ignore:         false,
                                config:         getFixturePath('eslint.config_with_ignores.js'),
                                overrideConfig: { rules: { 'no-undef': 2 } },
                            },
                        );
                        const filePath = getFixturePath('undef.js');
                        const results = await eslint.lintParallel([filePath]);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].filePath, filePath);
                        assert.strictEqual(results[0].messages[0].ruleId, 'no-undef');
                        assert.strictEqual(results[0].messages[0].severity, 2);
                        assert.strictEqual(results[0].messages[1].ruleId, 'no-undef');
                        assert.strictEqual(results[0].messages[1].severity, 2);
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
                    },
                );

                // https://github.com/eslint/eslint/issues/16300
                it
                (
                    'should process ignore patterns relative to basePath not cwd',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath('ignores-relative/subdir'),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['**/*.js']);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath('ignores-directory'),
                                configLookup:   true,
                            },
                        );
                        await assert.rejects
                        (
                            async () => { await eslint.lintParallel(['subdir/**']); },
                            /All files matched by 'subdir\/\*\*' are ignored\./u,
                        );
                        await assert.rejects
                        (
                            async () => { await eslint.lintParallel(['subdir/subsubdir/**']); },
                            /All files matched by 'subdir\/subsubdir\/\*\*' are ignored\./u,
                        );
                        const results = await eslint.lintParallel(['subdir/subsubdir/a.js']);
                        assert.strictEqual(results.length, 1);
                        assert.strictEqual
                        (
                            results[0].filePath,
                            getFixturePath('ignores-directory/subdir/subsubdir/a.js'),
                        );
                        assert.strictEqual(results[0].warningCount, 1);
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath('ignores-subdirectory'),
                                configLookup:   true,
                            },
                        );
                        await assert.rejects
                        (
                            async () => { await eslint.lintParallel(['subdir/**/*.js']); },
                            /All files matched by 'subdir\/\*\*\/\*\.js' are ignored\./u,
                        );
                        const results = await eslint.lintParallel(['subdir/subsubdir/a.js']);
                        assert.strictEqual(results.length, 1);
                        assert.strictEqual
                        (
                            results[0].filePath,
                            getFixturePath('ignores-subdirectory/subdir/subsubdir/a.js'),
                        );
                        assert.strictEqual(results[0].warningCount, 1);
                        assert
                        (
                            results[0].messages[0].message.startsWith('File ignored'),
                            'Should contain file ignored warning',
                        );

                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath('ignores-subdirectory/subdir'),
                                configLookup:   true,
                            },
                        );
                        await assert.rejects
                        (
                            async () => { await eslint.lintParallel(['subsubdir/**/*.js']); },
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            getFixturePath('ignores-self'),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['*.js']);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual
                        (results[0].filePath, getFixturePath('ignores-self/eslint.config.js'));
                        assert.strictEqual(results[0].errorCount, 0);
                        assert.strictEqual(results[0].warningCount, 0);
                    },
                );

                // https://github.com/eslint/eslint/issues/16416
                it
                (
                    'should allow reignoring of previously ignored files',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd: getFixturePath('ignores-relative'),
                                overrideConfig:
                                {
                                    ignores:
                                    [
                                        '*.js',
                                        '!a*.js',
                                        'a.js',
                                    ],
                                },
                            },
                        );
                        const results = await eslint.lintParallel(['a.js']);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].errorCount, 0);
                        assert.strictEqual(results[0].warningCount, 1);
                        assert.strictEqual
                        (results[0].filePath, getFixturePath('ignores-relative/a.js'));
                    },
                );

                // https://github.com/eslint/eslint/issues/16415
                it
                (
                    'should allow directories to be unignored',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd: getFixturePath('ignores-directory'),
                                overrideConfig:
                                {
                                    ignores:
                                    [
                                        'subdir/*',
                                        '!subdir/subsubdir',
                                    ],
                                },
                            },
                        );
                        const results = await eslint.lintParallel(['subdir/**/*.js']);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].errorCount, 0);
                        assert.strictEqual(results[0].warningCount, 0);
                        assert.strictEqual
                        (
                            results[0].filePath,
                            getFixturePath('ignores-directory/subdir/subsubdir/a.js'),
                        );
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
                await FlatESLint.fromCLIOptions
                (
                    {
                        overrideConfig: { files: ['**/*.js', '**/*.js2'] },
                        ignore:         false,
                        cwd:            join(fixtureDir, '..'),
                    },
                );
                const results = await eslint.lintParallel(['fixtures/files/*.?s*']);

                assert.strictEqual(results.length, 3);
                assert.strictEqual(results[0].messages.length, 0);
                assert.strictEqual(results[0].suppressedMessages.length, 0);
                assert.strictEqual(results[1].messages.length, 0);
                assert.strictEqual(results[1].suppressedMessages.length, 0);
                assert.strictEqual(results[2].messages.length, 0);
                assert.strictEqual(results[2].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should return one error message when given a config with rules with options and ' +
            'severity level set to error',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:            getFixturePath(),
                        overrideConfig: { rules: { quotes: ['error', 'double'] } },
                        ignore:         false,
                    },
                );
                const results = await eslint.lintParallel([getFixturePath('single-quoted.js')]);

                assert.strictEqual(results.length, 1);
                assert.strictEqual(results[0].messages.length, 1);
                assert.strictEqual(results[0].messages[0].ruleId, 'quotes');
                assert.strictEqual(results[0].messages[0].severity, 2);
                assert.strictEqual(results[0].errorCount, 1);
                assert.strictEqual(results[0].warningCount, 0);
                assert.strictEqual(results[0].fatalErrorCount, 0);
                assert.strictEqual(results[0].fixableErrorCount, 1);
                assert.strictEqual(results[0].fixableWarningCount, 0);
                assert.strictEqual(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should return 5 results when given a config and a directory of 5 valid files',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd: join(fixtureDir, '..'),
                        overrideConfig:
                        {
                            rules:
                            {
                                semi:   1,
                                strict: 0,
                            },
                        },
                    },
                );

                const formattersDir = getFixturePath('formatters');
                const results = await eslint.lintParallel([formattersDir]);

                assert.strictEqual(results.length, 5);
                assert.strictEqual(relative(formattersDir, results[0].filePath), 'async.js');
                assert.strictEqual(results[0].errorCount, 0);
                assert.strictEqual(results[0].warningCount, 0);
                assert.strictEqual(results[0].fatalErrorCount, 0);
                assert.strictEqual(results[0].fixableErrorCount, 0);
                assert.strictEqual(results[0].fixableWarningCount, 0);
                assert.strictEqual(results[0].messages.length, 0);
                assert.strictEqual(results[0].suppressedMessages.length, 0);
                assert.strictEqual(relative(formattersDir, results[1].filePath), 'broken.js');
                assert.strictEqual(results[1].errorCount, 0);
                assert.strictEqual(results[1].warningCount, 0);
                assert.strictEqual(results[1].fatalErrorCount, 0);
                assert.strictEqual(results[1].fixableErrorCount, 0);
                assert.strictEqual(results[1].fixableWarningCount, 0);
                assert.strictEqual(results[1].messages.length, 0);
                assert.strictEqual(results[1].suppressedMessages.length, 0);
                assert.strictEqual(relative(formattersDir, results[2].filePath), 'cwd.js');
                assert.strictEqual(results[2].errorCount, 0);
                assert.strictEqual(results[2].warningCount, 0);
                assert.strictEqual(results[2].fatalErrorCount, 0);
                assert.strictEqual(results[2].fixableErrorCount, 0);
                assert.strictEqual(results[2].fixableWarningCount, 0);
                assert.strictEqual(results[2].messages.length, 0);
                assert.strictEqual(results[2].suppressedMessages.length, 0);
                assert.strictEqual(relative(formattersDir, results[3].filePath), 'simple.js');
                assert.strictEqual(results[3].errorCount, 0);
                assert.strictEqual(results[3].warningCount, 0);
                assert.strictEqual(results[3].fatalErrorCount, 0);
                assert.strictEqual(results[3].fixableErrorCount, 0);
                assert.strictEqual(results[3].fixableWarningCount, 0);
                assert.strictEqual(results[3].messages.length, 0);
                assert.strictEqual(results[3].suppressedMessages.length, 0);
                assert.strictEqual
                (relative(formattersDir, results[4].filePath), join('test', 'simple.js'));
                assert.strictEqual(results[4].errorCount, 0);
                assert.strictEqual(results[4].warningCount, 0);
                assert.strictEqual(results[4].fatalErrorCount, 0);
                assert.strictEqual(results[4].fixableErrorCount, 0);
                assert.strictEqual(results[4].fixableWarningCount, 0);
                assert.strictEqual(results[4].messages.length, 0);
                assert.strictEqual(results[4].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should return zero messages when given a config with browser globals',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:    join(fixtureDir, '..'),
                        config: getFixturePath('configurations', 'env-browser.js'),
                    },
                );
                const results = await eslint.lintParallel([getFixturePath('globals-browser.js')]);

                assert.strictEqual(results.length, 1);
                assert.strictEqual(results[0].messages.length, 0, 'Should have no messages.');
                assert.strictEqual(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should return zero messages when given an option to add browser globals',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd: join(fixtureDir, '..'),
                        overrideConfig:
                        {
                            languageOptions: { globals: { window: false } },
                            rules:
                            {
                                'no-alert': 0,
                                'no-undef': 2,
                            },
                        },
                    },
                );
                const results = await eslint.lintParallel([getFixturePath('globals-browser.js')]);

                assert.strictEqual(results.length, 1);
                assert.strictEqual(results[0].messages.length, 0);
                assert.strictEqual(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should return zero messages when given a config with sourceType set to commonjs and ' +
            'Node.js globals',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:    join(fixtureDir, '..'),
                        config: getFixturePath('configurations', 'env-node.js'),
                    },
                );
                const results = await eslint.lintParallel([getFixturePath('globals-node.js')]);

                assert.strictEqual(results.length, 1);
                assert.strictEqual(results[0].messages.length, 0, 'Should have no messages.');
                assert.strictEqual(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should not return results from previous call when calling more than once',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:            join(fixtureDir, '..'),
                        config:         getFixturePath('eslint.config.js'),
                        ignore:         false,
                        overrideConfig: { rules: { semi: 2 } },
                    },
                );
                const failFilePath = getFixturePath('missing-semicolon.js');
                const passFilePath = getFixturePath('passing.js');
                let results = await eslint.lintParallel([failFilePath]);

                assert.strictEqual(results.length, 1);
                assert.strictEqual(results[0].filePath, failFilePath);
                assert.strictEqual(results[0].messages.length, 1);
                assert.strictEqual(results[0].messages[0].ruleId, 'semi');
                assert.strictEqual(results[0].suppressedMessages.length, 0);
                assert.strictEqual(results[0].messages[0].severity, 2);

                results = await eslint.lintParallel([passFilePath]);

                assert.strictEqual(results.length, 1);
                assert.strictEqual(results[0].filePath, passFilePath);
                assert.strictEqual(results[0].messages.length, 0);
                assert.strictEqual(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should return zero messages when executing a file with a shebang',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        ignore: false,
                        cwd:    getFixturePath(),
                        config: getFixturePath('eslint.config.js'),
                    },
                );
                const results = await eslint.lintParallel([getFixturePath('shebang.js')]);

                assert.strictEqual(results.length, 1);
                assert.strictEqual(results[0].messages.length, 0, 'Should have lint messages.');
                assert.strictEqual(results[0].suppressedMessages.length, 0);
            },
        );

        it
        (
            'should return zero messages when executing without a config file',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:    getFixturePath(),
                        ignore: false,
                    },
                );
                const filePath = getFixturePath('missing-semicolon.js');
                const results = await eslint.lintParallel([filePath]);

                assert.strictEqual(results.length, 1);
                assert.strictEqual(results[0].filePath, filePath);
                assert.strictEqual(results[0].messages.length, 0);
                assert.strictEqual(results[0].suppressedMessages.length, 0);
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd: originalDir,
                                overrideConfig:
                                {
                                    rules:
                                    {
                                        'indent-legacy': 1,
                                        'require-jsdoc': 1,
                                        'valid-jsdoc':   1,
                                    },
                                },
                            },
                        );
                        const results = await eslint.lintParallel(['lib/eslint-*.js']);

                        assert.deepStrictEqual
                        (
                            results[0].usedDeprecatedRules,
                            [
                                { ruleId: 'indent-legacy', replacedBy: ['indent'] },
                                { ruleId: 'require-jsdoc', replacedBy: [] },
                                { ruleId: 'valid-jsdoc', replacedBy: [] },
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd: originalDir,
                                overrideConfig:
                                {
                                    rules:
                                    {
                                        eqeqeq:             1,
                                        'valid-jsdoc':      0,
                                        'require-jsdoc':    0,
                                    },
                                },
                            },
                        );
                        const results = await eslint.lintParallel(['lib/eslint-*.js']);

                        assert.deepStrictEqual(results[0].usedDeprecatedRules, []);
                    },
                );

                it
                (
                    'should warn when deprecated rules are found in a config',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd: originalDir,
                                config:
                                'test/fixtures/cli-engine/deprecated-rule-config/eslint.config.js',
                            },
                        );
                        const results = await eslint.lintParallel(['lib/eslint-*.js']);

                        assert.deepStrictEqual
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd: join(fixtureDir, '..'),
                                fix: true,
                            },
                        );
                        const inputPath = getFixturePath('autofix/semicolon-conflicting-fixes.js');
                        const outputPath =
                        getFixturePath('autofix/semicolon-conflicting-fixes.expected.js');
                        const results = await eslint.lintParallel([inputPath]);
                        const expectedOutput = readFileSync(outputPath, 'utf8');

                        assert.strictEqual(results[0].output, expectedOutput);
                    },
                );

                it
                (
                    'correctly autofixes return-conflicting-fixes',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd: join(fixtureDir, '..'),
                                fix: true,
                            },
                        );
                        const inputPath = getFixturePath('autofix/return-conflicting-fixes.js');
                        const outputPath =
                        getFixturePath('autofix/return-conflicting-fixes.expected.js');
                        const results = await eslint.lintParallel([inputPath]);
                        const expectedOutput = readFileSync(outputPath, 'utf8');

                        assert.strictEqual(results[0].output, expectedOutput);
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd: join(fixtureDir, '..'),
                                fix: true,
                                overrideConfig:
                                {
                                    rules:
                                    {
                                        semi:              2,
                                        quotes:            [2, 'double'],
                                        eqeqeq:            2,
                                        'no-undef':        2,
                                        'space-infix-ops': 2,
                                    },
                                },
                            },
                        );
                        const results = await eslint.lintParallel([join(fixtureDir, 'fixmode')]);
                        results.forEach(convertCRLF);

                        assert.deepStrictEqual
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
                            cwd: join(fixtureDir, '..'),
                            overrideConfig:
                            {
                                rules:
                                {
                                    semi:              2,
                                    quotes:            [2, 'double'],
                                    eqeqeq:            2,
                                    'no-undef':        2,
                                    'space-infix-ops': 2,
                                },
                            },
                        };
                        eslint =
                        await FlatESLint.fromCLIOptions
                        ({ ...baseOptions, cache: true, fix: false });
                        // Do initial lint run and populate the cache file
                        await eslint.lintParallel([join(fixtureDir, 'fixmode')]);
                        eslint =
                        await FlatESLint.fromCLIOptions
                        ({ ...baseOptions, cache: true, fix: true });
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
                                cwd:    join(fixtureDir, '..'),
                                config: getFixturePath('configurations', 'plugins-with-prefix.js'),
                            },
                        );
                        const results =
                        await eslint.lintParallel
                        ([getFixturePath('rules', 'test/test-custom-rule.js')]);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].messages.length, 2, 'Expected two messages.');
                        assert.strictEqual(results[0].messages[0].ruleId, 'example/example-rule');
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
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
                                cwd:            join(fixtureDir, '..'),
                                overrideConfig: { rules: { 'example/example-rule': 1 } },
                            },
                        );
                        const results =
                        await eslint.lintParallel
                        ([getFixturePath('rules', 'test', 'test-custom-rule.js')]);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].messages.length, 2);
                        assert.strictEqual(results[0].messages[0].ruleId, 'example/example-rule');
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should return two messages when executing with cli option that specifies ' +
                    'preloaded plugin',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:                        join(fixtureDir, '..'),
                                overrideConfig:             { rules: { 'test/example-rule': 1 } },
                                plugin:                     ['test'],
                                resolvePluginsRelativeTo:   getFixturePath('plugins'),
                            },
                        );
                        const results =
                        await eslint.lintParallel
                        ([getFixturePath('rules', 'test', 'test-custom-rule.js')]);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].messages.length, 2);
                        assert.strictEqual(results[0].messages[0].ruleId, 'test/example-rule');
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
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
                function doDelete(filePath)
                {
                    try
                    {
                        unlinkSync(filePath);
                    }
                    catch
                    {
                        /*
                         * we don't care if the file didn't exist, since our
                         * intention was to remove the file
                         */
                    }
                }

                let cacheFilePath;

                beforeEach
                (
                    () => { cacheFilePath = null; },
                );

                afterEach
                (
                    () =>
                    {
                        sinon.restore();
                        if (cacheFilePath)
                            doDelete(cacheFilePath);
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
                        function deleteCacheDir()
                        {
                            try
                            {
                                rmSync
                                (
                                    join(cwd, 'tmp/.cacheFileDir/'),
                                    { recursive: true, force: true },
                                );
                            }
                            catch
                            {
                                /*
                                 * we don't care if the file didn't exist, since our
                                 * intention was to remove the file
                                 */
                            }
                        }

                        beforeEach
                        (() => { deleteCacheDir(); });

                        afterEach
                        (() => { deleteCacheDir(); });

                        it
                        (
                            'should create the directory and the cache file inside it when ' +
                            'cacheLocation ends with a slash',
                            async () =>
                            {
                                assert
                                (
                                    !shell.test('-d', join(cwd, './tmp/.cacheFileDir/')),
                                    'the cache directory already exists and wasn\'t successfully ' +
                                    'deleted',
                                );

                                eslint =
                                await FlatESLint.fromCLIOptions
                                (
                                    {
                                        cwd,
                                        // specifying cache true the cache will be created
                                        cache:          true,
                                        cacheLocation:  './tmp/.cacheFileDir/',
                                        overrideConfig:
                                        {
                                            rules:
                                            {
                                                'no-console':       0,
                                                'no-unused-vars':   2,
                                            },
                                        },
                                        ignore:         false,
                                    },
                                );
                                const file = getFixturePath('cache/src', 'test-file.js');
                                await eslint.lintParallel([file]);

                                assert
                                (
                                    shell.test
                                    (
                                        '-f',
                                        join(cwd, `./tmp/.cacheFileDir/.cache_${hash(cwd)}`),
                                    ),
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
                                    !shell.test('-d', join(cwd, './tmp/.cacheFileDir/')),
                                    'the cache directory already exists and wasn\'t successfully ' +
                                    'deleted',
                                );

                                mkdirSync(join(cwd, './tmp/.cacheFileDir/'), { recursive: true });
                                eslint =
                                await FlatESLint.fromCLIOptions
                                (
                                    {
                                        cwd,
                                        // specifying cache true the cache will be created
                                        cache:          true,
                                        cacheLocation:  './tmp/.cacheFileDir/',
                                        overrideConfig:
                                        {
                                            rules:
                                            {
                                                'no-console':       0,
                                                'no-unused-vars':   2,
                                            },
                                        },
                                        ignore:         false,
                                    },
                                );
                                const file = getFixturePath('cache/src', 'test-file.js');
                                await eslint.lintParallel([file]);

                                assert
                                (
                                    shell.test
                                    (
                                        '-f',
                                        join(cwd, `./tmp/.cacheFileDir/.cache_${hash(cwd)}`),
                                    ),
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
                                    !shell.test('-d', join(cwd, './tmp/.cacheFileDir/')),
                                    'the cache directory already exists and wasn\'t successfully ' +
                                    'deleted',
                                );

                                mkdirSync(join(cwd, './tmp/.cacheFileDir/'), { recursive: true });
                                eslint =
                                await FlatESLint.fromCLIOptions
                                (
                                    {
                                        cwd,
                                        // specifying cache true the cache will be created
                                        cache:          true,
                                        cacheLocation:  './tmp/.cacheFileDir',
                                        overrideConfig:
                                        {
                                            rules:
                                            {
                                                'no-console':       0,
                                                'no-unused-vars':   2,
                                            },
                                        },
                                        ignore:         false,
                                    },
                                );
                                const file = getFixturePath('cache/src', 'test-file.js');
                                await eslint.lintParallel([file]);

                                assert
                                (
                                    shell.test
                                    (
                                        '-f',
                                        join(cwd, `./tmp/.cacheFileDir/.cache_${hash(cwd)}`),
                                    ),
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
                        doDelete(cacheFilePath);
                        assert
                        (
                            !shell.test('-f', cacheFilePath),
                            'the cache file already exists and wasn\'t successfully deleted',
                        );

                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cache:          true,
                                cwd,
                                overrideConfig: { rules: { 'no-console': 0 } },
                                ignore:         false,
                            },
                        );
                        const file = getFixturePath('cli-engine', 'console.js');
                        await eslint.lintParallel([file]);

                        assert
                        (
                            shell.test('-f', cacheFilePath),
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
                        doDelete(cacheFilePath);
                        assert
                        (
                            !shell.test('-f', cacheFilePath),
                            'the cache file already exists and wasn\'t successfully deleted',
                        );

                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                // specifying cache true the cache will be created
                                cache:  true,
                                overrideConfig:
                                {
                                    rules:
                                    {
                                        'no-console':       0,
                                        'no-unused-vars':   2,
                                    },
                                },
                                ignore: false,
                            },
                        );
                        eslint.patchFlatESLintModuleURL = '#patch-flat-eslint-with-cache-test';
                        const file = join(cwd, 'test-file.js');
                        const results = await eslint.lintParallel([file]);

                        for (const { errorCount, warningCount, readFileCalled } of results)
                        {
                            assert.strictEqual
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
                            shell.test('-f', cacheFilePath),
                            'the cache for eslint should have been created',
                        );

                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                // specifying cache true the cache will be created
                                cache:  true,
                                overrideConfig:
                                {
                                    rules:
                                    {
                                        'no-console':       2,
                                        'no-unused-vars':   2,
                                    },
                                },
                                ignore: false,
                            },
                        );
                        eslint.patchFlatESLintModuleURL = '#patch-flat-eslint-with-cache-test';
                        const [newResult] = await eslint.lintParallel([file]);

                        assert
                        (
                            newResult.readFileCalled,
                            'ESLint should have read the file again because it\'s considered ' +
                            'changed because the config changed',
                        );
                        assert.strictEqual
                        (
                            newResult.errorCount,
                            1,
                            'since configuration changed the cache should have not been used and ' +
                            'one error should have been reported',
                        );
                        assert.strictEqual(newResult.messages[0].ruleId, 'no-console');
                        assert
                        (
                            shell.test('-f', cacheFilePath),
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
                        doDelete(cacheFilePath);
                        assert
                        (
                            !shell.test('-f', cacheFilePath),
                            'the cache file already exists and wasn\'t successfully deleted',
                        );

                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                // specifying cache true the cache will be created
                                cache:  true,
                                overrideConfig:
                                {
                                    rules:
                                    {
                                        'no-console':       0,
                                        'no-unused-vars':   2,
                                    },
                                },
                                ignore: false,
                            },
                        );
                        eslint.patchFlatESLintModuleURL = '#patch-flat-eslint-with-cache-test';
                        const file = getFixturePath('cache/src', 'test-file.js');
                        const results = await eslint.lintParallel([file]);

                        assert
                        (
                            results[0].readFileCalled,
                            'ESLint should have read the file because there was no cache file',
                        );
                        assert
                        (
                            shell.test('-f', cacheFilePath),
                            'the cache for eslint should have been created',
                        );

                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd,
                                // specifying cache true the cache will be created
                                cache:  true,
                                overrideConfig:
                                {
                                    rules:
                                    {
                                        'no-console':       0,
                                        'no-unused-vars':   2,
                                    },
                                },
                                ignore: false,
                            },
                        );
                        eslint.patchFlatESLintModuleURL = '#patch-flat-eslint-with-cache-test';
                        const cachedResults = await eslint.lintParallel([file]);
                        // assert the file was not processed because the cache was used
                        results[0].readFileCalled = false;

                        assert.deepStrictEqual
                        (results, cachedResults, 'the result should have been the same');
                    },
                );

                it
                (
                    'when `cacheLocation` is specified, should create the cache file with ' +
                    '`cache:true` and then delete it with `cache:false`',
                    async () =>
                    {
                        cacheFilePath = getFixturePath('.eslintcache');
                        doDelete(cacheFilePath);
                        assert
                        (
                            !shell.test('-f', cacheFilePath),
                            'the cache file already exists and wasn\'t successfully deleted',
                        );

                        const cliOptions =
                        {
                            // specifying cache true the cache will be created
                            cache:          true,
                            cacheLocation:  cacheFilePath,
                            overrideConfig:
                            {
                                rules:
                                {
                                    'no-console':       0,
                                    'no-unused-vars':   2,
                                },
                            },
                            cwd:            join(fixtureDir, '..'),
                        };
                        eslint = await FlatESLint.fromCLIOptions(cliOptions);
                        const file = getFixturePath('cache/src', 'test-file.js');
                        await eslint.lintParallel([file]);

                        assert
                        (
                            shell.test('-f', cacheFilePath),
                            'the cache for eslint should have been created',
                        );

                        cliOptions.cache = false;
                        eslint = await FlatESLint.fromCLIOptions(cliOptions);
                        await eslint.lintParallel([file]);

                        assert
                        (
                            !shell.test('-f', cacheFilePath),
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
                        doDelete(cacheFilePath);
                        assert
                        (
                            !shell.test('-f', cacheFilePath),
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
                            overrideConfig:
                            {
                                rules:
                                {
                                    'no-console':       0,
                                    'no-unused-vars':   2,
                                },
                            },
                            cwd:            join(fixtureDir, '..'),
                        };
                        eslint = await FlatESLint.fromCLIOptions(cliOptions);
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
                        doDelete(cacheFilePath);
                        assert
                        (
                            !shell.test('-f', cacheFilePath),
                            'the cache file already exists and wasn\'t successfully deleted',
                        );

                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            join(fixtureDir, '..'),
                                // specifying cache true the cache will be created
                                cache:          true,
                                cacheLocation:  cacheFilePath,
                                overrideConfig:
                                {
                                    rules:
                                    {
                                        'no-console':       0,
                                        'no-unused-vars':   2,
                                    },
                                },
                            },
                        );
                        const badFile = getFixturePath('cache/src', 'fail-file.js');
                        const goodFile = getFixturePath('cache/src', 'test-file.js');
                        const result = await eslint.lintParallel([badFile, goodFile]);
                        const [badFileResult, goodFileResult] = result;

                        assert.notStrictEqual
                        (
                            badFileResult.errorCount + badFileResult.warningCount,
                            0,
                            'the bad file should have some lint errors or warnings',
                        );
                        assert.strictEqual
                        (
                            goodFileResult.errorCount + badFileResult.warningCount,
                            0,
                            'the good file should have passed linting without errors or warnings',
                        );
                        assert
                        (
                            shell.test('-f', cacheFilePath),
                            'the cache for eslint should have been created',
                        );

                        const fileCache = fCache.createFromFile(cacheFilePath);
                        const { cache } = fileCache;

                        assert.strictEqual
                        (
                            typeof cache.getKey(goodFile),
                            'object',
                            'the entry for the good file should have been in the cache',
                        );
                        assert.strictEqual
                        (
                            typeof cache.getKey(badFile),
                            'object',
                            'the entry for the bad file should have been in the cache',
                        );

                        const cachedResult = await eslint.lintParallel([badFile, goodFile]);

                        assert.deepStrictEqual
                        (result, cachedResult, 'result should be the same with or without cache');
                    },
                );

                it
                (
                    'should not contain in the cache a file that was deleted',
                    async () =>
                    {
                        cacheFilePath = getFixturePath('.eslintcache');
                        doDelete(cacheFilePath);
                        assert
                        (
                            !shell.test('-f', cacheFilePath),
                            'the cache file already exists and wasn\'t successfully deleted',
                        );

                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            join(fixtureDir, '..'),
                                // specifying cache true the cache will be created
                                cache:          true,
                                cacheLocation:  cacheFilePath,
                                overrideConfig:
                                {
                                    rules:
                                    {
                                        'no-console':       0,
                                        'no-unused-vars':   2,
                                    },
                                },
                            },
                        );
                        const badFile = getFixturePath('cache/src', 'fail-file.js');
                        const goodFile = getFixturePath('cache/src', 'test-file.js');
                        const toBeDeletedFile = getFixturePath('cache/src', 'file-to-delete.js');
                        await eslint.lintParallel([badFile, goodFile, toBeDeletedFile]);
                        const fileCache = fCache.createFromFile(cacheFilePath);
                        let { cache } = fileCache;

                        assert.strictEqual
                        (
                            typeof cache.getKey(toBeDeletedFile),
                            'object',
                            'the entry for the file to be deleted should have been in the cache',
                        );

                        // delete the file from the file system
                        unlinkSync(toBeDeletedFile);

                        /*
                         * file-entry-cache@2.0.0 will remove from the cache deleted files
                         * even when they were not part of the array of files to be analyzed
                         */
                        await eslint.lintParallel([badFile, goodFile]);
                        cache = JSON.parse(readFileSync(cacheFilePath));

                        assert.strictEqual
                        (
                            typeof cache[0][toBeDeletedFile],
                            'undefined',
                            'the entry for the file to be deleted should not have been in the ' +
                            'cache',
                        );
                        // make sure that the previos assertion checks the right place
                        assert.notStrictEqual
                        (
                            typeof cache[0][badFile],
                            'undefined',
                            'the entry for the bad file should have been in the cache',
                        );
                        assert.notStrictEqual
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
                        doDelete(cacheFilePath);
                        assert
                        (
                            !shell.test('-f', cacheFilePath),
                            'the cache file already exists and wasn\'t successfully deleted',
                        );

                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            join(fixtureDir, '..'),
                                // specifying cache true the cache will be created
                                cache:          true,
                                cacheLocation:  cacheFilePath,
                                overrideConfig:
                                {
                                    rules:
                                    {
                                        'no-console':       0,
                                        'no-unused-vars':   2,
                                    },
                                },
                            },
                        );
                        const badFile = getFixturePath('cache/src', 'fail-file.js');
                        const goodFile = getFixturePath('cache/src', 'test-file.js');
                        const testFile2 = getFixturePath('cache/src', 'test-file2.js');
                        await eslint.lintParallel([badFile, goodFile, testFile2]);
                        let fileCache = fCache.createFromFile(cacheFilePath);
                        let { cache } = fileCache;

                        assert.strictEqual
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

                        assert.strictEqual
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
                        doDelete(cacheFilePath);
                        assert
                        (
                            !shell.test('-f', cacheFilePath),
                            'the cache file already exists and wasn\'t successfully deleted',
                        );

                        writeFileSync(cacheFilePath, '');
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            join(fixtureDir, '..'),
                                cache:          true,
                                cacheLocation:  cacheFilePath,
                                overrideConfig:
                                {
                                    rules:
                                    {
                                        'no-console':       0,
                                        'no-unused-vars':   2,
                                    },
                                },
                            },
                        );
                        const file = getFixturePath('cli-engine', 'console.js');

                        assert
                        (shell.test('-f', cacheFilePath), 'the cache for eslint should exist');

                        await eslint.lintParallel([file]);

                        assert
                        (
                            shell.test('-f', cacheFilePath),
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
                        doDelete(cacheFilePath);
                        assert
                        (
                            !shell.test('-f', cacheFilePath),
                            'the cache file already exists and wasn\'t successfully deleted',
                        );

                        // intenationally invalid to additionally make sure it isn't used
                        writeFileSync(cacheFilePath, '[]');
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            join(fixtureDir, '..'),
                                cacheLocation:  cacheFilePath,
                                overrideConfig:
                                {
                                    rules:
                                    {
                                        'no-console':       0,
                                        'no-unused-vars':   2,
                                    },
                                },
                            },
                        );
                        const file = getFixturePath('cli-engine', 'console.js');

                        assert
                        (shell.test('-f', cacheFilePath), 'the cache for eslint should exist');

                        await eslint.lintParallel([file]);

                        assert
                        (
                            !shell.test('-f', cacheFilePath),
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
                        doDelete(cacheFilePath);
                        assert
                        (
                            !shell.test('-f', cacheFilePath),
                            'the cache file already exists and wasn\'t successfully deleted',
                        );

                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                // specify a custom cache file
                                cacheLocation:  cacheFilePath,
                                // specifying cache true the cache will be created
                                cache:          true,
                                overrideConfig:
                                {
                                    rules:
                                    {
                                        'no-console':       0,
                                        'no-unused-vars':   2,
                                    },
                                },
                                cwd:            join(fixtureDir, '..'),
                            },
                        );
                        const badFile = getFixturePath('cache/src', 'fail-file.js');
                        const goodFile = getFixturePath('cache/src', 'test-file.js');
                        const result = await eslint.lintParallel([badFile, goodFile]);

                        assert
                        (
                            shell.test('-f', cacheFilePath),
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

                        assert.deepStrictEqual
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
                        doDelete(cacheFilePath);
                        assert
                        (
                            !shell.test('-f', cacheFilePath),
                            'the cache file already exists and wasn\'t successfully deleted',
                        );

                        const deprecatedRuleId = 'space-in-parens';
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            join(fixtureDir, '..'),
                                // specifying cache true the cache will be created
                                cache:          true,
                                cacheLocation:  cacheFilePath,
                                overrideConfig:
                                {
                                    rules:
                                    {
                                        [deprecatedRuleId]: 2,
                                    },
                                },
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
                                shell.test('-f', cacheFilePath),
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
                        doDelete(cacheFilePath);
                        assert
                        (
                            !shell.test('-f', cacheFilePath),
                            'the cache file already exists and wasn\'t successfully deleted',
                        );

                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            join(fixtureDir, '..'),
                                // specifying cache true the cache will be created
                                cache:          true,
                                cacheLocation:  cacheFilePath,
                                overrideConfig: { rules: { 'no-unused-vars': 2 } },
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
                                shell.test('-f', cacheFilePath),
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
                            assert.strictEqual
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
                                doDelete(cacheFilePath);
                                assert
                                (
                                    !shell.test('-f', cacheFilePath),
                                    'the cache file already exists and wasn\'t successfully ' +
                                    'deleted',
                                );

                                eslint =
                                await FlatESLint.fromCLIOptions
                                (
                                    {
                                        cwd:            join(fixtureDir, '..'),
                                        // specifying cache true the cache will be created
                                        cache:          true,
                                        cacheLocation:  cacheFilePath,
                                        cacheStrategy:  'metadata',
                                        overrideConfig:
                                        {
                                            rules:
                                            {
                                                'no-console':       0,
                                                'no-unused-vars':   2,
                                            },
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
                                shell.touch(goodFile);
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
                                doDelete(cacheFilePath);
                                assert
                                (
                                    !shell.test('-f', cacheFilePath),
                                    'the cache file already exists and wasn\'t successfully ' +
                                    'deleted',
                                );

                                eslint =
                                await FlatESLint.fromCLIOptions
                                (
                                    {
                                        cwd:            join(fixtureDir, '..'),
                                        // specifying cache true the cache will be created
                                        cache:          true,
                                        cacheLocation:  cacheFilePath,
                                        cacheStrategy:  'content',
                                        overrideConfig:
                                        {
                                            rules:
                                            {
                                                'no-console':       0,
                                                'no-unused-vars':   2,
                                            },
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
                                shell.touch(goodFile);
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
                                doDelete(cacheFilePath);
                                assert
                                (
                                    !shell.test('-f', cacheFilePath),
                                    'the cache file already exists and wasn\'t successfully ' +
                                    'deleted',
                                );

                                eslint =
                                await FlatESLint.fromCLIOptions
                                (
                                    {
                                        cwd:            join(fixtureDir, '..'),
                                        // specifying cache true the cache will be created
                                        cache:          true,
                                        cacheLocation:  cacheFilePath,
                                        cacheStrategy:  'content',
                                        overrideConfig:
                                        {
                                            rules:
                                            {
                                                'no-console':       0,
                                                'no-unused-vars':   2,
                                            },
                                        },

                                    },
                                );
                                const badFile = getFixturePath('cache/src', 'fail-file.js');
                                const goodFile = getFixturePath('cache/src', 'test-file.js');
                                const goodFileCopy =
                                join(`${dirname(goodFile)}`, 'test-file-copy.js');
                                shell.cp(goodFile, goodFileCopy);
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
                                shell.sed('-i', 'abc', 'xzy', goodFileCopy);
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                overrideConfigFile:         true,
                                overrideConfig:
                                [
                                    {
                                        processor: 'test-processor-1/txt',
                                        rules:
                                        {
                                            'no-console':       2,
                                            'no-unused-vars':   2,
                                        },
                                    },
                                    {
                                        files: ['**/*.txt', '**/*.txt/*.txt'],
                                    },
                                ],
                                plugin:                     ['test-processor-1'],
                                resolvePluginsRelativeTo:   getFixturePath('plugins'),
                                cwd:                        join(fixtureDir, '..'),
                            },
                        );
                        const results =
                        await eslint.lintParallel
                        ([getFixturePath('processors', 'test', 'test-processor.txt')]);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].messages.length, 2);
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
                    },
                );

                it
                (
                    'should run processors when calling lintParallel with config file that ' +
                    'specifies preloaded processor',
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                overrideConfigFile:         true,
                                overrideConfig:
                                [
                                    {
                                        processor: 'test-processor-2/txt',
                                        rules:
                                        {
                                            'no-console':       2,
                                            'no-unused-vars':   2,
                                        },
                                    },
                                    {
                                        files: ['**/*.txt', '**/*.txt/*.txt'],
                                    },
                                ],
                                plugin:                     ['test-processor-2'],
                                resolvePluginsRelativeTo:   getFixturePath('plugins'),
                                cwd:                        join(fixtureDir, '..'),
                            },
                        );
                        const results =
                        await eslint.lintParallel
                        ([getFixturePath('processors', 'test', 'test-processor.txt')]);

                        assert.strictEqual
                        (results[0].messages[0].message, '\'b\' is defined but never used.');
                        assert.strictEqual(results[0].messages[0].ruleId, 'post-processed');
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
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
                        await FlatESLint.fromCLIOptions({ cwd: getFixturePath('cli-engine') });
                    },
                );

                it
                (
                    'one file',
                    async () =>
                    {
                        await assert.rejects
                        (
                            async () => { await eslint.lintParallel(['non-exist.js']); },
                            /No files matching 'non-exist\.js' were found\./u,
                        );
                    },
                );

                it
                (
                    'should throw if the directory exists and is empty',
                    async () =>
                    {
                        ensureDirectoryExists(getFixturePath('cli-engine/empty'));
                        await assert.rejects
                        (
                            async () => { await eslint.lintParallel(['empty']); },
                            /No files matching 'empty' were found\./u,
                        );
                    },
                );

                it
                (
                    'one glob pattern',
                    async () =>
                    {
                        await assert.rejects
                        (
                            async () => { await eslint.lintParallel(['non-exist/**/*.js']); },
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
                            async () => { await eslint.lintParallel(['aaa.js', 'bbb.js']); },
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
                            async () =>
                            { await eslint.lintParallel(['console.js', 'non-exist.js']); },
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
                            async () => { await eslint.lintParallel(['*.js', 'non-exist/*.js']); },
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
                const root = join(tmpdir(), 'eslint/eslint/multiple-processors');
                const commonFiles =
                {
                    'node_modules/pattern-processor/index.js':
                    readFileSync
                    (
                        new URL('./fixtures/processors/pattern-processor.js', import.meta.url),
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
                    defineProcessor(${/<script lang="(\w*)">\n([\s\S]+?)\n<\/script>/gu});
                    const legacyProcessor =
                    defineProcessor(${/<script lang="(\w*)">\n([\s\S]+?)\n<\/script>/gu}, true);
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

                // unique directory for each test to avoid quirky disk-cleanup errors
                let id;

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
                        eslint = await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.md']);

                        assert.strictEqual(results.length, 1, 'Should have one result.');
                        assert.strictEqual
                        (results[0].messages.length, 1, 'Should have one message.');
                        assert.strictEqual(results[0].messages[0].ruleId, 'semi');
                        assert.strictEqual
                        (results[0].messages[0].line, 2, 'Message should be on line 2.');
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            teardown.getPath(),
                                overrideConfig: { files: ['**/*.html'] },
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.md']);

                        assert.strictEqual(results.length, 1, 'Should have one result.');
                        assert.strictEqual
                        (results[0].messages.length, 2, 'Should have two messages.');
                        assert.strictEqual(results[0].messages[0].ruleId, 'semi'); // JS block
                        assert.strictEqual
                        (results[0].messages[0].line, 2, 'First error should be on line 2');
                        // JS block in HTML block
                        assert.strictEqual(results[0].messages[1].ruleId, 'semi');
                        assert.strictEqual
                        (results[0].messages[1].line, 7, 'Second error should be on line 7.');
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            teardown.getPath(),
                                overrideConfig: { files: ['**/*.html'] },
                                fix:            true,
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.md']);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].messages.length, 0);
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
                        assert.strictEqual
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            teardown.getPath(),
                                overrideConfig: { files: ['**/*.html'] },
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.md']);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].messages.length, 2);
                        assert.strictEqual(results[0].messages[0].ruleId, 'semi');
                        assert.strictEqual(results[0].messages[0].line, 2);
                        assert.strictEqual(results[0].messages[1].ruleId, 'no-console');
                        assert.strictEqual(results[0].messages[1].line, 7);
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            teardown.getPath(),
                                overrideConfig: { files: ['**/*.html'] },
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.md']);

                        assert.strictEqual(results.length, 1);
                        assert.strictEqual(results[0].messages.length, 3);
                        assert.strictEqual(results[0].messages[0].ruleId, 'semi');
                        assert.strictEqual(results[0].messages[0].line, 2);
                        assert.strictEqual(results[0].messages[1].ruleId, 'no-console');
                        assert.strictEqual(results[0].messages[1].line, 7);
                        assert.strictEqual(results[0].messages[2].ruleId, 'no-console');
                        assert.strictEqual(results[0].messages[2].line, 10);
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
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
                        eslint = await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        await assert.rejects
                        (
                            async () => { await eslint.lintParallel(['test.md']); },
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['[ab].js']);
                        const filenames = results.map(r => basename(r.filePath));

                        assert.deepStrictEqual(filenames, ['[ab].js']);
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['[ab].js']);
                        const filenames = results.map(r => basename(r.filePath));

                        assert.deepStrictEqual(filenames, ['a.js', 'b.js']);
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.strictEqual(messages.length, 1);
                        assert.strictEqual
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.strictEqual(messages.length, 1);
                        assert.strictEqual(messages[0].severity, 2);
                        assert.strictEqual
                        (
                            messages[0].message,
                            'Unused eslint-disable directive (no problems were reported from ' +
                            '\'eqeqeq\').',
                        );
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.strictEqual(messages.length, 1);
                        assert.strictEqual(messages[0].severity, 2);
                        assert.strictEqual
                        (
                            messages[0].message,
                            'Unused eslint-disable directive (no problems were reported from ' +
                            '\'eqeqeq\').',
                        );
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.strictEqual(messages.length, 1);
                        assert.strictEqual(messages[0].severity, 1);
                        assert.strictEqual
                        (
                            messages[0].message,
                            'Unused eslint-disable directive (no problems were reported from ' +
                            '\'eqeqeq\').',
                        );
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.strictEqual(messages.length, 1);
                        assert.strictEqual(messages[0].severity, 1);
                        assert.strictEqual
                        (
                            messages[0].message,
                            'Unused eslint-disable directive (no problems were reported from ' +
                            '\'eqeqeq\').',
                        );
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.strictEqual(messages.length, 1);
                        assert.strictEqual(messages[0].severity, 1);
                        assert.strictEqual
                        (
                            messages[0].message,
                            'Unused eslint-disable directive (no problems were reported from ' +
                            '\'eqeqeq\').',
                        );
                        assert.strictEqual(results[0].suppressedMessages.length, 0);
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.strictEqual(messages.length, 0);
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.strictEqual(messages.length, 0);
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
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:            teardown.getPath(),
                                configLookup:   true,
                            },
                        );
                        const results = await eslint.lintParallel(['test.js']);
                        const [{ messages }] = results;

                        assert.strictEqual(messages.length, 0);
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
                                await FlatESLint.fromCLIOptions
                                (
                                    {
                                        cwd:            teardown.getPath(),
                                        overrideConfig:
                                        { linterOptions: { reportUnusedDisableDirectives: 'off' } },
                                        configLookup:   true,
                                    },
                                );
                                const results = await eslint.lintParallel(['test.js']);
                                const [{ messages }] = results;

                                assert.strictEqual(messages.length, 0);
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
                                await FlatESLint.fromCLIOptions
                                (
                                    {
                                        cwd:            teardown.getPath(),
                                        overrideConfig:
                                        {
                                            linterOptions:
                                            { reportUnusedDisableDirectives: 'error' },
                                        },
                                        configLookup:   true,
                                    },
                                );
                                const results = await eslint.lintParallel(['test.js']);
                                const [{ messages }] = results;

                                assert.strictEqual(messages.length, 1);
                                assert.strictEqual(messages[0].severity, 2);
                                assert.strictEqual
                                (
                                    messages[0].message,
                                    'Unused eslint-disable directive (no problems were reported ' +
                                    'from \'eqeqeq\').',
                                );
                                assert.strictEqual(results[0].suppressedMessages.length, 0);
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
                eslint = await FlatESLint.fromCLIOptions({ configLookup: true });
                await assert.rejects
                (
                    () => eslint.lintParallel(777),
                    /'patterns' must be a non-empty string or an array of non-empty strings/u,
                );
                await assert.rejects
                (
                    () => eslint.lintParallel([null]),
                    /'patterns' must be a non-empty string or an array of non-empty strings/u,
                );
            },
        );
    },
);

describe
(
    'Fix Types',
    () =>
    {
        let eslint;

        before(setUpFixtures);

        after(tearDownFixtures);

        it
        (
            'should throw an error when an invalid fix type is specified',
            async () =>
            {
                await assert.rejects
                (
                    async () =>
                    {
                        eslint =
                        await FlatESLint.fromCLIOptions
                        (
                            {
                                cwd:        join(fixtureDir, '..'),
                                fix:        true,
                                fixType:    ['layou'],
                            },
                        );
                    },
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
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:        join(fixtureDir, '..'),
                        fix:        false,
                        fixType:    ['layout'],
                    },
                );
                const inputPath = getFixturePath('fix-types/fix-only-semi.js');
                const results = await eslint.lintParallel([inputPath]);

                assert.strictEqual(results[0].output, void 0);
            },
        );

        it
        (
            'should not fix non-style rules when fixTypes has only \'layout\'',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:        join(fixtureDir, '..'),
                        fix:        true,
                        fixType:    ['layout'],
                    },
                );
                const inputPath = getFixturePath('fix-types/fix-only-semi.js');
                const outputPath = getFixturePath('fix-types/fix-only-semi.expected.js');
                const results = await eslint.lintParallel([inputPath]);
                const expectedOutput = readFileSync(outputPath, 'utf8');

                assert.strictEqual(results[0].output, expectedOutput);
            },
        );

        it
        (
            'should not fix style or problem rules when fixTypes has only \'suggestion\'',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:        join(fixtureDir, '..'),
                        fix:        true,
                        fixType:    ['suggestion'],
                    },
                );
                const inputPath = getFixturePath('fix-types/fix-only-prefer-arrow-callback.js');
                const outputPath =
                getFixturePath('fix-types/fix-only-prefer-arrow-callback.expected.js');
                const results = await eslint.lintParallel([inputPath]);
                const expectedOutput = readFileSync(outputPath, 'utf8');

                assert.strictEqual(results[0].output, expectedOutput);
            },
        );

        it
        (
            'should fix both style and problem rules when fixTypes has \'suggestion\' and ' +
            '\'layout\'',
            async () =>
            {
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:        join(fixtureDir, '..'),
                        fix:        true,
                        fixType:    ['suggestion', 'layout'],
                    },
                );
                const inputPath =
                getFixturePath('fix-types/fix-both-semi-and-prefer-arrow-callback.js');
                const outputPath =
                getFixturePath('fix-types/fix-both-semi-and-prefer-arrow-callback.expected.js');
                const results = await eslint.lintParallel([inputPath]);
                const expectedOutput = readFileSync(outputPath, 'utf8');

                assert.strictEqual(results[0].output, expectedOutput);
            },
        );
    },
);

describe
(
    'lintParallel worker therad',
    () =>
    {
        let eslint;

        const root = getFixturePath('bad-config');

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
            'should emit an error',
            async () =>
            {
                const teardown =
                createCustomTeardown
                (
                    {
                        cwd: root,
                        files:
                        {
                            'test.js': '',
                            'eslint.config.js':
                            `
                            const { isMainThread } = require('node:worker_threads');

                            if (!isMainThread)
                                throw Error('foobar');
                            `,
                        },
                    },
                );
                await teardown.prepare();
                ({ cleanup } = teardown);
                eslint =
                await FlatESLint.fromCLIOptions
                (
                    {
                        cwd:            teardown.getPath(),
                        configLookup:   true,
                    },
                );
                await assert.rejects
                (async () => await eslint.lintParallel(['test.js']), { message: 'foobar' });
            },
        );
    },
);
