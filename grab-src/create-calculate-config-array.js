/* eslint no-unused-vars: 'off' */

import fs                               from 'node:fs/promises';
import { createRequire }                from 'node:module';
import path                             from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import createImportAs                   from '../lib/create-import-as.js';

const __filename = fileURLToPath(import.meta.url);

/* global FLAT_CONFIG_FILENAMES -- make-grab lib/eslint/eslint.js */
/* global FLAT_CONFIG_FILENAMES_WITH_TS -- make-grab lib/eslint/eslint.js */

const require = createRequire(import.meta.url);

export default async function createCalculateConfigArray(eslintDirURL, privateMembers)
{
    const importAsESLint = createImportAs(eslintDirURL);
    const [{ FlatConfigArray }, { default: createDebug }, { default: findUp }] =
    await Promise.all
    (
        [
            import(`${eslintDirURL}lib/config/flat-config-array.js`),
            importAsESLint('debug'),
            importAsESLint('find-up'),
        ],
    );
    const debug = createDebug('eslint:eslint');
    const importedConfigFileModificationTime = new Map();

    /* global findFlatConfigFile -- make-grab */

    /* global locateConfigFileToUse -- make-grab */

    /* global isFileTS -- make-grab */

    /* global isRunningInBun -- make-grab */

    /* global isRunningInDeno -- make-grab */

    /* global loadFlatConfigFile -- make-grab */

    /* global calculateConfigArray -- make-grab */

    return calculateConfigArray;
}
