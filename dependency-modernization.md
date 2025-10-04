# Dependency Modernization for Node 20+

This document tracks dependencies that can be removed and replaced with modern Node.js APIs (targeting Node 20+).

## Definite Removals

### 1. `async` (^3.1.0)
**Files using it:**
- `lib/controller.js` - `async.each`
- `lib/tessel/provision.js` - `async.parallel`
- `lib/usb/usb-daemon.js` - `async.eachSeries`

**Replacements:**
- `async.each` → `Promise.all()` with `array.map()`
- `async.eachSeries` → `for...of` loop with `await`
- `async.parallel` → `Promise.all()`

### 2. `request` (^2.88.0) - DEPRECATED
**Files using it:**
- `lib/crash-reporter.js` - `request.post`
- `lib/update-fetch.js` - `request.get`
- `lib/install/rust.js` - `request.get` and `request()`
- `lib/tessel/deployment/javascript.js` - `request()`

**Replacement:**
- Native `fetch()` (globally available in Node 18+)
- No import needed

### 3. `osenv` (^0.1.5)
**Files using it:**
- `lib/installer.js` - `osenv.home()`
- `lib/tessel/provision.js` - `osenv.home()`
- `lib/install/rust.js` - `osenv.home()`

**Replacement:**
- `os.homedir()` (built-in since Node 6)

### 4. `glob` (^7.1.6)
**Files using it:**
- `lib/tessel/deployment/glob.js` - `glob.sync()`

**Replacement:**
- `fs.glob()` or `fs.globSync()` (Node 22+, experimental in Node 20)
- OR `fs.readdirSync()` with `{ recursive: true }` (Node 20+)

### 5. `mkdirp` (^0.5.1) - devDependency
**Replacement:**
- `fs.mkdir(path, { recursive: true })`
- `fs.promises.mkdir(path, { recursive: true })`

## High Priority Removals

### 6. `fs-extra` (4.0.3)
**Files using it:** 13 files

**Methods used and replacements:**
- `fs.ensureDir()` → `fs.mkdir(path, { recursive: true })`
- `fs.copySync()` → `fs.cpSync()` (Node 16+)
- `fs.removeSync()` → `fs.rmSync()` (Node 14+)
- `fs.readJsonSync()` → `JSON.parse(fs.readFileSync())`
- `fs.writeJsonSync()` → `fs.writeFileSync(path, JSON.stringify(data))`
- `fs.outputFileSync()` → Create parent dirs first, then write
- `fs.mkdirpSync()` → `fs.mkdirSync(path, { recursive: true })`

**Note:** ~80% of usage can be replaced. May keep dependency for edge cases or remove entirely.

## Medium Priority Removals

### 7. `stream-to-buffer` (^0.1.0)
**Files using it:**
- `lib/update-fetch.js`

**Replacement:**
- Collect chunks in array + `Buffer.concat(chunks)`
- Or use async iterators on streams

### 8. `url-join` (4.0.1)
**Files using it:**
- `lib/update-fetch.js`

**Replacement:**
- `new URL(path, base).href`
- Or manual path joining with string manipulation

### 9. `colors` (^1.3.0)
**Files using it:**
- `lib/controller.js`
- `lib/tessel/tessel.js`

**Replacement:**
- ANSI escape codes directly
- Or keep for convenience (small dependency)

### 10. `semver` (^5.5.0)
**Files using it:**
- `lib/controller.js`
- `lib/update-fetch.js`

**Replacement:**
- May keep this one - battle-tested for complex version comparisons
- Only replace if doing simple comparisons

## Dependencies to Keep (for now)

These dependencies don't have good built-in Node.js replacements:

- `inquirer` - Interactive prompts
- `ssh2` - SSH client
- `mdns-js` - mDNS/Bonjour
- `tar-stream`, `tar-fs` - TAR operations
- `usb` - USB device communication
- `npmlog` - Logging
- `minimatch` - Glob pattern matching (used by other tools)

## Implementation Order

1. ✅ Document current dependencies
2. ⬜ Replace `osenv` (simplest, just `os.homedir()`)
3. ⬜ Replace `mkdirp` (simple, just update mkdir calls)
4. ⬜ Replace `async` (requires careful testing)
5. ✅ Replace `request` with `fetch()` (moderate complexity) - **COMPLETED**
6. ⬜ Replace `glob` (depends on approach)
7. ⬜ Replace `fs-extra` (most complex, many files)
8. ⬜ Replace remaining medium priority deps

## Completed Replacements

### `request` → `fetch()` ✅

**Files modified:**
- `lib/crash-reporter.js` - Replaced `request.post()` with `fetch()` using URLSearchParams for form data
- `lib/update-fetch.js` - Replaced `request.get()` for both simple GET and streaming with progress tracking
- `lib/install/rust.js` - Replaced streaming `request.get()` and simple request calls
- `lib/tessel/deployment/javascript.js` - Replaced streaming request with fetch
- `test/common/bootstrap.js` - Removed global.request

**Key changes:**
- Used native `fetch()` (available in Node 18+, no import needed)
- For streaming responses: Used `Readable.fromWeb(response.body)` to convert Web ReadableStream to Node.js Readable
- For progress tracking: Created Transform streams to monitor data chunks
- For form POST: Used `URLSearchParams` with proper Content-Type header
- Response status: Changed from `response.statusCode` to `response.status`
- Headers: Changed from `response.headers['name']` to `response.headers.get('name')`

**Note:** Tests that mock `request` will need to be updated to mock `fetch` instead (deferred to separate task).

## Engine Requirements Update

After modernization, update `package.json`:
```json
"engines": {
  "node": ">=20.0.0"
}
```
