export const PORT_FINDING_METHOD = {
  FIX: 0,
  AVAILABLE: 1
}

/**
 * Per-workspace directories holding an app's own MongoDB config and data.
 *
 * These are the app's plumbing, not the user's data, so the workspace scan must
 * leave them alone: `.med3pa` holds a *live* mongod data directory, and
 * recensing it means walking and inserting every WiredTiger file on every
 * refresh. `.medomics` is MEDomicsLab's equivalent, kept here so a workspace
 * shared with that app is skipped too.
 *
 * Defined in this file because both the main process and the renderer need the
 * same list -- the previous renderer-side literal only named `.medomics`, which
 * is how `.med3pa` came to be recensed.
 */
export const APP_WORKSPACE_DIRS = [".med3pa", ".medomics"]

const config = {
  runServerAutomatically: true,
  useReactDevTools: false,
  defaultPort: 54388,
  mongoPort: 54117,
  portFindingMethod: PORT_FINDING_METHOD.FIX
}

export default config
