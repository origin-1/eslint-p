# eslint-p · [![npm version][npm badge]][npm URL]

A drop-in replacement for ESLint 9 featuring multithreaded parallel linting.

**Only flat config is supported!**

## Usage

All ESLint options are supported, plus `--concurrency` to specify the number of linting threads explicitly.

Example:

```shell
npx eslint-p --fix --concurrency=4
```

If not specified, the number of linting threads is calculated automatically.
Normally, a performance improvement will be only noticeable on systems with 4 or more CPUs.

[npm badge]: https://img.shields.io/npm/v/eslint-p?logo=npm
[npm URL]: https://www.npmjs.com/package/eslint-p
