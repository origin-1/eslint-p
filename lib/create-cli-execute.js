import { spawnSync }                from 'node:child_process';
import { readFile }                 from 'node:fs/promises';
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
        { default: createCLIOptions },
        { default: log },
        { default: RuntimeInfo },
        { default: createDebug },
        printResults,
    ] =
    await Promise.all
    (
        [
            importAsESLint('./lib/eslint/eslint.js'),
            importAsESLint('./lib/options.js'),
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
            log.error('eslint-p requires flat config');
            return 2;
        }
        const CLIOptions = createCLIOptions(true);

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
            const flags =
            await calculateInspectConfigFlags
            (overrideConfigFile, options.flag?.includes('unstable_ts_config') ?? false);
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
        let results;
        const engine = await ESLint.fromCLIOptions(options);
        if (useStdin)
            results = await engine.lintText(text, { filePath: options.stdinFilename });
        else
            results = await engine.lintParallel(files);
        if (options.fix)
        {
            debug('Fix mode enabled - applying fixes');
            await ESLint.outputFixes(results);
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
            if (shouldExitForFatalErrors)
                return 2;
            return resultCounts.errorCount || tooManyWarnings ? 1 : 0;
        }
        return 2;
    }

    return execute;
}
