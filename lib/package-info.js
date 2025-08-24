import { readFile } from 'node:fs/promises';

const url = new URL('../package.json', import.meta.url);
const json = await readFile(url);
const pkg = JSON.parse(json);

export default pkg;
