/* eslint no-unused-vars: 'off' */

import path                 from 'node:path';
import getPlaceholderPath   from './get-placeholder-path.js';

export default async function createVerifyText(importAsESLint)
{
    const [{ default: createDebug }, { calculateStatsPerFile }] =
    await Promise.all([importAsESLint('debug'), importAsESLint('./lib/eslint/eslint-helpers.js')]);
    const debug = createDebug('eslint:eslint');

    /* global verifyText -- make-grab lib/eslint/eslint.js */

    return verifyText;
}
