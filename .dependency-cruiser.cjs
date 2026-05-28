/**
 * Boundary rules — enforces ARCHITECTURE/00-SEED CONSTRAINT #1:
 * packages/core must NOT import electron / fs / child_process / node:path etc.
 * This keeps the editing core portable (web / desktop / future mobile).
 */
module.exports = {
  forbidden: [
    {
      name: 'core-no-electron',
      comment: 'packages/core must stay platform-agnostic (no electron).',
      severity: 'error',
      from: { path: '^packages/core' },
      to: { path: 'electron' },
    },
    {
      name: 'core-no-node-builtins',
      comment:
        'packages/core must not touch fs/child_process/path/os (inject instead). 00-SEED CONSTRAINT #1.',
      severity: 'error',
      from: { path: '^packages/core' },
      to: {
        dependencyTypes: ['core'],
        path: '^(node:)?(fs|child_process|path|os|net|http|https|worker_threads)$',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // The portability constraint applies to PRODUCTION core code. Test files run
    // in Node and may use fs/path to write evidence artifacts.
    exclude: { path: '\\.test\\.ts$' },
    // Catches type-only imports too (e.g. `import type { X } from 'fs'`).
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
