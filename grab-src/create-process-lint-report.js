/* eslint no-unused-vars: 'off' */

import path             from 'node:path';
import createImportAs   from '../lib/create-import-as.js';

/** @type {WeakMap<ExtractedConfig, DeprecatedRuleInfo[]>} */
const usedDeprecatedRulesCache = new WeakMap();

export default async function createProcessLintReport(eslintDirURL, privateMembers)
{
    const importAsESLint = createImportAs(eslintDirURL);
    const [{ getRuleFromConfig }, { Legacy: { ConfigOps: { getRuleSeverity } } }] =
    await Promise.all
    (
        [
            import(`${eslintDirURL}lib/config/flat-config-helpers.js`),
            importAsESLint('@eslint/eslintrc'),
        ],
    );

    /* global getOrFindUsedDeprecatedRules -- make-grab */

    /* global processLintReport -- make-grab */

    return processLintReport;
}
