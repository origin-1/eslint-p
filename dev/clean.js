#!/usr/bin/env node

import { rm } from 'node:fs/promises';

const baseURL = new URL('..', import.meta.url);
const options = { force: true, recursive: true };
const promises = ['coverage', 'grab'].map(dirName => rm(new URL(dirName, baseURL), options));
await Promise.all(promises);
