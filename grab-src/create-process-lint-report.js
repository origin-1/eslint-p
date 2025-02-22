/* eslint no-unused-vars: 'off' */

import path from 'node:path';

/** @type {WeakMap<ExtractedConfig, DeprecatedRuleInfo[]>} */
const usedDeprecatedRulesCache = new WeakMap();

export default async function createProcessLintReport(importAsESLint, privateMembers)
{
    const [{ getRuleFromConfig }, { Legacy: { ConfigOps: { getRuleSeverity }, naming } }] =
    await Promise.all
    (
        [
            importAsESLint('./lib/config/flat-config-helpers.js'),
            importAsESLint('@eslint/eslintrc'),
        ],
    );

    /* global getOrFindUsedDeprecatedRules -- make-grab lib/eslint/eslint.js */

    /* global processLintReport -- make-grab */

    return processLintReport;
}
