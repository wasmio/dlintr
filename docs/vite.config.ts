import mdx from '@mdx-js/rollup'
import react from '@vitejs/plugin-react'
import remarkGfm from 'remark-gfm'
import { defineConfig } from 'vite'

/**
 * The docs site renders `README.md` and `CHANGELOG.md` as pages, so `.md` has to
 * become a React component — hence MDX ahead of the React plugin.
 */
export default defineConfig({
  base: '/',
  // `public/` lives at the repository root; Vite copies it into `dist/` as is,
  // which is how `_redirects` (the Cloudflare Pages SPA fallback) gets there.
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  plugins: [
    { enforce: 'pre', ...mdx({ remarkPlugins: [remarkGfm] }) },
    react({ include: /\.(mdx?|[jt]sx?)$/ }),
  ],
})
