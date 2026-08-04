/**
 * Minimal path helpers.
 *
 * In MEDomicsLab these lived in `utilities/fileManagementUtils.js` alongside a
 * large amount of workspace file-tree machinery that the standalone MED3pa app
 * does not need. Only the separator helper is used here (by MEDDataObject).
 */

/**
 * @description Returns the path separator of the current platform
 * @returns {String} "\\" on Windows, "/" elsewhere
 */
export function getPathSeparator() {
  // eslint-disable-next-line no-undef
  let process = require("process")
  if (process.platform === "win32") {
    return "\\"
  }
  return "/"
}
