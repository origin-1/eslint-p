#!/usr/bin/env node

import './enable-compile-cache.js';

const [{ default: eslintDirURL }] =
await Promise.all([import('./default-eslint-dir-url.js'), import('./patch-runtime-info.js')]);
await import(`${eslintDirURL}bin/eslint.js`);
