import createImportAs from '../../lib/create-import-as.js';

export default function createImportAsESLint(eslintDirURL)
{
    const importAsESLint = createImportAs(eslintDirURL);
    const patchPromise = patchJiti(importAsESLint);
    const wrapper =
    async specifier => (await Promise.all([importAsESLint(specifier), patchPromise]))[0];
    return wrapper;
}

async function patchJiti(importAsESLint)
{
    const { ConfigLoader } = await importAsESLint('./lib/config/config-loader.js');
    ConfigLoader.loadJiti = () => Promise.reject();
}
