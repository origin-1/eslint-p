# eslint-p

A drop-in replacement for ESLint 9 featuring multithreaded parallel linting.

**Only flat config is supported!**

## Usage

All ESLint options are supported, plus `--concurrency`.

Example:

```shell
npx eslint-p --fix --concurrency=4
```
