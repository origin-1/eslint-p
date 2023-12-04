/**
 * Predicate function for whether or not to apply fixes in quiet mode.
 * If a message is a warning, do not apply a fix.
 * @param {LintMessage} message The lint result.
 * @returns {boolean}
 * `true` if the lint message is an error (and thus should be autofixed), `false` otherwise.
 */
function quietFixPredicate(message)
{
    return message.severity === 2;
}

export default async function createTranslateOptions(importAsESLint)
{
    const [{ ModuleImporter }, { Legacy: { naming } }] =
    await Promise.all
    ([importAsESLint('@humanwhocodes/module-importer'), importAsESLint('@eslint/eslintrc')]);

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
            fix, // addition
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
            resolvePluginsRelativeTo, // addition
            rule,
            warnIgnored,
        },
    )
    {
        const importer = new ModuleImporter(resolvePluginsRelativeTo);
        let overrideConfigFile;
        overrideConfigFile = typeof config === 'string' ? config : !configLookup;
        if (overrideConfigFile === false)
            overrideConfigFile = void 0;
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
            reportUnusedDisableDirectives:  reportUnusedDisableDirectives ? 'error' : void 0,
            warnIgnored,
        };
        return options;
    }

    return translateOptions;
}
