export function verifiedImport<Module>(url: string, integrity: string, document: Document, nonce: string): Promise<Module> {
  if (!integrity) return import(/* @vite-ignore */ /* webpackIgnore: true */ url) as Promise<Module>
  return new Promise((loaded, failed) => {
    const tag = document.createElement('script')
    tag.type = 'module'
    tag.crossOrigin = 'anonymous'
    tag.integrity = integrity
    tag.nonce = nonce
    tag.src = url
    tag.onload = loaded
    tag.onerror = failed
    document.head.append(tag)
  }).then(() => import(/* @vite-ignore */ /* webpackIgnore: true */ url) as Promise<Module>)
}
