/* eslint no-unused-vars: 'off' */

export default async function createShouldMessageBeFixed(eslintDirURL)
{
    const { getRuleFromConfig } = await import(`${eslintDirURL}lib/config/flat-config-helpers.js`);

    /* global shouldMessageBeFixed -- make-grab lib/eslint/eslint.js */

    return shouldMessageBeFixed;
}
