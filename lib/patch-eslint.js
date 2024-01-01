import { existsSync }               from 'node:fs';
import fs                           from 'node:fs/promises';
import { Worker }                   from 'node:worker_threads';
import createCalculateConfigArray   from '../grab/create-calculate-config-array.js';
import createProcessLintReport      from '../grab/create-process-lint-report.js';
import createShouldMessageBeFixed   from '../grab/create-should-message-be-fixed.js';
import createVerifyText             from '../grab/create-verify-text.js';
import createImportAs               from './create-import-as.js';
import createTranslateOptions       from './create-translate-options.js';

function grabPrivateMembers(ESLint)
{
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
        new ESLint();
    }
    finally
    {
        prototype.set = set;
    }
    return privateMembers;
}

export default async function patchESLint(ESLint, eslintDirURL)
{
    /** type {WeakMap<ESLint, Record<string, unknown>>} */
    const privateMembers = grabPrivateMembers(ESLint);

    const importAsESLint = createImportAs(eslintDirURL);
    const
    [
        { createIgnoreResult, findFiles, isArrayOfNonEmptyString, isNonEmptyString },
        { default: createDebug },
        calculateConfigArray,
        processLintReport,
        shouldMessageBeFixed,
        verifyText,
    ] =
    await Promise.all
    (
        [
            import(`${eslintDirURL}lib/eslint/eslint-helpers.js`),
            importAsESLint('debug'),
            createCalculateConfigArray(eslintDirURL, privateMembers),
            createProcessLintReport(eslintDirURL, privateMembers),
            createShouldMessageBeFixed(eslintDirURL),
            createVerifyText(eslintDirURL),
        ],
    );

    /** @type {WeakMap<ESLint, ParsedCLIOptions>} */
    const cliOptionsMap = new WeakMap();

    const debug = createDebug('eslint:eslint');

    // fromCLIOptions //////////////////////////////////////////////////////////////////////////////

    const translateOptions = await createTranslateOptions(importAsESLint);

    async function fromCLIOptions(cliOptions = { })
    {
        const eslintOptions = await translateOptions(cliOptions);
        const engine = new ESLint(eslintOptions);
        cliOptionsMap.set(engine, cliOptions);
        return engine;
    }

    // createLintSingleFile ////////////////////////////////////////////////////////////////////////

    async function createLintSingleFile()
    {
        const { lintResultCache, linter, options: eslintOptions } = privateMembers.get(this);
        const configs = await calculateConfigArray(this, eslintOptions);
        const { allowInlineConfig, cwd, fix, fixTypes, ruleFilter, warnIgnored } = eslintOptions;
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
            // Skip if there is cached result.
            if (lintResultCache)
            {
                const cachedResult = lintResultCache.getCachedLintResults(filePath, config);
                if (cachedResult)
                {
                    const hadMessages = cachedResult.messages && cachedResult.messages.length > 0;
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
                            fix: fixer,
                            allowInlineConfig,
                            ruleFilter,
                            linter,
                        },
                    );
                    return result;
                },
            );
        }

        return lintSingleFile;
    }

    // lintParallel ////////////////////////////////////////////////////////////////////////////////

    async function runWorkers(fileInfos, cliOptions, patchESLintModuleURL)
    {
        const results = Array(fileInfos.length);
        const workerURL = new URL('./lint-files-async.js', import.meta.url);
        const fileInfoIndexArray =
        new Uint32Array(new SharedArrayBuffer(Uint32Array.BYTES_PER_ELEMENT));
        const workerOptions =
        {
            workerData:
            {
                cliOptions,
                eslintDirURL: String(eslintDirURL),
                fileInfoIndexArray,
                fileInfos,
                patchESLintModuleURL,
            },
        };
        const workerExecutor =
        (resolve, reject) =>
        {
            const worker = new Worker(workerURL, workerOptions);
            worker.once
            (
                'message',
                indexedResults =>
                {
                    for (const result of indexedResults)
                    {
                        const { index } = result;
                        delete result.index;
                        results[index] = result;
                    }
                    resolve();
                },
            );
            worker.once
            (
                'error',
                error =>
                {
                    Atomics.store(fileInfoIndexArray, 0, fileInfos.length);
                    reject(error);
                },
            );
        };
        let { concurrency } = cliOptions;
        if (!(concurrency >= 1))
            concurrency = 1;
        const promises = Array(concurrency);
        for (let index = 0; index < concurrency; ++index)
            promises[index] = new Promise(workerExecutor);
        await Promise.all(promises);
        return results;
    }

    /**
     * Executes the current configuration on an array of file and directory names in parallel.
     * @param {string|string[]} patterns An array of file and directory names.
     * @returns {Promise<LintResult[]>} The results of linting the file patterns given.
     */
    async function lintParallel(patterns)
    {
        let normalizedPatterns = patterns;
        const { cacheFilePath, lintResultCache, options: eslintOptions } = privateMembers.get(this);

        /*
         * Special cases:
         * 1. `patterns` is an empty string
         * 2. `patterns` is an empty array
         *
         * In both cases, we use the cwd as the directory to lint.
         */
        if (patterns === '' || Array.isArray(patterns) && patterns.length === 0)
        {
            /*
             * Special case: If `passOnNoPatterns` is true, then we just exit
             * without doing any work.
             */
            if (eslintOptions.passOnNoPatterns)
                return [];
            normalizedPatterns = ['.'];
        }
        else
        {
            if (!isNonEmptyString(patterns) && !isArrayOfNonEmptyString(patterns))
            {
                throw Error
                ('\'patterns\' must be a non-empty string or an array of non-empty strings');
            }
            if (typeof patterns === 'string')
                normalizedPatterns = [patterns];
        }

        debug(`Using file patterns: ${normalizedPatterns}`);

        const configs = await calculateConfigArray(this, eslintOptions);
        const { cache, cwd, globInputPaths, errorOnUnmatchedPattern } = eslintOptions;
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
                const errorCode = error.code;
                // Ignore errors when no such file exists or file system is read only (and cache
                // file does not exist).
                if
                (errorCode !== 'ENOENT' && !(errorCode === 'EROFS' && !existsSync(cacheFilePath)))
                    throw error;
            }
        }
        const fileInfos =
        await findFiles
        ({ patterns: normalizedPatterns, cwd, globInputPaths, configs, errorOnUnmatchedPattern });
        debug(`${fileInfos.length} files found in: ${Date.now() - startTime}ms`);
        const cliOptions = cliOptionsMap.get(this);
        const results = await runWorkers(fileInfos, cliOptions, this.patchESLintModuleURL);
        // Persist the cache to disk.
        if (lintResultCache)
        {
            results.forEach
            (
                (result, index) =>
                {
                    if (result)
                    {
                        const { filePath } = fileInfos[index];
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

    // Patch ///////////////////////////////////////////////////////////////////////////////////////

    ESLint.fromCLIOptions = fromCLIOptions;
    {
        const { prototype } = ESLint;
        prototype.createLintSingleFile = createLintSingleFile;
        prototype.lintParallel = lintParallel;
        prototype.patchESLintModuleURL = import.meta.url;
    }
}
