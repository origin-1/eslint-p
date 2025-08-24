# eslint-p · [![npm version][npm badge]][npm URL]

A drop-in replacement for ESLint 9 featuring multithreaded parallel linting.

> **IMPORTANT:** ESLint v9.34.0 has built-in support for multithread linting, see [the announcement](https://eslint.org/blog/2025/08/multithread-linting/).
As a result, eslint-p is no longer needed—just run ESLint directly.

## Installation

```shell
npm i --save-dev eslint-p
```

```shell
yarn add --dev eslint-p
```

```shell
pnpm add --save-dev eslint-p
```

## Usage

All [ESLint CLI options](https://eslint.org/docs/latest/use/command-line-interface#options) are supported.

Example:

```shell
npx eslint-p --fix --concurrency=4
```

Valid values for the `--concurrency` option are:

* **positive integers** (e.g. `4`):
  Maximum number of linting threads. The effective number of threads can be lower when linting only a few files.
* **`auto`**:
  Choose number of linting threads automatically.
* **`off`** (default):
  No multithreading. This is the same as `--concurrency=1`.

> **NOTE**: Normally, a performance improvement **will be only noticeable on systems with 4 or more CPUs**.
> Some plugins like `typescript-eslint` with type-aware linting can increase the time required to initialize a linting thread resulting in performance degradation when multithreading is used.

## Concurrency Debugging

When the `--debug` option is passed and the command runs in multithread mode, the debug output will include a line indicating the number of worker threads in use. For example:

```shell
npx eslint --debug
```

will print a line similar to this one:

```text
eslint:eslint Linting using 4 worker thread(s). +0ms
```

or this one:

```text
eslint:eslint Linting in single-thread mode. +0ms
```

The debug line should be printed in the first seconds of execution, before any files are processed, but it can be easily overlooked.
To make the debug output less verbose in a Unix shell you can run instead:

```shell
DEBUG='eslint:eslint' npx eslint
```

Or in Windows PowerShell:

```shell
$env:DEBUG='eslint:eslint' ; npx eslint
```

[npm badge]: https://img.shields.io/npm/v/eslint-p?logo=npm
[npm URL]: https://www.npmjs.com/package/eslint-p
