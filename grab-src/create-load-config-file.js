/* eslint no-unused-vars: 'off' */

import fs                   from 'node:fs/promises';
import { createRequire }    from 'node:module';
import path                 from 'node:path';
import { pathToFileURL }    from 'node:url';

const require = createRequire(import.meta.url);

export default async function createLoadConfigFile(importAsESLint)
{
    const [{ ConfigLoader }, { default: createDebug }] =
    await Promise.all([importAsESLint('./lib/config/config-loader.js'), importAsESLint('debug')]);

    const __filename    = import.meta.url;
    const debug         = createDebug('eslint:config-loader');

    /* global importedConfigFileModificationTime -- make-grab lib/config/config-loader.js */

    /* global isFileTS -- make-grab */

    /* global isRunningInBun -- make-grab */

    /* global isRunningInDeno -- make-grab */

    /* global loadConfigFile -- make-grab */

    return loadConfigFile;
}
