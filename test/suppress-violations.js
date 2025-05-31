import assert                                   from 'node:assert/strict';
import { fork }                                 from 'node:child_process';
import { existsSync }                           from 'node:fs';
import { copyFile, readFile, rm, writeFile }    from 'node:fs/promises';
import { fileURLToPath }                        from 'node:url';

const EXECUTABLE_PATH = fileURLToPath(new URL('../lib/eslint-p.js', import.meta.url));

/**
 * Returns a Promise for when a child process exits
 * @param {ChildProcess} exitingProcess The child process
 * @returns {Promise<number>}
 * A Promise that fulfills with the exit code when the child process exits
 */
function awaitExit(exitingProcess)
{
    return new Promise
    (resolve => { exitingProcess.once('exit', resolve); });
}

/**
 * Asserts that the exit code of a given child process will equal the given value.
 * @param {ChildProcess} exitingProcess The child process
 * @param {number} expectedExitCode The expected exit code of the child process
 * @returns {Promise<void>}
 * A Promise that fulfills if the exit code ends up matching, and rejects otherwise.
 */
function assertExitCode(exitingProcess, expectedExitCode)
{
    return awaitExit(exitingProcess)
    .then
    (
        exitCode =>
        {
            assert.equal
            (
                exitCode,
                expectedExitCode,
                `Expected an exit code of ${expectedExitCode} but got ${exitCode}.`,
            );
        },
    );
}

/**
 * Returns a Promise for the stdout of a process.
 * @param {ChildProcess} runningProcess The child process
 * @returns {Promise<{stdout: string, stderr: string}>}
 * A Promise that fulfills with all of the stdout and stderr output produced by the process when it
 * exits.
 */
function getOutput(runningProcess)
{
    let stdout = '';
    let stderr = '';

    runningProcess.stdout.on
    ('data', data => { stdout += data; });
    runningProcess.stderr.on
    ('data', data => { stderr += data; });
    return awaitExit(runningProcess).then(() => ({ stdout, stderr }));
}

const forkedProcesses = new Set();

/**
 * Forks the process to run an instance of ESLint.
 * @param {string[]} [args] An array of arguments
 * @param {Object} [options] An object containing options for the resulting child process
 * @returns {ChildProcess} The resulting child process
 */
function runESLint(args, options)
{
    const newProcess = fork(EXECUTABLE_PATH, args, { silent: true, ...options });
    forkedProcesses.add(newProcess);
    return newProcess;
}

afterEach
(
    () =>
    {
        // Clean up all the processes after every test.
        forkedProcesses.forEach(child => child.kill());
        forkedProcesses.clear();
    },
);

