/* eslint no-unused-vars: 'off' */

import path             from 'node:path';
import createImportAs   from '../lib/create-import-as.js';

/* global calculateStatsPerFile -- make-grab lib/eslint/eslint.js */

export default async function createVerifyText(eslintDirURL)
{
    const importAsESLint = await createImportAs(eslintDirURL);
    const { default: createDebug } = await importAsESLint('debug');
    const debug = createDebug('eslint:eslint');

    /* global verifyText -- make-grab */

    return verifyText;
}
