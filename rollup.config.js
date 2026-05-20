import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default {
  input: 'frontend/evoc-checkout-sdk.js',
  output: [
    // UMD for script tag usage
    {
      file: 'dist/evoc-checkout-sdk.umd.js',
      format: 'umd',
      name: 'EVOC_CHECKOUT',
      sourcemap: true,
      globals: {
        // No external dependencies
      }
    },
    // Minified UMD
    {
      file: 'dist/evoc-checkout-sdk.umd.min.js',
      format: 'umd',
      name: 'EVOC_CHECKOUT',
      sourcemap: true,
      plugins: [terser()]
    },
    // ES Module for npm bundlers
    {
      file: 'dist/evoc-checkout-sdk.esm.js',
      format: 'esm',
      sourcemap: true
    },
    // Minified ESM
    {
      file: 'dist/evoc-checkout-sdk.esm.min.js',
      format: 'esm',
      sourcemap: true,
      plugins: [terser()]
    },
    // CommonJS for Node.js
    {
      file: 'dist/evoc-checkout-sdk.cjs.js',
      format: 'cjs',
      sourcemap: true,
      exports: 'named'
    }
  ],
  plugins: [
    resolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs()
  ],
  // Bundle everything (no external deps)
  external: [],
  onwarn(warning, warn) {
    // Suppress circular dependency warnings from node-resolve
    if (warning.code === 'CIRCULAR_DEPENDENCY') return;
    warn(warning);
  }
};