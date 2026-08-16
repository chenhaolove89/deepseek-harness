/** Ambient CSS-module declaration for the package. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
