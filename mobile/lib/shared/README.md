# The only files in `mobile/` allowed to reach outside the project

Each file here is a one-line re-export of a module in `../../../src/lib`, which
is the Next app's pure-TypeScript core: the domain layer (~75 passing tests) and
the storage-agnostic outbox queue. Two clients computing a number two ways is
how they come to disagree about it, so the native app imports these rather than
reimplementing any of them.

Metro resolves them because `metro.config.js` lists `../src/lib` in
`watchFolders`. The relative `../../../` paths are confined to this folder on
purpose — everything else in the app imports `@/lib/shared/<module>`, so there
is exactly one place to change if the layout ever moves.

One file per module rather than a single `index.ts`: `export *` across seven
modules would collide silently the day someone adds a name that already exists
in another.
