import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export default function createImportAs(pathOrURL)
{
    const { resolve } = createRequire(pathOrURL);
    const importAs = async specifier => await import(pathToFileURL(resolve(specifier)));
    return importAs;
}
