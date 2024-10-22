#!/usr/bin/env node

import './enable-compile-cache.js';

const createCLIExecutePromise = import('./create-cli-execute.js');
const { default: eslintDirURL } = await import('./default-eslint-dir-url.js');
const [{ default: cli }, { default: createCLIExecute }] =
await Promise.all([import(`${eslintDirURL}lib/cli.js`), createCLIExecutePromise]);
cli.execute = await createCLIExecute(eslintDirURL, cli.calculateInspectConfigFlags);
await import(`${eslintDirURL}bin/eslint.js`);
