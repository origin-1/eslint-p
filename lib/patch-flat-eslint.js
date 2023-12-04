import fs                       from 'node:fs/promises';
import { createRequire }        from 'node:module';
import path                     from 'node:path';
import { pathToFileURL }        from 'node:url';
import { Worker }               from 'node:worker_threads';
import createImportAs           from './create-import-as.js';
import createTranslateOptions   from './create-translate-options.js';

const FLAT_CONFIG_FILENAME = 'eslint.config.js';

/**
 * It will calculate the error and warning count for collection of messages per file
 * @param {LintMessage[]} messages Collection of messages
 * @returns {Object} Contains the stats
 * @private
 */
function calculateStatsPerFile(messages)
{
    const stat =
    {
        errorCount:          0,
        fatalErrorCount:     0,
        warningCount:        0,
        fixableErrorCount:   0,
        fixableWarningCount: 0,
    };

    for (let i = 0; i < messages.length; i++)
    {
        const message = messages[i];
        if (message.fatal || message.severity === 2)
        {
            stat.errorCount++;
            if (message.fatal)
                stat.fatalErrorCount++;
            if (message.fix)
                stat.fixableErrorCount++;
        }
        else
        {
            stat.warningCount++;
            if (message.fix)
                stat.fixableWarningCount++;
        }
    }
    return stat;
}

/**
 * Return the absolute path of a file named `"__placeholder__.js"` in a given directory.
 * This is used as a replacement for a missing file path.
 * @param {string} cwd An absolute directory path.
 * @returns {string}
 * The absolute path of a file named `"__placeholder__.js"` in the given directory.
 */
function getPlaceholderPath(cwd)
{
    return path.join(cwd, '__placeholder__.js');
}

