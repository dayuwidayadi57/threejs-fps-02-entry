// test-loader.mjs — resolves the bare specifier 'three' to the vendored
// three.module.min.js, so Node can import the game sources (which use the
// browser import map's 'three') for headless tests. Used by test-world.mjs
// via register-three.mjs; not part of the game.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return {
      url: new URL('./game/vendor/three/three.module.min.js', import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
