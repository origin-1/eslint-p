/* eslint no-unused-vars: 'off' */

import path                 from 'node:path';
import getPlaceholderPath   from './get-placeholder-path.js';

/** @type {WeakMap<ExtractedConfig, DeprecatedRuleInfo[]>} */
const usedDeprecatedRulesCache = new WeakMap();

export default async function createProcessLintReport(importAsESLint, privateMembers)
{
    const { Legacy: { ConfigOps: { getRuleSeverity }, naming } } =
    await importAsESLint('@eslint/eslintrc');

    /* global getOrFindUsedDeprecatedRules -- make-grab lib/eslint/eslint.js */

    /* global processLintReport -- make-grab */

    return processLintReport;
}
