/* eslint no-unused-vars: 'off' */

import path                 from 'node:path';
import getPlaceholderPath   from './get-placeholder-path.js';

/** @type {WeakMap<ExtractedConfig, DeprecatedRuleInfo[]>} */
const usedDeprecatedRulesCache = new WeakMap();

export default async function createProcessLintReport(importAsESLint, privateMembers)
{
    const [{ Config }, { getShorthandName }] =
    await Promise.all
    ([importAsESLint('./lib/config/config.js'), importAsESLint('./lib/shared/naming.js')]);

    /* global getOrFindUsedDeprecatedRules -- make-grab lib/eslint/eslint.js */

    /* global processLintReport -- make-grab */

    return processLintReport;
}
