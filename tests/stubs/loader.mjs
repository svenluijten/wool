// Maps the Herdr runtime's modules to test stubs, so main.js can be loaded in Node.
const STUBS = { herdr: "./herdr.mjs", "gpui-kit": "./gpui-kit.mjs" };
export async function resolve(specifier, context, next) {
  if (specifier in STUBS) return { url: new URL(STUBS[specifier], import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
