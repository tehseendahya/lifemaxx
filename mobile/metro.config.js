const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");
const sharedRoot = path.resolve(repoRoot, "src", "lib");
const rootNodeModules = path.resolve(repoRoot, "node_modules");

const config = getDefaultConfig(projectRoot);

// Metro only serves files it watches, and the shared domain layer lives outside
// this project root. Watch ../src/lib and nothing more, so the crawler never
// walks .next/, public/ or the Next app's node_modules.
config.watchFolders = [sharedRoot];

// Resolve packages from this project's own tree first.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

/**
 * Hard boundary at the Next app's `node_modules`.
 *
 * The hazard being closed off: the root `package.json` pins `react@19.0.0` for
 * Next 15, while React Native 0.88 requires `react@^19.3.0`. If Metro ever
 * satisfied `react` from the repo root, the bundle would contain a React that
 * does not match the renderer it was built against — "Invalid hook call" on a
 * device, with no debugger attached. Blocking the path makes it unreachable
 * rather than merely unlikely.
 *
 * `blockList` rather than `resolver.disableHierarchicalLookup`, which is the
 * obvious choice and is wrong. That flag stops Metro walking up through *every*
 * enclosing `node_modules`, including the nested ones inside this project — so
 * a package needing a version other than the hoisted one can no longer find
 * it. Concretely: `react-native-reanimated` depends on `semver@^7.7.3` and has
 * its own copy at `react-native-reanimated/node_modules/semver`, while the
 * hoisted top-level `semver` is 6.3.1, which has no `functions/satisfies`
 * subpath. With hierarchical lookup disabled the bundle fails outright on
 * `Unable to resolve "semver/functions/satisfies"`. Nested resolution has to
 * keep working; only the climb past this project's root has to stop.
 *
 * The two paths cannot be confused: this project is at `<repo>/mobile/
 * node_modules`, which does not contain the string `<repo>/node_modules/`.
 */
config.resolver.blockList = [
  ...config.resolver.blockList,
  new RegExp(`^${rootNodeModules.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\${path.sep}`),
];

/**
 * Only needed for the web target, which is used here as a rough visual smoke
 * test since there is no simulator. `expo-sqlite`'s web implementation is
 * backed by wa-sqlite and imports a `.wasm` file, which is not in Metro's
 * default `assetExts` — so the web bundle fails on `Unable to resolve
 * "./wa-sqlite/wa-sqlite.wasm"` while iOS builds cleanly. Harmless on native.
 *
 * The web bundle no longer imports expo-sqlite at all — the browser's outbox
 * is `lib/outbox-db.web.ts`, over localStorage, for the reasons on
 * `createKeyValueStore` — so this is now only insurance against a future
 * import breaking the web build.
 */
config.resolver.assetExts = [...config.resolver.assetExts, "wasm"];

module.exports = config;
