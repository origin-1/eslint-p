/* eslint no-unused-vars: 'off' */

import path from 'node:path';

/* global calculateStatsPerFile -- make-grab lib/eslint/eslint.js */

export default async function createVerifyText(importAsESLint)
{
    const { default: createDebug } = await importAsESLint('debug');
    const debug = createDebug('eslint:eslint');

    /* global verifyText -- make-grab */

    return verifyText;
}
