# eslint-p

A drop-in replacement for ESLint for multithreaded parallel linting.

**Only flat config is supported!** **Node.js >= 17 is required.**

## Usage

All ESLint options are supported, plus `--concurrency`.

Example:

```shell
npx eslint-p . --fix --concurrency=4
```
