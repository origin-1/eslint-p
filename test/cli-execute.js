/* globals after, afterEach, before, beforeEach, describe, it */

import assert           from 'node:assert/strict';
import createCLIExecute from '../lib/create-cli-execute.js';
import createImportAs   from '../lib/create-import-as.js';
import eslintDirURL     from '../lib/default-eslint-dir-url.js';
import sinon            from 'sinon';

async function getLog(eslintDirURL)
{
    const importAsESLint = createImportAs(eslintDirURL);
    const { default: log } = await importAsESLint('./lib/shared/logging.js');
    return log;
}

const [execute, log] = await Promise.all([createCLIExecute(eslintDirURL), getLog(eslintDirURL)]);

describe
(
    'cli',
    () =>
    {
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

        it
        (
            'when executing with version flag should print out current version',
            async () =>
            {
                const exitCode = await execute('-v', null, true);
                assert.equal(exitCode, 0);
                assert.equal(log.info.callCount, 1);
                assert.match
                (log.info.args[0][0], /^eslint-p v\d+\.\d+\.\d+.*\nESLint v\d+\.\d+\.\d+.*$/);
            },
        );
    },
);
