/* globals after, afterEach, before, beforeEach, describe, it */

import assert           from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { tmpdir }       from 'node:os';
import { join }         from 'node:path';
import createCLIExecute from '../lib/create-cli-execute.js';
import createImportAs   from '../lib/create-import-as.js';
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

async function getLog(eslintDirURL)
{
    const importAsESLint = createImportAs(eslintDirURL);
    const { default: log } = await importAsESLint('./lib/shared/logging.js');
    return log;
}

const [execute, log] = await Promise.all([createCLIExecute(eslintDirURL), getLog(eslintDirURL)]);
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
        (
            () =>
            {
                shell.rm('-r', fixtureDir);
            },
        );

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
                const exitCode = await execute([], null, false);
                assert.equal(log.error.callCount, 1);
                assert.equal(exitCode, 2);
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
                        await execute(`--no-ignore --rule semi:2 ${filePath}`, null, true);

                        assert(log.info.called, 'Log should have been called.');

                        log.info.resetHistory();

                        const passingPath = getFixturePath('passing.js');
                        await execute(`--no-ignore --rule semi:2 ${passingPath}`, null, true);

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
                        const exitCode = await execute('-v', null, true);
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
    },
);