describe
(
    'suppress violations',
    () =>
    {
        const SUPPRESSIONS_PATH = '.temp-eslintsuppressions';
        const EXISTING_SUPPRESSIONS_PATH =
        'test/fixtures/suppressions/existing-eslintsuppressions.json';
        const SOURCE_PATH = 'test/fixtures/suppressions/test-file.js';
        const ARGS_WITHOUT_SUPPRESSIONS =
        [
            '--no-config-lookup',
            '--no-ignore',
            SOURCE_PATH,
            '--suppressions-location',
            SUPPRESSIONS_PATH,
            '--concurrency',
            '1',
        ];
        const ARGS_WITH_SUPPRESS_ALL = [...ARGS_WITHOUT_SUPPRESSIONS, '--suppress-all'];
        const ARGS_WITH_SUPPRESS_RULE_INDENT =
        [
            ...ARGS_WITHOUT_SUPPRESSIONS,
            '--suppress-rule',
            'indent',
        ];
        const ARGS_WITH_SUPPRESS_RULE_INDENT_SPARSE_ARRAYS =
        [
            ...ARGS_WITH_SUPPRESS_RULE_INDENT,
            '--suppress-rule',
            'no-sparse-arrays',
        ];
        const ARGS_WITH_PRUNE_SUPPRESSIONS = [...ARGS_WITHOUT_SUPPRESSIONS, '--prune-suppressions'];
        const ARGS_WITH_PASS_ON_UNPRUNED_SUPPRESSIONS =
        ARGS_WITHOUT_SUPPRESSIONS.concat('--pass-on-unpruned-suppressions');
        const SUPPRESSIONS_FILE_WITH_INDENT =
        {
            [SOURCE_PATH]:
            {
                'indent': { count: 1 },
            },
        };
        const SUPPRESSIONS_FILE_WITH_INDENT_SPARSE_ARRAYS =
        {
            [SOURCE_PATH]:
            {
                'indent':           { count: 1 },
                'no-sparse-arrays': { count: 2 },
            },
        };
        const SUPPRESSIONS_FILE_ALL_ERRORS =
        {
            [SOURCE_PATH]:
            {
                'indent':           { count: 1 },
                'no-sparse-arrays': { count: 2 },
                'no-undef':         { count: 3 },
            },
        };

        describe
        (
            'arguments combinations',
            () =>
            {
                it
                (
                    'displays an error when the --suppress-all and --suppress-rule flags are ' +
                    'used together',
                    () =>
                    {
                        const child =
                        runESLint
                        (
                            [
                                ...ARGS_WITH_SUPPRESS_ALL,
                                '--suppress-rule',
                                'indent',
                            ],
                        );

                        const exitCodeAssertion = assertExitCode(child, 2);
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                assert
                                (
                                    output.stderr.includes
                                    (
                                        'The --suppress-all option and the --suppress-rule ' +
                                        'option cannot be used together.',
                                    ),
                                );
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'displays an error when the --suppress-all and --prune-suppressions flags ' +
                    'are used together',
                    () =>
                    {
                        const child =
                        runESLint
                        (
                            [
                                ...ARGS_WITH_SUPPRESS_ALL,
                                '--prune-suppressions',
                            ],
                        );

                        const exitCodeAssertion = assertExitCode(child, 2);
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                assert
                                (
                                    output.stderr.includes
                                    (
                                        'The --suppress-all option and the --prune-suppressions ' +
                                        'option cannot be used together.',
                                    ),
                                );
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'displays an error when the --suppress-rule and --prune-suppressions flags ' +
                    'are used together',
                    () =>
                    {
                        const child =
                        runESLint
                        (
                            [
                                ...ARGS_WITH_SUPPRESS_RULE_INDENT,
                                '--prune-suppressions',
                            ],
                        );

                        const exitCodeAssertion = assertExitCode(child, 2);
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                assert
                                (
                                    output.stderr.includes
                                    (
                                        'The --suppress-rule option and the ' +
                                        '--prune-suppressions option cannot be used together.',
                                    ),
                                );
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );
            },
        );

        describe
        (
            'stdin',
            () =>
            {
                it
                (
                    'displays an error when the --suppress-all flag is used',
                    () =>
                    {
                        const child =
                        runESLint
                        (
                            [
                                '--stdin',
                                '--no-config-lookup',
                                '--suppress-all',
                            ],
                        );
                        child.stdin.write('var foo = bar;\n');
                        child.stdin.end();

                        const exitCodeAssertion = assertExitCode(child, 2);
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                assert
                                (
                                    output.stderr.includes
                                    (
                                        'The --suppress-all, --suppress-rule, and ' +
                                        '--prune-suppressions options cannot be used with ' +
                                        'piped-in code.',
                                    ),
                                );
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'displays an error when the --suppress-rule flag is used',
                    () =>
                    {
                        const child =
                        runESLint
                        (
                            [
                                '--stdin',
                                '--no-config-lookup',
                                '--suppress-rule',
                                'indent',
                            ],
                        );
                        child.stdin.write('var foo = bar;\n');
                        child.stdin.end();

                        const exitCodeAssertion = assertExitCode(child, 2);
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                assert
                                (
                                    output.stderr.includes
                                    (
                                        'The --suppress-all, --suppress-rule, and ' +
                                        '--prune-suppressions options cannot be used with ' +
                                        'piped-in code.',
                                    ),
                                );
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'displays an error when the --prune-suppressions flag is used',
                    () =>
                    {
                        const child =
                        runESLint
                        (
                            [
                                '--stdin',
                                '--no-config-lookup',
                                '--prune-suppressions',
                            ],
                        );
                        child.stdin.write('var foo = bar;\n');
                        child.stdin.end();

                        const exitCodeAssertion = assertExitCode(child, 2);
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                assert
                                (
                                    output.stderr.includes
                                    (
                                        'The --suppress-all, --suppress-rule, and ' +
                                        '--prune-suppressions options cannot be used with ' +
                                        'piped-in code.',
                                    ),
                                );
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );
            },
        );

        describe
        (
            'when no suppression file exists',
            () =>
            {
                beforeEach
                (() => rm(SUPPRESSIONS_PATH, { force: true }));

                it
                (
                    'creates the suppressions file when the --suppress-all flag is used, and ' +
                    'reports no violations',
                    () =>
                    {
                        const child = runESLint(ARGS_WITH_SUPPRESS_ALL);

                        const exitCodeAssertion =
                        assertExitCode(child, 0).then
                        (
                            async () =>
                            {
                                assert
                                (
                                    existsSync(SUPPRESSIONS_PATH),
                                    'Suppressions file should exist at the given location',
                                );
                                JSON.parse(await readFile(SUPPRESSIONS_PATH, 'utf8'));
                            },
                        );
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                // Warnings
                                assert
                                (
                                    output.stdout.includes
                                    ('\'e\' is assigned a value but never used'),
                                );
                                // Suppressed errors
                                assert(!output.stdout.includes('is not defined'));
                                assert
                                (
                                    !output.stdout.includes
                                    ('Expected indentation of 2 spaces but found 4'),
                                );
                                assert
                                (!output.stdout.includes('Unexpected comma in middle of array'));
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'creates the suppressions file when the --suppress-rule flag is used, and ' +
                    'reports some violations',
                    () =>
                    {
                        const child = runESLint(ARGS_WITH_SUPPRESS_RULE_INDENT);

                        const exitCodeAssertion =
                        assertExitCode(child, 1).then
                        (
                            async () =>
                            {
                                assert
                                (
                                    existsSync(SUPPRESSIONS_PATH),
                                    'Suppressions file should exist at the given location',
                                );
                                const suppressions =
                                JSON.parse(await readFile(SUPPRESSIONS_PATH, 'utf8'));
                                assert.deepEqual
                                (
                                    suppressions,
                                    SUPPRESSIONS_FILE_WITH_INDENT,
                                    'Suppressions file should contain the expected contents',
                                );
                            },
                        );
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                // Warnings
                                assert
                                (
                                    output.stdout.includes
                                    ('\'e\' is assigned a value but never used'),
                                );
                                // Un-suppressed errors
                                assert(output.stdout.includes('is not defined'));
                                assert
                                (output.stdout.includes('Unexpected comma in middle of array'));
                                // Suppressed errors
                                assert
                                (
                                    !output.stdout.includes
                                    ('Expected indentation of 2 spaces but found 4'),
                                );
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'creates the suppressions file when multiple --suppress-rule flags are used, ' +
                    'and reports some violations',
                    () =>
                    {
                        const child = runESLint(ARGS_WITH_SUPPRESS_RULE_INDENT_SPARSE_ARRAYS);

                        const exitCodeAssertion =
                        assertExitCode(child, 1).then
                        (
                            async () =>
                            {
                                assert
                                (
                                    existsSync(SUPPRESSIONS_PATH),
                                    'Suppressions file should exist at the given location',
                                );
                                const suppressions =
                                JSON.parse(await readFile(SUPPRESSIONS_PATH, 'utf8'));
                                assert.deepEqual
                                (
                                    suppressions,
                                    SUPPRESSIONS_FILE_WITH_INDENT_SPARSE_ARRAYS,
                                    'Suppressions file should contain the expected contents',
                                );
                            },
                        );
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                // Warnings
                                assert
                                (
                                    output.stdout.includes
                                    ('\'e\' is assigned a value but never used'),
                                );
                                // Un-suppressed errors
                                assert(output.stdout.includes('is not defined'));
                                // Suppressed errors
                                assert
                                (
                                    !output.stdout.includes
                                    ('Expected indentation of 2 spaces but found 4'),
                                );
                                assert
                                (!output.stdout.includes('Unexpected comma in middle of array'));
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'displays an error when the suppressions file doesn\'t exist', () =>
                    {
                        const child = runESLint(ARGS_WITHOUT_SUPPRESSIONS);

                        const exitCodeAssertion =
                        assertExitCode(child, 2).then
                        (
                            () =>
                            {
                                assert
                                (
                                    !existsSync(SUPPRESSIONS_PATH),
                                    'Suppressions file must not exist at the given location',
                                );
                            },
                        );
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                assert
                                (output.stderr.includes('The suppressions file does not exist'));
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'displays an error when the --prune-suppressions flag used, and the ' +
                    'suppressions file doesn\'t exist',
                    () =>
                    {
                        const child = runESLint(ARGS_WITH_PRUNE_SUPPRESSIONS);

                        const exitCodeAssertion =
                        assertExitCode(child, 2).then
                        (
                            () =>
                            {
                                assert
                                (
                                    !existsSync(SUPPRESSIONS_PATH),
                                    'Suppressions file must not exist at the given location',
                                );
                            },
                        );
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                assert
                                (output.stderr.includes('The suppressions file does not exist'));
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'creates the suppressions file when the --suppress-all flag and --fix is ' +
                    'used, and reports no violations',
                    async () =>
                    {
                        const backup = await readFile(SOURCE_PATH);
                        try
                        {
                            const child = runESLint([...ARGS_WITH_SUPPRESS_ALL, '--fix']);
                            await assertExitCode(child, 0);

                            assert
                            (
                                existsSync(SUPPRESSIONS_PATH),
                                'Suppressions file should exist at the given location',
                            );
                            const suppressions =
                            JSON.parse(await readFile(SUPPRESSIONS_PATH, 'utf8'));
                            assert
                            (
                                !('indent' in suppressions[SOURCE_PATH]),
                                'Suppressions file should not contain any suppressions for indent',
                            );
                        }
                        finally
                        {
                            await writeFile(SOURCE_PATH, backup);
                        }
                    },
                );
            },
        );

        describe
        (
            'when an invalid suppressions file already exists',
            () =>
            {
                beforeEach
                (() => writeFile(SUPPRESSIONS_PATH, 'This is not valid JSON.'));

                afterEach
                (() => rm(SUPPRESSIONS_PATH, { force: true }));

                it
                (
                    'gives an error when the --suppress-all argument is used',
                    () =>
                    {
                        const child = runESLint(ARGS_WITH_SUPPRESS_ALL);

                        const exitCodeAssertion = assertExitCode(child, 2);
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                assert
                                (output.stderr.includes('Failed to parse suppressions file at'));
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'gives an error when the --suppress-all argument is not used',
                    () =>
                    {
                        const child = runESLint(ARGS_WITHOUT_SUPPRESSIONS);

                        const exitCodeAssertion = assertExitCode(child, 2);
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                assert
                                (
                                    output.stderr.includes
                                    ('Failed to parse suppressions file at'),
                                );
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'gives an error when the --suppress-rule argument is used',
                    () =>
                    {
                        const child = runESLint(ARGS_WITH_SUPPRESS_RULE_INDENT);

                        const exitCodeAssertion = assertExitCode(child, 2);
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                assert
                                (output.stderr.includes('Failed to parse suppressions file at'));
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'give an error when the --prune-suppressions argument is used',
                    () =>
                    {
                        const child = runESLint(ARGS_WITH_PRUNE_SUPPRESSIONS);

                        const exitCodeAssertion = assertExitCode(child, 2);
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                assert
                                (output.stderr.includes('Failed to parse suppressions file at'));
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );
            },
        );

        describe
        (
            'when a valid suppressions file already exists',
            () =>
            {
                afterEach
                (() => rm(SUPPRESSIONS_PATH, { force: true }));

                it
                (
                    'doesn\'t remove suppressions from the suppressions file when the ' +
                    '--suppress-all flag is used',
                    async () =>
                    {
                        await copyFile(EXISTING_SUPPRESSIONS_PATH, SUPPRESSIONS_PATH);
                        const child = runESLint(ARGS_WITH_SUPPRESS_ALL);

                        const exitCodeAssertion =
                        assertExitCode(child, 0).then
                        (
                            async () =>
                            {
                                const suppressions =
                                JSON.parse(await readFile(SUPPRESSIONS_PATH, 'utf8'));
                                assert('test/fixtures/suppressions/extra-file.js' in suppressions);
                            },
                        );
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                // Warnings
                                assert
                                (
                                    output.stdout.includes
                                    ('\'e\' is assigned a value but never used'),
                                );
                                // Suppressed errors
                                assert(!output.stdout.includes('is not defined'));
                                assert
                                (!output.stdout.includes('Unexpected comma in middle of array'));
                                assert
                                (
                                    !output.stdout.includes
                                    ('Expected indentation of 2 spaces but found 4'),
                                );
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'suppresses the violations from the suppressions file, without passing ' +
                    '--suppress-all',
                    async () =>
                    {
                        await writeFile
                        (SUPPRESSIONS_PATH, JSON.stringify(SUPPRESSIONS_FILE_ALL_ERRORS, null, 2));
                        const child = runESLint(ARGS_WITHOUT_SUPPRESSIONS);

                        const exitCodeAssertion = assertExitCode(child, 0);
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                // Warnings
                                assert
                                (
                                    output.stdout.includes
                                    ('\'e\' is assigned a value but never used'),
                                );
                                // Suppressed errors
                                assert(!output.stdout.includes('is not defined'));
                                assert
                                (!output.stdout.includes('Unexpected comma in middle of array'));
                                assert
                                (
                                    !output.stdout.includes
                                    ('Expected indentation of 2 spaces but found 4'),
                                );
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'displays all the violations, when there is at least one left unmatched',
                    async () =>
                    {
                        const suppressions = structuredClone(SUPPRESSIONS_FILE_ALL_ERRORS);
                        suppressions[SOURCE_PATH]['no-undef'].count = 1;
                        await writeFile(SUPPRESSIONS_PATH, JSON.stringify(suppressions, null, 2));
                        const child = runESLint(ARGS_WITHOUT_SUPPRESSIONS);

                        const exitCodeAssertion = assertExitCode(child, 1);
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                // Warnings
                                assert
                                (
                                    output.stdout.includes
                                    ('\'e\' is assigned a value but never used'),
                                );
                                // Suppressed errors (but displayed because there is at least one
                                // left unmatched)
                                assert(output.stdout.includes('is not defined'));
                                // Suppressed errors
                                assert
                                (!output.stdout.includes('Unexpected comma in middle of array'));
                                assert
                                (
                                    !output.stdout.includes
                                    ('Expected indentation of 2 spaces but found 4'),
                                );
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'exits with code 2, when there are unused suppressions',
                    async () =>
                    {
                        const suppressions = structuredClone(SUPPRESSIONS_FILE_ALL_ERRORS);
                        suppressions[SOURCE_PATH].indent.count = 10;
                        await writeFile(SUPPRESSIONS_PATH, JSON.stringify(suppressions, null, 2));
                        const child = runESLint(ARGS_WITHOUT_SUPPRESSIONS);
                        const exitCodeAssertion = assertExitCode(child, 2);
                        const outputAssertion =
                        getOutput(child).then
                        (
                            output =>
                            {
                                assert
                                (
                                    output.stderr.includes
                                    (
                                        'There are suppressions left that do not occur anymore. ' +
                                        'Consider re-running the command with ' +
                                        '`--prune-suppressions`.',
                                    ),
                                );
                            },
                        );
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'exits with code 0, when there are unused suppressions and the ' +
                    '--pass-on-unpruned-suppressions flag is used',
                    async () =>
                    {
                        const suppressions = structuredClone(SUPPRESSIONS_FILE_ALL_ERRORS);
                        suppressions[SOURCE_PATH].indent.count = 10;
                        await writeFile(SUPPRESSIONS_PATH, JSON.stringify(suppressions, null, 2));
                        const child = runESLint(ARGS_WITH_PASS_ON_UNPRUNED_SUPPRESSIONS);
                        const exitCodeAssertion = assertExitCode(child, 0);
                        const outputAssertion =
                        getOutput(child).then
                        (output => { assert(!output.stderr.includes('suppressions left')); });
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'exits with code 1 if there are unsuppressed lint errors, when there are ' +
                    'unused suppressions and the --pass-on-unpruned-suppressions flag is used (1)',
                    async () =>
                    {
                        const suppressions = structuredClone(SUPPRESSIONS_FILE_ALL_ERRORS);
                        suppressions[SOURCE_PATH].indent.count = 10;
                        suppressions[SOURCE_PATH]['no-sparse-arrays'].count--;
                        await writeFile(SUPPRESSIONS_PATH, JSON.stringify(suppressions, null, 2));
                        const child = runESLint(ARGS_WITH_PASS_ON_UNPRUNED_SUPPRESSIONS);
                        const exitCodeAssertion = assertExitCode(child, 1);
                        const outputAssertion = getOutput(child).then
                        (output => { assert(!output.stderr.includes('suppressions left')); });
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'exits with code 1 if there are unsuppressed lint errors, when there are ' +
                    'unused suppressions and the --pass-on-unpruned-suppressions flag is used (2)',
                    async () =>
                    {
                        const suppressions = structuredClone(SUPPRESSIONS_FILE_ALL_ERRORS);
                        suppressions[SOURCE_PATH].indent.count = 10;
                        await writeFile(SUPPRESSIONS_PATH, JSON.stringify(suppressions, null, 2));
                        const child =
                        runESLint
                        (
                            ARGS_WITH_PASS_ON_UNPRUNED_SUPPRESSIONS.concat
                            ('--rule=no-restricted-syntax:[error, \'IfStatement\']'),
                        );
                        const exitCodeAssertion = assertExitCode(child, 1);
                        const outputAssertion = getOutput(child).then
                        (output => { assert(!output.stderr.includes('suppressions left')); });
                        return Promise.all([exitCodeAssertion, outputAssertion]);
                    },
                );

                it
                (
                    'prunes the suppressions file, when the --prune-suppressions flag is used',
                    async () =>
                    {
                        const expectedSuppressions = structuredClone(SUPPRESSIONS_FILE_ALL_ERRORS);
                        expectedSuppressions[SOURCE_PATH].indent.count = 10;
                        expectedSuppressions[SOURCE_PATH].ruleThatDoesntExist = { count: 1 };
                        await writeFile
                        (SUPPRESSIONS_PATH, JSON.stringify(expectedSuppressions, null, 2));
                        const child = runESLint(ARGS_WITH_PRUNE_SUPPRESSIONS);

                        await assertExitCode(child, 0);
                        const suppressions = JSON.parse(await readFile(SUPPRESSIONS_PATH, 'utf8'));
                        assert.deepEqual
                        (
                            suppressions,
                            SUPPRESSIONS_FILE_ALL_ERRORS,
                            'Suppressions file should contain the expected contents',
                        );
                    },
                );
            },
        );
    },
);
