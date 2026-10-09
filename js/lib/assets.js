// Loads the static files shipped with the site (certificate template, logo, layout data).
// Tests swap the loader so the same code runs outside a browser.

let loader = async (path) => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
};

export function setAssetLoader(fn) { loader = fn; }
export const loadAsset = (path) => loader(path);
export async function loadJson(path) {
  return JSON.parse(new TextDecoder().decode(await loader(path)));
}
