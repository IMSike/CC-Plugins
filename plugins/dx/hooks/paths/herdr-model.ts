// herdr's `imsike.links` plugin, which opens the `dx-open:` links dx makes:
// found from herdr's own list of its plugins (ADR 0009). Pure, without `$`;
// ./paths.tsx runs the command.

// The herdr plugin, by its id, and how it is installed.
export const LINKS_PLUGIN = 'imsike.links'
export const LINKS_INSTALL = 'herdr plugin install IMSike/Herdr-Plugins/links'

// The command that lists it, as JSON: herdr's own, read-only. herdr is run
// from `HERDR_BIN_PATH`, which herdr sets in its panes to its own program,
// when that is an absolute path with a drive (never a network path); else by
// its name, found on the `PATH`.
export function listLinksCommand(binPath: string | undefined): string[] {
  const herdr = binPath !== undefined && /^[A-Za-z]:[\\/]/.test(binPath) && !/[\u0000-\u001f]/.test(binPath) ? binPath : 'herdr'
  return [herdr, 'plugin', 'list', '--plugin', LINKS_PLUGIN, '--json']
}

type Listed = { plugin_id?: unknown; enabled?: unknown; link_handlers?: unknown }

// Whether herdr's list of its plugins (`{ result: { plugins: [{ plugin_id,
// enabled, link_handlers: [{ pattern }] }] } }`) holds `imsike.links`,
// enabled (`enabled` true, as herdr 0.9.5 writes it; absent, not taken as
// enabled), with a link handler for `dx-open:` URLs (a pattern starting
// `^dx-open`): a click on a link dx makes then reaches it. Anything else,
// what cannot be read included, is no.
export function isLinksPluginListed(stdout: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return false
  }
  const plugins = (parsed as { result?: { plugins?: unknown } } | null)?.result?.plugins
  if (!Array.isArray(plugins)) return false
  const plugin = (plugins as (Listed | null)[]).find(item => item?.plugin_id === LINKS_PLUGIN)
  if (plugin === undefined || plugin === null || plugin.enabled !== true || !Array.isArray(plugin.link_handlers)) return false
  return (plugin.link_handlers as unknown[]).some(handler => {
    const pattern = (handler as { pattern?: unknown } | null)?.pattern
    return typeof pattern === 'string' && pattern.startsWith('^dx-open')
  })
}
