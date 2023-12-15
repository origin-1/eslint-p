import quietFixPredicate from '../grab/quiet-fix-predicate.js';

export default async function createTranslateOptions(importAsESLint)
{
    const [{ normalizeSeverityToString }, { ModuleImporter }, { Legacy: { naming } }] =
    await Promise.all
    (
        [
            importAsESLint('./lib/shared/severity.js'),
            importAsESLint('@humanwhocodes/module-importer'),
            importAsESLint('@eslint/eslintrc'),
        ],
    );

    /**
     * Translates the CLI options into the options expected by the ESLint constructor.
     * @param {ParsedCLIOptions} cliOptions The CLI options to translate.
     * @returns {Promise<ESLintOptions>} The options object for the ESLint constructor.
     * @private
     */
    async function translateOptions
    (
        {
            cache,
            cacheFile,
            cacheLocation,
            cacheStrategy,
            config,
            configLookup,
            cwd, // addition
            errorOnUnmatchedPattern,
            fix,
            fixDryRun,
            fixType,
            globInputPaths, // addition
            global,
            ignore,
            ignorePattern,
            inlineConfig,
            overrideConfig, // addition
            parser,
            parserOptions,
            plugin,
            quiet,
            reportUnusedDisableDirectives,
            reportUnusedDisableDirectivesSeverity,
            resolvePluginsRelativeTo, // addition
            rule,
            warnIgnored, // addition
        },
    )
    {
        const importer = new ModuleImporter(resolvePluginsRelativeTo);
        const overrideConfigFile =
        typeof config === 'string' ? config : !configLookup || undefined;
        let globals = { };
        if (global)
        {
            globals = global.reduce
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
        if (!overrideConfig)
        {
            overrideConfig =
            [
                {
                    languageOptions:
                    {
                        globals,
                        parserOptions: parserOptions || { },
                    },
                },
            ];
        }
        else if (!Array.isArray(overrideConfig))
            overrideConfig = [structuredClone(overrideConfig)];
        else
            overrideConfig = structuredClone(overrideConfig);
        if
        (
            reportUnusedDisableDirectives ||
            reportUnusedDisableDirectivesSeverity !== void 0
        )
        {
            overrideConfig[0].linterOptions =
            {
                reportUnusedDisableDirectives:
                reportUnusedDisableDirectives ?
                'error' : normalizeSeverityToString(reportUnusedDisableDirectivesSeverity),
            };
        }
        if (parser)
            overrideConfig[0].languageOptions.parser = await importer.import(parser);
        if (plugin)
        {
            const plugins = { };
            for (const pluginName of plugin)
            {
                const shortName = naming.getShorthandName(pluginName, 'eslint-plugin');
                const longName = naming.normalizePackageName(pluginName, 'eslint-plugin');
                plugins[shortName] = await importer.import(longName);
            }
            overrideConfig[0].plugins = plugins;
        }
        if (rule)
            overrideConfig[0].rules = { ...overrideConfig[0].rules, ...rule };
        const options =
        {
            allowInlineConfig:              inlineConfig,
            cache,
            cacheLocation:                  cacheLocation || cacheFile,
            cacheStrategy,
            cwd, // addition
            errorOnUnmatchedPattern,
            fix:
            (fix || fixDryRun) && (quiet ? quietFixPredicate : true),
            fixTypes:                       fixType,
            globInputPaths, // addition
            ignore,
            ignorePatterns:                 ignorePattern,
            overrideConfig,
            overrideConfigFile,
            warnIgnored, // addition
        };
        return options;
    }

    return translateOptions;
}
