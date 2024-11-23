import { existsSync }           from 'node:fs';
import fs                       from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { Worker }               from 'node:worker_threads';
import createProcessLintReport  from '../grab/create-process-lint-report.js';
import createImportAs           from './create-import-as.js';
import createTranslateOptions   from './create-translate-options.js';
import grabPrivateMembers       from './grab-private-members.js';
import limitConcurrency         from './limit-concurrency.js';

/** @typedef {import('eslint').ESLint} ESLint */
/** @typedef {import('../node_modules/eslint/lib/options.js').ParsedCLIOptions} ParsedCLIOptions */

function calculateMaxConcurrency(concurrency)
{
    let maxConcurrency;
    switch (concurrency)
    {
    case 'off':
        maxConcurrency = 0;
        break;
    case undefined:
    case 'auto':
        maxConcurrency = availableParallelism() >> 1;
        if (maxConcurrency < 2) maxConcurrency = 0;
        break;
    default:
        maxConcurrency = Math.floor(concurrency);
        break;
    }
    return maxConcurrency;
}

async function loadConfigArraysForFiles(filePaths, configLoader, maxConcurrency, abortController)
{
    /** @param {string} filePath */
    async function loadConfigArrayForFile(filePath)
    {
        abortSignal.throwIfAborted();
        await configLoader.loadConfigArrayForFile(filePath);
    }

    const abortSignal = abortController.signal;
    try
    {
        await Promise.all(filePaths.map(limitConcurrency(loadConfigArrayForFile, maxConcurrency)));
    }
    catch (error)
    {
        abortController.abort(error);
        throw error;
    }
}

export default async function patchESLint(eslintDirURL, ESLint)
{
    const { prototype } = ESLint;
    if (createVerifyTextModuleURLKey in prototype) return;

    /** @type {WeakMap<ESLint, Record<string, unknown>>} */
    const privateMembers = grabPrivateMembers(ESLint);

    const importAsESLint = createImportAs(eslintDirURL);
    const
    [
        { findFiles, isArrayOfNonEmptyString, isNonEmptyString },
        { default: createDebug },
        processLintReport,
        translateOptions,
    ] =
    await Promise.all
    (
        [
            importAsESLint('./lib/eslint/eslint-helpers.js'),
            importAsESLint('debug'),
            createProcessLintReport(importAsESLint, privateMembers),
            createTranslateOptions(importAsESLint),
        ],
    );

    /** @type {WeakMap<ESLint, { cliOptions: ParsedCLIOptions; maxConcurrency: number; }>} */
    const engineInfoMap = new WeakMap();

    const debug = createDebug('eslint:eslint');

    // fromCLIOptions //////////////////////////////////////////////////////////////////////////////

    async function fromCLIOptions(cliOptions = { })
    {
        const eslintOptions = await translateOptions(cliOptions);
        const engine = new ESLint(eslintOptions);
        const maxConcurrency = calculateMaxConcurrency(cliOptions.concurrency);
        engineInfoMap.set(engine, { cliOptions, maxConcurrency });
        return engine;
    }

    // lintFiles ///////////////////////////////////////////////////////////////////////////////////

    /**
     * Executes the current configuration on an array of file names in parallel.
     * @param {string|string[]} patterns An array of file names.
     * @returns {Promise<LintResult[]>} The results of linting the file patterns given.
     */
    async function lintFiles(patterns)
    {
        const engineInfo = engineInfoMap.get(this);
        const { maxConcurrency } = engineInfo;
        if (!maxConcurrency)
            return await originalLintFiles.call(this, patterns);
        let normalizedPatterns = patterns;
        const { cacheFilePath, configLoader, lintResultCache, options: eslintOptions } =
        privateMembers.get(this);

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
        const { cache, cwd, globInputPaths, errorOnUnmatchedPattern } = eslintOptions;
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
        const startTime = Date.now();
        const filePaths =
        await findFiles
        (
            {
                patterns: normalizedPatterns,
                cwd,
                globInputPaths,
                configLoader,
                errorOnUnmatchedPattern,
            },
        );
        debug(`${filePaths.length} files found in: ${Date.now() - startTime}ms`);
        const abortController = new AbortController();
        const [results] =
        await Promise.all
        (
            [
                runWorkers
                (filePaths, engineInfo, this[createVerifyTextModuleURLKey], abortController),
                loadConfigArraysForFiles(filePaths, configLoader, maxConcurrency, abortController),
            ],
        );
        // Persist the cache to disk.
        if (lintResultCache)
        {
            results.forEach
            (
                (result, index) =>
                {
                    if (result)
                    {
                        const filePath = filePaths[index];
                        const configs = configLoader.getCachedConfigArrayForFile(filePath);
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

    /**
     * @param {string[]} filePaths
     * @param {{ cliOptions: ParsedCLIOptions, maxConcurrency: number }} engineInfo
     * @param {string} createVerifyTextModuleURL
     * @param {AbortController} abortController
     * @returns {Promise<ESLint.LintResult[]>}
     */
    async function runWorkers
    (filePaths, { cliOptions, maxConcurrency }, createVerifyTextModuleURL, abortController)
    {
        const fileCount = filePaths.length;
        const results = Array(fileCount);
        const workerURL = new URL('./worker.js', import.meta.url);
        const filePathIndexArray =
        new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
        const abortSignal = abortController.signal;
        const workerOptions =
        {
            workerData:
            {
                cliOptions,
                createVerifyTextModuleURL,
                eslintDirURL: String(eslintDirURL),
                filePathIndexArray,
                filePaths,
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
                    abortController.abort(error);
                    reject(error);
                },
            );
            abortSignal.addEventListener('abort', () => worker.terminate());
        };
        const concurrency = Math.min(maxConcurrency, fileCount);
        debug(`Running ${concurrency} worker thread(s).`);
        const promises = Array(concurrency);
        for (let index = 0; index < concurrency; ++index)
            promises[index] = new Promise(workerExecutor);
        await Promise.all(promises);
        return results;
    }

    const originalLintFiles = prototype.lintFiles;

    // Patch ///////////////////////////////////////////////////////////////////////////////////////

    ESLint.fromCLIOptions = fromCLIOptions;
    prototype.lintFiles = lintFiles;
    prototype[createVerifyTextModuleURLKey] = '#create-verify-text';
}

export const createVerifyTextModuleURLKey = Symbol();
