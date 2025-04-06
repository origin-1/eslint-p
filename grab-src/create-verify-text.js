/* eslint no-unused-vars: 'off' */

import path                 from 'node:path';
import getPlaceholderPath   from './get-placeholder-path.js';

export default async function createVerifyText(importAsESLint)
{
    const eslintHelpersPromise = importAsESLint('./lib/eslint/eslint-helpers.js');
    const { default: createDebug } = await importAsESLint('debug');
    const debug = createDebug('eslint:eslint');
    const { calculateStatsPerFile } = await eslintHelpersPromise;

    /* global verifyText -- make-grab lib/eslint/eslint.js */

    return verifyText;
}