export default async function patchFlatESLint(FlatESLint, eslintDirURL)
{
    const importAsESLint = createImportAs(eslintDirURL);
    const
    [
        { default: findUp },
        { getRuleFromConfig },
        { default: createDebug },
        { Legacy: { ConfigOps: { getRuleSeverity } } },
        { createIgnoreResult, findFiles, isArrayOfNonEmptyString, isNonEmptyString },
        { FlatConfigArray },
    ] =
    await Promise.all
    (
        [
            importAsESLint('find-up'),
            import(`${eslintDirURL}lib/config/flat-config-helpers.js`),
            importAsESLint('debug'),
            importAsESLint('@eslint/eslintrc'),
            import(`${eslintDirURL}lib/eslint/eslint-helpers.js`),
            import(`${eslintDirURL}lib/config/flat-config-array.js`),
        ],
    );

    const debug = createDebug('eslint:flat-eslint');
    const requireCache = createRequire(import.meta.url).cache;

    let privateMembers;

    const { prototype } = WeakMap;
    const { set } = prototype;
    let count = 0;
    prototype.set =
    function (...args)
    {
        if (++count === 2)
            privateMembers = this;
        return Reflect.apply(set, this, args);
    };
    try
    {
        new FlatESLint();
    }
    finally
    {
        prototype.set = set;
    }

    const translateOptions = await createTranslateOptions(importAsESLint);

    const importedConfigFileModificationTime = new Map();

    /** @type {WeakMap<ExtractedConfig, DeprecatedRuleInfo[]>} */
    const usedDeprecatedRulesCache = new WeakMap();

    /** @type {WeakMap<FlatESLint, ParsedCLIOptions>} */
    const cliOptionsMap = new WeakMap();

    /**
     * Checks whether a message's rule type should be fixed.
     * @param {LintMessage} message The message to check.
     * @param {FlatConfig} config The config for the file that generated the message.
     * @param {string[]} fixTypes An array of fix types to check.
     * @returns {boolean} Whether the message should be fixed.
     */
    function shouldMessageBeFixed(message, config, fixTypes)
    {
        if (!message.ruleId)
            return fixTypes.has('directive');
        const rule = message.ruleId && getRuleFromConfig(message.ruleId, config);
        return Boolean(rule && rule.meta && fixTypes.has(rule.meta.type));
    }

    /**
     * Create used deprecated rule list.
     * @param {CLIEngine} eslint The CLIEngine instance.
     * @param {string} maybeFilePath The absolute path to a lint target file or `"<text>"`.
     * @returns {DeprecatedRuleInfo[]} The used deprecated rule list.
     */
    function getOrFindUsedDeprecatedRules(eslint, maybeFilePath)
    {
        const { configs, options: { cwd } } = privateMembers.get(eslint);
        const filePath = path.isAbsolute(maybeFilePath) ?
        maybeFilePath :
        getPlaceholderPath(cwd);
        const config = configs.getConfig(filePath);
        // Most files use the same config, so cache it.
        if (config && !usedDeprecatedRulesCache.has(config))
        {
            const retv = [];
            if (config.rules)
            {
                for (const [ruleId, ruleConf] of Object.entries(config.rules))
                {
                    if (getRuleSeverity(ruleConf) === 0)
                        continue;
                    const rule = getRuleFromConfig(ruleId, config);
                    const meta = rule && rule.meta;
                    if (meta && meta.deprecated)
                        retv.push({ ruleId, replacedBy: meta.replacedBy || [] });
                }
            }
            usedDeprecatedRulesCache.set(config, Object.freeze(retv));
        }
        return config ? usedDeprecatedRulesCache.get(config) : Object.freeze([]);
    }

    /**
     * Processes the linting results generated by a CLIEngine linting report to
     * match the ESLint class's API.
     * @param {CLIEngine} eslint The CLIEngine instance.
     * @param {CLIEngineLintReport} report The CLIEngine linting report to process.
     * @returns {LintResult[]} The processed linting results.
     */
    function processLintReport(eslint, { results })
    {
        const descriptor =
        {
            configurable: true,
            enumerable:   true,
            get()
            {
                return getOrFindUsedDeprecatedRules(eslint, this.filePath);
            },
        };
        for (const result of results)
            Object.defineProperty(result, 'usedDeprecatedRules', descriptor);
        return results;
    }

    /**
     * Searches from the current working directory up until finding the
     * given flat config filename.
     * @param {string} cwd The current working directory to search from.
     * @returns {Promise<string|undefined>} The filename if found or `undefined` if not.
     */
    function findFlatConfigFile(cwd)
    {
        return findUp(FLAT_CONFIG_FILENAME, { cwd });
    }

    /**
     * Determines which config file to use. This is determined by seeing if an
     * override config file was passed, and if so, using it; otherwise, as long
     * as override config file is not explicitly set to `false`, it will search
     * upwards from the cwd for a file named `eslint.config.js`.
     * @param {import("./eslint").ESLintOptions} options The ESLint instance options.
     * @returns {{configFilePath:string|undefined,basePath:string,error:Error|null}}
     * Location information for the config file.
     */
    async function locateConfigFileToUse({ configFile, cwd })
    {
        // determine where to load config file from
        let configFilePath;
        let basePath = cwd;
        let error = null;

        if (typeof configFile === 'string')
        {
            debug(`Override config file path is ${configFile}`);
            configFilePath = path.resolve(cwd, configFile);
        }
        else if (configFile !== false)
        {
            debug('Searching for eslint.config.js');
            configFilePath = await findFlatConfigFile(cwd);
            if (configFilePath)
                basePath = path.resolve(path.dirname(configFilePath));
            else
                error = Error('Could not find config file.');
        }
        return {
            configFilePath,
            basePath,
            error,
        };
    }

    /**
     * Load the config array from the given filename.
     * @param {string} filePath The filename to load from.
     * @returns {Promise<any>} The config loaded from the config file.
     */
    async function loadFlatConfigFile(filePath)
    {
        debug(`Loading config from ${filePath}`);
        const fileURL = pathToFileURL(filePath);
        debug(`Config file URL is ${fileURL}`);
        const mtime = (await fs.stat(filePath)).mtime.getTime();

        /*
        * Append a query with the config file's modification time (`mtime`) in order
        * to import the current version of the config file. Without the query, `import()` would
        * cache the config file module by the pathname only, and then always return
        * the same version (the one that was actual when the module was imported for the first
        * time).
        *
        * This ensures that the config file module is loaded and executed again
        * if it has been changed since the last time it was imported.
        * If it hasn't been changed, `import()` will just return the cached version.
        *
        * Note that we should not overuse queries (e.g., by appending the current time
        * to always reload the config file module) as that could cause memory leaks
        * because entries are never removed from the import cache.
        */
        fileURL.searchParams.append('mtime', mtime);

        /*
        * With queries, we can bypass the import cache. However, when import-ing a CJS module,
        * Node.js uses the require infrastructure under the hood. That includes the require cache,
        * which caches the config file module by its file path (queries have no effect).
        * Therefore, we also need to clear the require cache before importing the config file
        * module.
        * In order to get the same behavior with ESM and CJS config files, in particular - to reload
        * the config file only if it has been changed, we track file modification times and clear
        * the require cache only if the file has been changed.
        */
        if (importedConfigFileModificationTime.get(filePath) !== mtime)
            delete requireCache[filePath];
        const config = (await import(fileURL)).default;
        importedConfigFileModificationTime.set(filePath, mtime);
        return config;
    }

    /**
     * Calculates the config array for this run based on inputs.
     * @param {FlatESLint} eslint The instance to create the config array for.
     * @param {import("./eslint").ESLintOptions} options The ESLint instance options.
     * @returns {FlatConfigArray} The config array for `eslint``.
     */
    async function calculateConfigArray
    (
        eslint,
        {
            cwd,
            baseConfig,
            overrideConfig,
            configFile,
            ignore: shouldIgnore,
            ignorePatterns,
        },
    )
    {
        // check for cached instance
        const slots = privateMembers.get(eslint);
        if (slots.configs)
            return slots.configs;
        const { configFilePath, basePath, error } =
        await locateConfigFileToUse({ configFile, cwd });
        // config file is required to calculate config
        if (error)
            throw error;
        const configs = new FlatConfigArray(baseConfig || [], { basePath, shouldIgnore });
        // load config file
        if (configFilePath)
        {
            const fileConfig = await loadFlatConfigFile(configFilePath);
            if (Array.isArray(fileConfig))
                configs.push(...fileConfig);
            else
                configs.push(fileConfig);
        }
        // add in any configured defaults
        configs.push(...slots.defaultConfigs);
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
                const relativeIgnorePath = path.relative(basePath, cwd);
                relativeIgnorePatterns = ignorePatterns.map
                (
                    pattern =>
                    {
                        const negated = pattern.startsWith('!');
                        const basePattern = negated ? pattern.slice(1) : pattern;

                        return (negated ? '!' : '') +
                        path.posix.join(relativeIgnorePath, basePattern);
                    },
                );
            }

            /*
            * Ignore patterns are added to the end of the config array
            * so they can override default ignores.
            */
            configs.push
            (
                {
                    ignores: relativeIgnorePatterns,
                },
            );
        }

        if (overrideConfig)
        {
            if (Array.isArray(overrideConfig))

                configs.push(...overrideConfig);

            else

                configs.push(overrideConfig);
        }

        await configs.normalize();

        // cache the config array for this instance
        slots.configs = configs;

        return configs;
    }

    /**
     * Processes an source code using ESLint.
     * @param {Object} config The config object.
     * @param {string} config.text The source code to verify.
     * @param {string} config.cwd The path to the current working directory.
     * @param {string|undefined} config.filePath
     * The path to the file of `text`. If this is undefined, it uses `<text>`.
     * @param {FlatConfigArray} config.configs The config.
     * @param {boolean} config.fix If `true` then it does fix.
     * @param {boolean} config.allowInlineConfig If `true` then it uses directive comments.
     * @param {boolean} config.reportUnusedDisableDirectives
     * If `true` then it reports unused `eslint-disable` comments.
     * @param {Linter} config.linter The linter instance to verify.
     * @returns {LintResult} The result of linting.
     * @private
     */
    function verifyText
    (
        {
            text,
            cwd,
            filePath: providedFilePath,
            configs,
            fix,
            allowInlineConfig,
            reportUnusedDisableDirectives,
            linter,
        },
    )
    {
        const filePath = providedFilePath || '<text>';
        debug(`Lint ${filePath}`);

        /*
         * Verify.
         * `config.extractConfig(filePath)` requires an absolute path, but `linter`
         * doesn't know CWD, so it gives `linter` an absolute path always.
         */
        const filePathToVerify = filePath === '<text>' ? getPlaceholderPath(cwd) : filePath;
        const { fixed, messages, output } = linter.verifyAndFix
        (
            text,
            configs,
            {
                allowInlineConfig,
                filename: filePathToVerify,
                fix,
                reportUnusedDisableDirectives,

                /**
                 * Check if the linter should adopt a given code block or not.
                 * @param {string} blockFilename The virtual filename of a code block.
                 * @returns {boolean} `true` if the linter should adopt the code block.
                 */
                filterCodeBlock(blockFilename)
                {
                    return configs.isExplicitMatch(blockFilename);
                },
            },
        );

        // Tweak and return.
        const result =
        {
            filePath:           filePath === '<text>' ? filePath : path.resolve(filePath),
            messages,
            suppressedMessages: linter.getSuppressedMessages(),
            ...calculateStatsPerFile(messages),
        };

        if (fixed)
            result.output = output;

        if
        (
            result.errorCount + result.warningCount > 0 &&
            typeof result.output === 'undefined'
        )
            result.source = text;

        return result;
    }

    async function fromCLIOptions(cliOptions)
    {
        const eslintOptions = await translateOptions(cliOptions);
        const engine = new FlatESLint(eslintOptions);
        cliOptionsMap.set(engine, cliOptions);
        return engine;
    }

    async function createLintSingleFile()
    {
        const
        {
            lintResultCache,
            linter,
            options: eslintOptions,
        } =
        privateMembers.get(this);
        const configs = await calculateConfigArray(this, eslintOptions);
        const
        {
            allowInlineConfig,
            cwd,
            fix,
            fixTypes,
            reportUnusedDisableDirectives,
            warnIgnored,
        } =
        eslintOptions;
        const fixTypesSet = fixTypes ? new Set(fixTypes) : null;

        function lintSingleFile({ filePath, ignored })
        {
            /*
             * If a filename was entered that matches an ignore
             * pattern, then notify the user.
             */
            if (ignored)
            {
                if (warnIgnored)
                    return createIgnoreResult(filePath, cwd);
                return void 0;
            }

            const config = configs.getConfig(filePath);

            /*
             * Sometimes a file found through a glob pattern will
             * be ignored. In this case, `config` will be undefined
             * and we just silently ignore the file.
             */
            if (!config)
                return void 0;

            // Skip if there is cached result.
            if (lintResultCache)
            {
                const cachedResult =
                lintResultCache.getCachedLintResults(filePath, config);
                if (cachedResult)
                {
                    const hadMessages =
                    cachedResult.messages &&
                    cachedResult.messages.length > 0;

                    if (hadMessages && fix)
                        debug(`Reprocessing cached file to allow autofix: ${filePath}`);
                    else
                    {
                        debug(`Skipping file since it hasn't changed: ${filePath}`);
                        return cachedResult;
                    }
                }
            }

            // set up fixer for fixTypes if necessary
            let fixer = fix;
            if (fix && fixTypesSet)
            {
                // save original value of options.fix in case it's a function
                const originalFix = typeof fix === 'function' ? fix : () => true;

                fixer =
                message =>
                shouldMessageBeFixed(message, config, fixTypesSet) && originalFix(message);
            }
            return fs.readFile(filePath, 'utf8')
            .then
            (
                text =>
                {
                    // do the linting
                    const result =
                    verifyText
                    (
                        {
                            text,
                            filePath,
                            configs,
                            cwd,
                            fix: fixer,
                            allowInlineConfig,
                            reportUnusedDisableDirectives,
                            linter,
                        },
                    );
                    return result;
                },
            );
        }

        return lintSingleFile;
    }

    /**
     * Executes the current configuration on an array of file and directory names.
     * @param {string|string[]} patterns An array of file and directory names.
     * @returns {Promise<LintResult[]>} The results of linting the file patterns given.
     */
    async function lintParallel(patterns)
    {
        if (!isNonEmptyString(patterns) && !isArrayOfNonEmptyString(patterns))
            throw Error('\'patterns\' must be a non-empty string or an array of non-empty strings');
        const
        {
            cacheFilePath,
            lintResultCache,
            options: eslintOptions,
        } =
        privateMembers.get(this);
        const configs = await calculateConfigArray(this, eslintOptions);
        const
        {
            cache,
            cwd,
            globInputPaths,
            errorOnUnmatchedPattern,
        } =
        eslintOptions;
        const startTime = Date.now();

        // Delete cache file; should this be done here?
        if (!cache && cacheFilePath)
        {
            debug(`Deleting cache file at ${cacheFilePath}`);

            try
            {
                await fs.unlink(cacheFilePath);
            }
            catch (error)
            {
                const errorCode = error && error.code;
                // Ignore errors when no such file exists or file system is read only (and cache
                // file does not exist).
                if
                (
                    errorCode !== 'ENOENT' &&
                    !(errorCode === 'EROFS' && !await fs.exists(cacheFilePath))
                )
                    throw error;
            }
        }

        const filePaths =
        await findFiles
        (
            {
                patterns: typeof patterns === 'string' ? [patterns] : patterns,
                cwd,
                globInputPaths,
                configs,
                errorOnUnmatchedPattern,
            },
        );

        debug(`${filePaths.length} files found in: ${Date.now() - startTime}ms`);

        let currentIndex = 0;

        function getNextFile()
        {
            if (currentIndex < filePaths.length)
            {
                const filePathInfo = filePaths[currentIndex];
                filePathInfo.index = currentIndex++;
                return filePathInfo;
            }
        }

        const workerURL = new URL('./lint-files-async.js', import.meta.url);
        const workerOptions =
        {
            workerData:
            {
                eslintDirURL: String(eslintDirURL),
                cliOptions:   cliOptionsMap.get(this),
            },
        };

        const results = Array(filePaths.length);
        const workerExecutor =
        (resolve, reject) =>
        {
            const worker = new Worker(workerURL, workerOptions);

            function postNextFile()
            {
                const filePathInfo = getNextFile();
                worker.postMessage(filePathInfo);
                if (!filePathInfo)
                    resolve();
            }

            worker.on
            (
                'message',
                ({ index, result }) =>
                {
                    results[index] = result;
                    postNextFile();
                },
            );
            worker.on
            (
                'error',
                error =>
                {
                    currentIndex = filePaths.length;
                    reject(error);
                },
            );
            postNextFile();
        };
        let { concurrency } = cliOptionsMap.get(this);
        if (!(concurrency >= 1))
            concurrency = 1;
        const promises = Array(concurrency);
        for (let index = 0; index < concurrency; ++index)
            promises[index] = new Promise(workerExecutor);
        await Promise.all(promises);

        // Persist the cache to disk.
        if (lintResultCache)
        {
            filePaths.forEach
            (
                ({ filePath }, index) =>
                {
                    const result = results[index];
                    if (result)
                    {
                        const config = configs.getConfig(filePath);

                        /*
                         * Store the lint result in the LintResultCache.
                         * NOTE: The LintResultCache will remove the file source and any
                         * other properties that are difficult to serialize, and will
                         * hydrate those properties back in on future lint runs.
                         */
                        lintResultCache.setCachedLintResults(filePath, config, result);
                    }
                },
            );
            lintResultCache.reconcile();
        }
        const finalResults = results.filter(result => !!result);
        return processLintReport(this, { results: finalResults });
    }

    FlatESLint.fromCLIOptions = fromCLIOptions;
    FlatESLint.prototype.createLintSingleFile = createLintSingleFile;
    FlatESLint.prototype.lintParallel = lintParallel;
}
