#!/usr/bin/env node

import { rm }               from 'node:fs/promises';
import { join }             from 'node:path';
import { fileURLToPath }    from 'node:url';

const workspaceFolder = join(fileURLToPath(import.meta.url), '../..');
process.chdir(workspaceFolder);
await rm('coverage', { force: true, recursive: true });
