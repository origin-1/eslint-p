import { randomUUID }               from 'node:crypto';
import { existsSync }               from 'node:fs';
import fs                           from 'node:fs/promises';
import { availableParallelism }     from 'node:os';
import { Worker }                   from 'node:worker_threads';
import getPlaceholderPath           from '../grab/get-placeholder-path.js';
import createImportAs               from './create-import-as.js';
import createTranslateOptions       from './create-translate-options.js';
import emitEmptyConfigFileWarning   from './emit-empty-config-file-warning.js';
import grabPrivateMembers           from './grab-private-members.js';
import patchCalculateConfigArray    from './patch-calculate-config-array.js';

/** @typedef {import('eslint').ESLint} ESLint */
/** @typedef {import('eslint').ESLint.LintResultData['rulesMeta']} RulesMeta */
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

function createIssueEmptyConfigFileWarning()
{
    const emptyConfigFileWarningSet = new Set();
    const issueEmptyConfigFileWarning =
    configFilePath =>
    {
        if (!emptyConfigFileWarningSet.has(configFilePath))
        {
            emptyConfigFileWarningSet.add(configFilePath);
            emitEmptyConfigFileWarning(configFilePath);
        }
    };
    return issueEmptyConfigFileWarning;
}

export default async function patchESLint(eslintDirURL, ESLint)
{
    const { prototype } = ESLint;
    if (createImportAsESLintModuleURLKey in prototype) return;

    /** @type {WeakMap<ESLint, Record<string, unknown>>} */
    const privateMembers = grabPrivateMembers(ESLint);

    const importAsESLint = createImportAs(eslintDirURL);
    const
    [
        { findFiles, isArrayOfNonEmptyString, isNonEmptyString },
        { default: createDebug },
        translateOptions,
        setNextIssueEmptyConfigFileWarning,
    ] =
    await Promise.all
    (
        [
            importAsESLint('./lib/eslint/eslint-helpers.js'),
            importAsESLint('debug'),
            createTranslateOptions(importAsESLint),
            patchCalculateConfigArray(importAsESLint),
        ],
    );

    /**
     * @typedef {Object} EngineInfo
     * @property {ParsedCLIOptions}             cliOptions
     * @property {(warning: string) => void}    issueEmptyConfigFileWarning
     * @property {number}                       maxConcurrency
     * @property {Map<string, RulesMeta>}       rulesMetaMap
     */
    /** @type {WeakMap<ESLint, EngineInfo>} */
    const engineInfoMap = new WeakMap();

    const debug = createDebug('eslint:eslint');

    // fromCLIOptions //////////////////////////////////////////////////////////////////////////////

    async function fromCLIOptions(cliOptions = { })
    {
        const eslintOptions = await translateOptions(cliOptions);
        const engine = new ESLint(eslintOptions);
        const issueEmptyConfigFileWarning = createIssueEmptyConfigFileWarning();
        const maxConcurrency = calculateMaxConcurrency(cliOptions.concurrency);
        const rulesMetaMap = new Map();
        engineInfoMap.set
        (engine, { cliOptions, issueEmptyConfigFileWarning, maxConcurrency, rulesMetaMap });
        return engine;
    }

    // getRulesMetaForResults //////////////////////////////////////////////////////////////////////

    function getRulesMetaForResults(results)
    {
        const { rulesMetaMap } = engineInfoMap.get(this);
        const unlistedResults = [];
        const rulesMetaForResults = { };
        const { options: { cwd } } = privateMembers.get(this);
        pruneRulesMetaMap(this);
        for (const result of results)
        {
            /*
             * Normalize filename for <text>.
             */
            const filePath =
            result.filePath === '<text>' ? getPlaceholderPath(cwd) : result.filePath;
            const rulesMeta = rulesMetaMap.get(filePath);
            if (!rulesMeta)
                unlistedResults.push(result);
            else
                Object.assign(rulesMetaForResults, rulesMeta);
        }
        const rulesMetaForUnlistedResults =
        originalGetRulesMetaForResults.call(this, unlistedResults);
        Object.assign(rulesMetaForResults, rulesMetaForUnlistedResults);
        return rulesMetaForResults;
    }

    function pruneRulesMetaMap(engine)
    {
        const { configLoader } = privateMembers.get(engine);
        const { rulesMetaMap } = engineInfoMap.get(engine);
        for (const filePath of rulesMetaMap.keys())
        {
            try
            {
                configLoader.getCachedConfigArrayForFile(filePath);
            }
            catch
            {
                continue;
            }
            rulesMetaMap.delete(filePath);
        }
    }

    const originalGetRulesMetaForResults = prototype.getRulesMetaForResults;

    // lintFiles ///////////////////////////////////////////////////////////////////////////////////

    /**
     * Executes the current configuration on an array of file names in parallel.
     * @param {string|string[]} patterns An array of file names.
     * @returns {Promise<LintResult[]>} The results of linting the file patterns given.
     */
    async function lintFiles(patterns)
    {
        const engineInfo = engineInfoMap.get(this);
        if (!engineInfo.maxConcurrency)
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
        const unsetNextIssueEmptyConfigFileWarning =
        setNextIssueEmptyConfigFileWarning(engineInfo.issueEmptyConfigFileWarning);
        let results;
        try
        {
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
            results =
            await runWorkers(filePaths, engineInfo, this[createImportAsESLintModuleURLKey]);
            // Persist the cache to disk.
            if (lintResultCache)
            {
                const promises =
                results.map
                (
                    async (result, index) =>
                    {
                        if (result)
                        {
                            const filePath = filePaths[index];
                            const configs = await configLoader.loadConfigArrayForFile(filePath);
                            const config = configs.getConfig(filePath);
                            const { usedDeprecatedRules, ...filteredResult } = result;

                            /*
                            * Store the lint result in the LintResultCache.
                            * NOTE: The LintResultCache will remove the file source and any
                            * other properties that are difficult to serialize, and will
                            * hydrate those properties back in on future lint runs.
                            */
                            lintResultCache.setCachedLintResults(filePath, config, filteredResult);
                        }
                    },
                );
                await Promise.all(promises);
                lintResultCache.reconcile();
            }
        }
        finally
        {
            unsetNextIssueEmptyConfigFileWarning();
        }
        const finalResults = results.filter(result => !!result);
        pruneRulesMetaMap(this);
        return finalResults;
    }

    /**
     * @param {string[]} filePaths
     * @param {EngineInfo} engineInfo
     * @param {string} createImportAsESLintModuleURL
     * @returns {Promise<ESLint.LintResult[]>}
     */
    async function runWorkers
    (
        filePaths,
        { cliOptions, issueEmptyConfigFileWarning, maxConcurrency, rulesMetaMap },
        createImportAsESLintModuleURL,
    )
    {
        const fileCount = filePaths.length;
        const results = Array(fileCount);
        const workerURL = new URL('./worker.js', import.meta.url);
        const filePathIndexArray =
        new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
        const abortController = new AbortController();
        const abortSignal = abortController.signal;
        const emptyConfigFileWarningChannelName = randomUUID();
        const emptyConfigFileWarningChannel =
        new BroadcastChannel(emptyConfigFileWarningChannelName);
        const workerOptions =
        {
            workerData:
            {
                cliOptions,
                createImportAsESLintModuleURL,
                emptyConfigFileWarningChannelName,
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
                        const { index, rulesMeta } = result;
                        delete result.index;
                        delete result.rulesMeta;
                        results[index] = result;
                        rulesMetaMap.set(result.filePath, rulesMeta);
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
        emptyConfigFileWarningChannel.onmessage =
        ({ data: warning }) => issueEmptyConfigFileWarning(warning);
        const concurrency = Math.min(maxConcurrency, fileCount);
        debug(`Running ${concurrency} worker thread(s).`);
        const promises = Array(concurrency);
        for (let index = 0; index < concurrency; ++index)
            promises[index] = new Promise(workerExecutor);
        try
        {
            await Promise.all(promises);
        }
        finally
        {
            emptyConfigFileWarningChannel.close();
        }
        return results;
    }

    const originalLintFiles = prototype.lintFiles;

    // Patch ///////////////////////////////////////////////////////////////////////////////////////

    ESLint.fromCLIOptions = fromCLIOptions;
    prototype.getRulesMetaForResults = getRulesMetaForResults;
    prototype.lintFiles = lintFiles;
    prototype[createImportAsESLintModuleURLKey] = '#create-import-as-eslint';
}

export const createImportAsESLintModuleURLKey = Symbol();
