import { spawnSync }                from 'node:child_process';
import { existsSync }               from 'node:fs';
import countErrors                  from '../grab/count-errors.js';
import createPrintResults           from '../grab/create-print-results.js';
import createImportAs               from './create-import-as.js';
import { getOverrideConfigFile }    from './create-translate-options.js';
import patchESLint                  from './patch-eslint.js';

export default async function createCLIExecute(eslintDirURL, calculateInspectConfigFlags)
{
    const importAsESLint = createImportAs(eslintDirURL);
    const
    [
        { ESLint, shouldUseFlatConfig },
        { getCacheFile },
        { default: createCLIOptions },
        { SuppressionsService },
        { default: log },
        { default: RuntimeInfo },
        { default: createDebug },
        printResults,
    ] =
    await Promise.all
    (
        [
            importAsESLint('./lib/eslint/eslint.js'),
            importAsESLint('./lib/eslint/eslint-helpers.js'),
            importAsESLint('./lib/options.js'),
            importAsESLint('./lib/services/suppressions-service.js'),
            importAsESLint('./lib/shared/logging.js'),
            importAsESLint('./lib/shared/runtime-info.js'),
            importAsESLint('debug'),
            createPrintResults(importAsESLint),
        ],
    );

    const debug = createDebug('eslint:cli');

    await patchESLint(eslintDirURL, ESLint);

    async function execute(args, text)
    {
        if (Array.isArray(args))
            debug('CLI args: %o', args.slice(2));
        // Eslintrc config is not supported.
        const usingFlatConfig = await shouldUseFlatConfig();
        debug('Using flat config?', true);
        if (!usingFlatConfig)
        {
            log.error('eslint-p does not support legacy eslintrc configuration.');
            return 2;
        }
        const CLIOptions = createEnhancedCLIOptions(createCLIOptions);

        let options;
        try
        {
            options = CLIOptions.parse(args);
            validateOptions(options);
        }
        catch ({ message })
        {
            debug('Error parsing CLI options:', message);
            const { name, version } = await import('./package-info.js');
            const errorMessage =
            `${message}\nPlease see https://www.npmjs.com/package/${name}/v/${version
            }#usage for details.`;
            log.error(errorMessage);
            return 2;
        }
        if (options.help)
        {
            log.info(CLIOptions.generateHelp());
            return 0;
        }
        if (options.version)
        {
            const { version } = await import('./package-info.js');
            log.info(`eslint-p v${version}\nESLint ${RuntimeInfo.version()}`);
            return 0;
        }
        if (options.envInfo)
        {
            try
            {
                log.info(RuntimeInfo.environment());
                return 0;
            }
            catch (err)
            {
                debug('Error retrieving environment info');
                log.error(err.message);
                return 2;
            }
        }
        const files = options._;
        const useStdin = typeof text === 'string';
        if (options.printConfig)
        {
            if (files.length)
            {
                log.error('The --print-config option must be used with exactly one file name.');
                return 2;
            }
            if (useStdin)
            {
                log.error('The --print-config option is not available for piped-in code.');
                return 2;
            }
            const engine = await ESLint.fromCLIOptions(options);
            const fileConfig = await engine.calculateConfigForFile(options.printConfig);
            log.info(JSON.stringify(fileConfig, null, '  '));
            return 0;
        }
        if (options.inspectConfig)
        {
            log.info
            (
                'You can also run this command directly using \'npx ' +
                '@eslint/config-inspector@latest\' in the same directory as your configuration ' +
                'file.',
            );
            const overrideConfigFile = getOverrideConfigFile(options);
            const flags = await calculateInspectConfigFlags(overrideConfigFile);
            const { error } =
            spawnSync('npx', ['@eslint/config-inspector@latest', ...flags], { stdio: 'inherit' });
            if (error)
            {
                log.error(error);
                return 2;
            }
            return 0;
        }
        debug(`Running on ${useStdin ? 'text' : 'files'}`);
        if (options.fix && options.fixDryRun)
        {
            log.error('The --fix option and the --fix-dry-run option cannot be used together.');
            return 2;
        }
        if (useStdin && options.fix)
        {
            log.error
            ('The --fix option is not available for piped-in code; use --fix-dry-run instead.');
            return 2;
        }
        if (options.fixType && !options.fix && !options.fixDryRun)
        {
            log.error('The --fix-type option requires either --fix or --fix-dry-run.');
            return 2;
        }
        if
        (
            options.reportUnusedDisableDirectives &&
            options.reportUnusedDisableDirectivesSeverity !== undefined
        )
        {
            log.error
            (
                'The --report-unused-disable-directives option and the ' +
                '--report-unused-disable-directives-severity option cannot be used together.',
            );
            return 2;
        }
        if (options.ext)
        {
            // Passing `--ext ""` results in `options.ext` being an empty array.
            if (options.ext.length === 0)
            {
                log.error('The --ext option value cannot be empty.');
                return 2;
            }

            // Passing `--ext ,ts` results in an empty string at index 0. Passing `--ext ts,,tsx`
            // results in an empty string at index 1.
            const emptyStringIndex = options.ext.indexOf('');
            if (emptyStringIndex >= 0)
            {
                log.error
                (
                    'The --ext option arguments cannot be empty strings. Found an empty string ' +
                    `at index ${emptyStringIndex}.`,
                );
                return 2;
            }
        }
        if (options.suppressAll && options.suppressRule)
        {
            log.error
            ('The --suppress-all option and the --suppress-rule option cannot be used together.');
            return 2;
        }
        if (options.suppressAll && options.pruneSuppressions)
        {
            log.error
            (
                'The --suppress-all option and the --prune-suppressions option cannot be used ' +
                'together.',
            );
            return 2;
        }
        if (options.suppressRule && options.pruneSuppressions)
        {
            log.error
            (
                'The --suppress-rule option and the --prune-suppressions option cannot be used ' +
                'together.',
            );
            return 2;
        }
        if (useStdin && (options.suppressAll || options.suppressRule || options.pruneSuppressions))
        {
            log.error
            (
                'The --suppress-all, --suppress-rule, and --prune-suppressions options cannot be ' +
                'used with piped-in code.',
            );
            return 2;
        }
        let results;
        const engine = await ESLint.fromCLIOptions(options);
        if (useStdin)
            results = await engine.lintText(text, { filePath: options.stdinFilename });
        else
            results = await engine.lintFiles(files);
        if (options.fix)
        {
            debug('Fix mode enabled - applying fixes');
            await ESLint.outputFixes(results);
        }
        let unusedSuppressions = {};
        if (!useStdin)
        {
            const suppressionsFileLocation = getCacheFile
            (
                options.suppressionsLocation || 'eslint-suppressions.json',
                process.cwd(),
                { prefix: 'suppressions_' },
            );
            if
            (
                options.suppressionsLocation &&
                !existsSync(suppressionsFileLocation) &&
                !options.suppressAll &&
                !options.suppressRule
            )
            {
                log.error
                (
                    'The suppressions file does not exist. Please run the command with ' +
                    '`--suppress-all` or `--suppress-rule` to create it.',
                );
                return 2;
            }
            if
            (
                options.suppressAll ||
                options.suppressRule ||
                options.pruneSuppressions ||
                existsSync(suppressionsFileLocation)
            )
            {
                const suppressions =
                new SuppressionsService({ filePath: suppressionsFileLocation, cwd: process.cwd() });
                if (options.suppressAll || options.suppressRule)
                    await suppressions.suppress(results, options.suppressRule);
                if (options.pruneSuppressions)
                    await suppressions.prune(results);
                const suppressionResults =
                suppressions.applySuppressions(results, await suppressions.load());
                ({ results } = suppressionResults);
                unusedSuppressions = suppressionResults.unused;
            }
        }
        let resultsToPrint = results;
        if (options.quiet)
        {
            debug('Quiet mode enabled - filtering out warnings');
            resultsToPrint = ESLint.getErrorResults(resultsToPrint);
        }
        const resultCounts = countErrors(results);
        const tooManyWarnings =
        options.maxWarnings >= 0 && resultCounts.warningCount > options.maxWarnings;
        const resultsMeta =
        tooManyWarnings ?
        {
            maxWarningsExceeded:
            {
                maxWarnings:   options.maxWarnings,
                foundWarnings: resultCounts.warningCount,
            },
        } :
        { };
        if
        (
            await printResults
            (engine, resultsToPrint, options.format, options.outputFile, resultsMeta)
        )
        {
            // Errors and warnings from the original unfiltered results should determine the exit
            // code.
            const shouldExitForFatalErrors =
            options.exitOnFatalError && resultCounts.fatalErrorCount > 0;
            if (!resultCounts.errorCount && tooManyWarnings)
            {
                log.error
                (
                    'ESLint found too many warnings (maximum: %s).',
                    options.maxWarnings,
                );
            }
            const unusedSuppressionsCount =
            Object.keys(unusedSuppressions).length;
            if (unusedSuppressionsCount > 0)
            {
                log.error
                (
                    'There are suppressions left that do not occur anymore. Consider re-running ' +
                    'the command with `--prune-suppressions`.',
                );
                debug(JSON.stringify(unusedSuppressions, null, 2));
            }
            if (shouldExitForFatalErrors || unusedSuppressionsCount > 0)
                return 2;
            return resultCounts.errorCount || tooManyWarnings ? 1 : 0;
        }
        return 2;
    }

    return execute;
}

function createEnhancedCLIOptions(createCLIOptions)
{
    const { prototype } = Array;
    const { filter } = prototype;
    prototype.filter =
    function (...args)
    {
        prototype.filter = filter;
        const array = this.filter(...args);

        // Add --concurrency option.
        array.push
        (
            {
                option:     'concurrency',
                type:       'Int|String',
                default:    'auto',
                description:
                'Number of linting threads, auto to choose automatically, off to disable ' +
                'multithreading',
            },
        );

        return array;
    };
    return createCLIOptions(true);
}

export function validateOptions({ concurrency })
{
    if
    (
        concurrency != null &&
        (
            typeof concurrency === 'number' ?
            concurrency < 1 : concurrency !== 'auto' && concurrency !== 'off'
        )
    )
    {
        const message =
        'Invalid value for option \'concurrency\' - expected a positive integer, auto or off, ' +
        `received value: ${concurrency}.`;
        throw Error(message);
    }
}
