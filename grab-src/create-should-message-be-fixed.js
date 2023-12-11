/* eslint-disable no-unused-vars */

export default async function createShouldMessageBeFixed(eslintDirURL)
{
    const { getRuleFromConfig } = await import(`${eslintDirURL}lib/config/flat-config-helpers.js`);

    /* global shouldMessageBeFixed -- make-grab */

    return shouldMessageBeFixed;
}
