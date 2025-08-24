#!/usr/bin/env node

import { rm } from 'node:fs/promises';

const baseURL = new URL('..', import.meta.url);
const options = { force: true, recursive: true };
await rm(new URL('coverage', baseURL), options);
