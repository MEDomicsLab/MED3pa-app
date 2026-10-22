import { requestBackend } from "./requests"

/**
 * One definition of "is the Go server up", shared by the header indicator and
 * the System page.
 *
 * These used to be two independent checks on different endpoints and different
 * schedules — the header pinged once on mount and gave up after five retries,
 * System polled every five seconds — so they disagreed permanently whenever the
 * server's state changed after startup.
 */

/** How often the status indicators re-check the server. */
export const SERVER_POLL_INTERVAL_MS = 5000

/**
 * @description Is the Go server answering? Read-only, safe to call on a timer.
 * @param {Number} port the Go server port
 * @param {String} pageId identifies the caller in the server log
 * @returns {Promise<Boolean>} true when the server responded
 */
export function checkServerHealth(port, pageId = "serverHealth") {
  return new Promise((resolve) => {
    if (!port) {
      resolve(false)
      return
    }
    requestBackend(
      port,
      "get_server_health",
      { pageId: pageId },
      (data) => resolve(Boolean(data)),
      () => resolve(false)
    )
  })
}

/**
 * @description Kill every python script the server is still tracking.
 *
 * The Go server outlives the window: after a crash or a renderer reload it can
 * still hold processes started by a session that no longer exists, and nothing
 * else would ever reap them. Call this ONCE when the renderer first connects —
 * it is a reset, not a health check, so repeating it on a timer would kill an
 * analysis that happened to be running.
 * @param {Number} port the Go server port
 * @returns {Promise<Boolean>} true when the server acknowledged
 */
export function resetServerScripts(port) {
  return new Promise((resolve) => {
    if (!port) {
      resolve(false)
      return
    }
    requestBackend(
      port,
      "clearAll",
      { data: "clearAll" },
      () => resolve(true),
      () => resolve(false)
    )
  })
}
