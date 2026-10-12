// The docs app imports stylesheets as assets; webpack handles them, TypeScript
// needs to be told they exist. `.md` is left to `@types/mdx`.
declare module '*.css'
declare module '*.scss'
declare module 'github-markdown-css'
