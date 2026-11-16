/** Bun inlines text imports into the compiled binary. */
declare module '*.txt' {
  const content: string
  export default content
}
