import { readFile }         from 'node:fs/promises';
import countErrors          from '../grab/count-errors.js';
import createPrintResults   from '../grab/create-print-results.js';
import createImportAs       from './create-import-as.js';
import patchFlatESLint      from './patch-flat-eslint.js';

export default async function createCLIExecute(eslintDirURL)
{
    const importAsESLint = createImportAs(eslintDirURL);
    const
    [
        { FlatESLint, shouldUseFlatConfig },
        { default: createCLIOptions },
        { default: log },
        { default: RuntimeInfo },
        { default: createDebug },
        printResults,
    ] =
    await Promise.all
    (
        [
            import(`${eslintDirURL}lib/eslint/flat-eslint.js`),
            import(`${eslintDirURL}lib/options.js`),
            import(`${eslintDirURL}lib/shared/logging.js`),
            import(`${eslintDirURL}lib/shared/runtime-info.js`),
            importAsESLint('debug'),
            createPrintResults(eslintDirURL),
        ],
    );

    const debug = createDebug('eslint:cli');

    await patchFlatESLint(FlatESLint, eslintDirURL);

    async function execute(args, text, allowFlatConfig)
    {
        if (Array.isArray(args))
            debug('CLI args: %o', args.slice(2));

        // Eslintrc config is not supported.
        const usingFlatConfig = allowFlatConfig && await shouldUseFlatConfig();
        if (!usingFlatConfig)
        {
            log.error('eslint-p requires flat config');
            return 2;
        }
        debug('Using flat config?', true);

        const CLIOptions = createCLIOptions(true);

        /* @type {ParsedCLIOptions} */
        let options;
        try
        {
            options = CLIOptions.parse(args);
        }
        catch (error)
        {
            debug('Error parsing CLI options:', error.message);
            const errorMessage =
            `${error.message
            }\nYou're using eslint.config.js, some command line flags are no longer available. ` +
            'Please see https://eslint.org/docs/latest/use/command-line-interface for details.';
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
            const pkgURL = new URL('../package.json', import.meta.url);
            const { version } = JSON.parse(await readFile(pkgURL));
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
            const engine = await FlatESLint.fromCLIOptions(options);
            const fileConfig = await engine.calculateConfigForFile(options.printConfig);
            log.info(JSON.stringify(fileConfig, null, '  '));
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

        let results;
        const engine = await FlatESLint.fromCLIOptions(options);
        if (useStdin)
            results = await engine.lintText(text, { filePath: options.stdinFilename });
        else
            results = await engine.lintParallel(files);
        if (options.fix)
        {
            debug('Fix mode enabled - applying fixes');
            await FlatESLint.outputFixes(results);
        }
        let resultsToPrint = results;
        if (options.quiet)
        {
            debug('Quiet mode enabled - filtering out warnings');
            resultsToPrint = FlatESLint.getErrorResults(resultsToPrint);
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
            if (shouldExitForFatalErrors)
                return 2;
            return resultCounts.errorCount || tooManyWarnings ? 1 : 0;
        }
        return 2;
    }

    return execute;
}
