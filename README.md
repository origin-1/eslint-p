# eslint-p · [![npm version][npm badge]][npm URL]

A drop-in replacement for ESLint 9 featuring multithreaded parallel linting.

**Only flat config is supported!**

## Usage

All ESLint options are supported, plus `--concurrency`.

Example:

```shell
npx eslint-p --fix --concurrency=4
```

[npm badge]: https://img.shields.io/npm/v/eslint-plogo=npm
[npm URL]: https://www.npmjs.com/package/eslint-p
