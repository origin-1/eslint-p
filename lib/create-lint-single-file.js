import { readFile }         from 'node:fs/promises';
import createVerifyText     from '../grab/create-verify-text.js';
import getFixerForFixTypes  from '../grab/get-fixer-for-types.js';
import grabPrivateMembers   from './grab-private-members.js';

/** @typedef {import('eslint').ESLint} ESLint */

export default async function createLintSingleFile(importAsESLint, engine)
{
    /** @type {WeakMap<ESLint, Record<string, unknown>>} */
    const privateMembers = grabPrivateMembers(engine.constructor);

    const [{ createIgnoreResult }, { default: createDebug }, verifyText] =
    await Promise.all
    (
        [
            importAsESLint('./lib/eslint/eslint-helpers.js'),
            importAsESLint('debug'),
            createVerifyText(importAsESLint),
        ],
    );

    const debug = createDebug('eslint:eslint');
    const { configLoader, lintResultCache, linter, options: eslintOptions } =
    privateMembers.get(engine);
    const { allowInlineConfig, cwd, fix, fixTypes, ruleFilter, stats, warnIgnored } = eslintOptions;
    const fixTypesSet = fixTypes ? new Set(fixTypes) : null;

    async function lintSingleFile(filePath)
    {
        const configs = await loadConfigArrayForFile(filePath);
        const config = configs.getConfig(filePath);

        /*
         * If a filename was entered that cannot be matched
         * to a config, then notify the user.
         */
        if (!config)
        {
            if (warnIgnored)
            {
                const configStatus = configs.getConfigStatus(filePath);
                const result = createIgnoreResult(filePath, cwd, configStatus);
                return result;
            }
            return;
        }
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
        // Set up fixer for fixTypes if necessary.
        const fixer = getFixerForFixTypes(fix, fixTypesSet, config);
        return readFile(filePath, 'utf8')
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
                        stats,
                        linter,
                    },
                );
                return result;
            },
        );
    }

    async function loadConfigArrayForFile(filePath)
    {
        const { emitWarning } = process;
        process.emitWarning =
        (...args) =>
        {
            if (args[1] !== 'ESLintEmptyConfigWarning')
                emitWarning(...args);
        };
        try
        {
            const configArray = await configLoader.loadConfigArrayForFile(filePath);
            return configArray;
        }
        finally
        {
            process.emitWarning = emitWarning;
        }
    }

    return lintSingleFile;
}
