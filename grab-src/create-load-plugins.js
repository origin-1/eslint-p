/* eslint no-unused-vars: 'off' */

export default async function createLoadPlugins(importAsESLint)
{
    const { getShorthandName, normalizePackageName } =
    await importAsESLint('./lib/shared/naming.js');

    /* global loadPlugins -- make-grab lib/cli.js */

    return loadPlugins;
}
