import { createRequire }    from 'node:module';
import { join }             from 'node:path';
import { pathToFileURL }    from 'node:url';

const { resolve } = createRequire(import.meta.url);
const eslintDir = join(resolve('eslint'), '../../');
const eslintDirURL = pathToFileURL(eslintDir);

export default eslintDirURL;
