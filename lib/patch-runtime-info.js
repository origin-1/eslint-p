import eslintDirURL from './default-eslint-dir-url.js';
import pkg          from './package-info.js';

const { default: RuntimeInfo } = await import(`${eslintDirURL}lib/shared/runtime-info.js`);
const { version } = pkg;
const eslintVersion = RuntimeInfo.version();
RuntimeInfo.version = () => `eslint-p v${version}\nESLint ${eslintVersion}`;
