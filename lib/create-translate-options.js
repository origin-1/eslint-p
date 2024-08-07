import createLoadPlugins    from '../grab/create-load-plugins.js';
import quietFixPredicate    from '../grab/quiet-fix-predicate.js';
import quietRuleFilter      from '../grab/quiet-rule-filter.js';

export function getOverrideConfigFile({ config, configLookup })
{
    const overrideConfigFile = typeof config === 'string' ? config : !configLookup || undefined;
    return overrideConfigFile;
}

export default async function createTranslateOptions(importAsESLint)
{
    const [{ normalizeSeverityToString }, { ModuleImporter }, loadPlugins] =
    await Promise.all
    (
        [
            importAsESLint('./lib/shared/severity.js'),
            importAsESLint('@humanwhocodes/module-importer'),
            createLoadPlugins(importAsESLint),
        ],
    );

    /**
     * Translates the CLI options into the options expected by the ESLint constructor.
     * @param {ParsedCLIOptions} cliOptions The CLI options to translate.
     * @returns {Promise<ESLintOptions>} The options object for the ESLint constructor.
     * @private
     */
    async function translateOptions(cliOptions)
    {
        const
        {
            cache,
            cacheFile,
            cacheLocation,
            cacheStrategy,
            cwd, // addition
            errorOnUnmatchedPattern,
            fix,
            fixDryRun,
            fixType,
            flag,
            globInputPaths, // addition
            global,
            ignore,
            ignorePattern,
            inlineConfig,
            maxWarnings,
            parser,
            parserOptions,
            passOnNoPatterns,
            plugin,
            quiet,
            reportUnusedDisableDirectives,
            reportUnusedDisableDirectivesSeverity,
            resolvePluginsRelativeTo, // addition
            rule,
            stats,
            warnIgnored,
        } =
        cliOptions;
        let { overrideConfig } = cliOptions; // addition
        const overrideConfigFile = getOverrideConfigFile(cliOptions);
        if (!overrideConfig)
        {
            const importer = new ModuleImporter(resolvePluginsRelativeTo);
            let globals = { };
            if (global)
            {
                globals =
                global.reduce
                (
                    (obj, name) =>
                    {
                        if (name.endsWith(':true'))
                            obj[name.slice(0, -5)] = 'writable';
                        else
                            obj[name] = 'readonly';
                        return obj;
                    },
                    globals,
                );
            }
            const languageOptions = { globals, parserOptions: parserOptions ?? { } };
            const linterOptions =
            reportUnusedDisableDirectives || reportUnusedDisableDirectivesSeverity !== undefined ?
            {
                reportUnusedDisableDirectives:
                reportUnusedDisableDirectives ?
                'error' : normalizeSeverityToString(reportUnusedDisableDirectivesSeverity),
            } :
            { };
            if (parser)
                languageOptions.parser = await importer.import(parser);
            const plugins = plugin ? await loadPlugins(importer, plugin) : { };
            overrideConfig = [{ languageOptions, linterOptions, plugins, rules: rule ?? { } }];
        }

        /*
         * For performance reasons rules not marked as 'error' are filtered out in quiet mode. As
         * maxWarnings requires rules set to 'warn' to be run, we only filter out 'warn' rules if
         * maxWarnings is not specified.
         */
        const ruleFilter = quiet && maxWarnings === -1 ? quietRuleFilter : () => true;
        const options =
        {
            allowInlineConfig:  inlineConfig,
            cache,
            cacheLocation:      cacheLocation || cacheFile,
            cacheStrategy,
            cwd, // addition
            errorOnUnmatchedPattern,
            fix:                (fix || fixDryRun) && (quiet ? quietFixPredicate : true),
            fixTypes:           fixType,
            flags:              flag,
            globInputPaths, // addition
            ignore,
            ignorePatterns:     ignorePattern,
            overrideConfig,
            overrideConfigFile,
            passOnNoPatterns,
            ruleFilter,
            stats,
            warnIgnored,
        };
        return options;
    }

    return translateOptions;
}
