/* eslint-disable no-unused-vars */

import fs                   from 'node:fs/promises';
import { createRequire }    from 'node:module';
import path                 from 'node:path';
import { pathToFileURL }    from 'node:url';
import createImportAs       from '../lib/create-import-as.js';

const FLAT_CONFIG_FILENAME = 'eslint.config.js';

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
    const debug = createDebug('eslint:flat-eslint');
    const importedConfigFileModificationTime = new Map();

    /* global findFlatConfigFile -- make-grab */

    /* global locateConfigFileToUse -- make-grab */

    /* global loadFlatConfigFile -- make-grab */

    /* global calculateConfigArray -- make-grab */

    return calculateConfigArray;
}