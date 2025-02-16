import { relative }                 from 'node:path';
import { join as posixJoin }        from 'node:path/posix';
import createLoadConfigFile         from '../grab/create-load-config-file.js';
import emitEmptyConfigFileWarning   from './emit-empty-config-file-warning.js';

export default async function patchCalculateConfigArray(importAsESLint)
{
    const [{ ConfigLoader }, { FlatConfigArray }, { default: createDebug }, loadConfigFile] =
    await Promise.all
    (
        [
            importAsESLint('./lib/config/config-loader.js'),
            importAsESLint('./lib/config/flat-config-array.js'),
            importAsESLint('debug'),
            createLoadConfigFile(importAsESLint),
        ],
    );

    const debug = createDebug('eslint:config-loader');
    let nextIssueEmptyConfigFileWarning = null;
    const issueEmptyConfigFileWarningMap = new WeakMap();

    /**
     * Calculates the config array for this run based on inputs.
     * This method is exposed internally for testing purposes.
     * @param {string} configFilePath The absolute path to the config file to use if not overridden.
     * @param {string} basePath The base path to use for relative paths in the config file.
     * @param {ConfigLoaderOptions} options The options to use when loading configuration files.
     * @returns {Promise<FlatConfigArray>} The config array for `eslint`.
     */
    async function calculateConfigArray(configFilePath, basePath, options)
    {
        const
        {
            cwd,
            baseConfig,
            ignoreEnabled,
            ignorePatterns,
            overrideConfig,
            defaultConfigs = [],
        } =
        options;
        if (nextIssueEmptyConfigFileWarning != null)
        {
            issueEmptyConfigFileWarningMap.set(options, nextIssueEmptyConfigFileWarning);
            nextIssueEmptyConfigFileWarning = null;
        }
        debug
        (`Calculating config array from config file ${configFilePath} and base path ${basePath}`);
        const configs =
        new FlatConfigArray(baseConfig || [], { basePath, shouldIgnore: ignoreEnabled });

        // load config file
        if (configFilePath)
        {
            debug(`Loading config file ${configFilePath}`);
            const fileConfig = await loadConfigFile(configFilePath);

            /*
             * It's possible that a config file could be empty or else
             * have an empty object or array. In this case, we want to
             * warn the user that they have an empty config.
             *
             * An empty CommonJS file exports an empty object while
             * an empty ESM file exports undefined.
             */
            let emptyConfig = typeof fileConfig === 'undefined';
            debug(`Config file ${configFilePath} is ${emptyConfig ? 'empty' : 'not empty'}`);
            if (!emptyConfig)
            {
                if (Array.isArray(fileConfig))
                {
                    if (fileConfig.length === 0)
                    {
                        debug(`Config file ${configFilePath} is an empty array`);
                        emptyConfig = true;
                    }
                    else
                        configs.push(...fileConfig);
                }
                else
                {
                    if
                    (
                        typeof fileConfig === 'object' &&
                        fileConfig !== null &&
                        Object.keys(fileConfig).length === 0
                    )
                    {
                        debug(`Config file ${configFilePath} is an empty object`);
                        emptyConfig = true;
                    }
                    else
                        configs.push(fileConfig);
                }
            }
            if (emptyConfig)
            {
                const issueEmptyConfigFileWarning =
                issueEmptyConfigFileWarningMap.get(options) ?? emitEmptyConfigFileWarning;
                issueEmptyConfigFileWarning(configFilePath);
            }
        }

        // add in any configured defaults
        configs.push(...defaultConfigs);

        // append command line ignore patterns
        if (ignorePatterns && ignorePatterns.length > 0)
        {
            let relativeIgnorePatterns;

            /*
             * If the config file basePath is different than the cwd, then
             * the ignore patterns won't work correctly. Here, we adjust the
             * ignore pattern to include the correct relative path. Patterns
             * passed as `ignorePatterns` are relative to the cwd, whereas
             * the config file basePath can be an ancestor of the cwd.
             */
            if (basePath === cwd)
                relativeIgnorePatterns = ignorePatterns;
            else
            {
                // relative path must only have Unix-style separators
                const relativeIgnorePath = relative(basePath, cwd).replace(/\\/gu, '/');
                relativeIgnorePatterns =
                ignorePatterns.map
                (
                    pattern =>
                    {
                        const negated = pattern.startsWith('!');
                        const basePattern = negated ? pattern.slice(1) : pattern;
                        return (negated ? '!' : '') + posixJoin(relativeIgnorePath, basePattern);
                    },
                );
            }

            /*
             * Ignore patterns are added to the end of the config array
             * so they can override default ignores.
             */
            configs.push({ ignores: relativeIgnorePatterns });
        }
        if (overrideConfig)
        {
            if (Array.isArray(overrideConfig))
                configs.push(...overrideConfig);
            else
                configs.push(overrideConfig);
        }
        await configs.normalize();
        return configs;
    }

    function setNextIssueEmptyConfigFileWarning(value)
    {
        nextIssueEmptyConfigFileWarning = value;
        const unsetNextIssueEmptyConfigFileWarning =
        () =>
        {
            if (nextIssueEmptyConfigFileWarning === value)
                nextIssueEmptyConfigFileWarning = null;
        };
        return unsetNextIssueEmptyConfigFileWarning;
    }

    ConfigLoader.calculateConfigArray = calculateConfigArray;
    return setNextIssueEmptyConfigFileWarning;
}
