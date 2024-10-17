/* eslint no-unused-vars: 'off' */

export default async function createGetFixerForFixTypes(importAsESLint)
{
    const { getRuleFromConfig } = await importAsESLint('./lib/config/flat-config-helpers.js');

    /* global shouldMessageBeFixed -- make-grab lib/eslint/eslint.js */

    /* global getFixerForFixTypes -- make-grab lib/eslint/eslint.js */

    return getFixerForFixTypes;
}
