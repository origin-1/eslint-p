/* eslint no-unused-vars: 'off' */

export default async function createLoadPlugins(importAsESLint)
{
    const { Legacy: { naming } } = await importAsESLint('@eslint/eslintrc');

    /* global loadPlugins -- make-grab */

    return loadPlugins;
}
