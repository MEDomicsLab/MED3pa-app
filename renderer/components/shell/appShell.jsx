import React, { useContext, useEffect, useState } from "react"
import { ipcRenderer } from "electron"
import { toast } from "react-toastify"
import { WorkspaceContext } from "../workspace/workspaceContext"
import { requestBackend } from "../../utilities/requests"
import MED3paPage from "../med3pa/med3paPage"
import WorkspaceGate from "./workspaceGate"
import DataAndModelsPanel from "./dataAndModelsPanel"
import SettingsPage from "./settingsPage"
import NotificationOverlay from "../generalPurpose/notificationOverlay"

/**
 * @description Top-level chrome of the standalone MED3pa application.
 *
 * MEDomicsLab used a flexlayout tab manager plus an icon sidebar to host a dozen
 * modules. With a single module there is nothing to arrange, so this is a thin
 * header over the MED3pa page: workspace state, Go server health, and the entry
 * point for getting datasets and models into the workspace.
 */
const AppShell = () => {
  const { workspace, port } = useContext(WorkspaceContext)
  const [serverIsUp, setServerIsUp] = useState(false)
  const [panelVisible, setPanelVisible] = useState(false)
  const [view, setView] = useState("med3pa") // "med3pa" | "settings"

  const workspaceIsSet = workspace?.hasBeenSet === true

  /**
   * @description Tell the Go server which python interpreter to use.
   *
   * The server receives one as a launch argument, but that is read from
   * settings.json — absent on a fresh install, which leaves MED_ENV empty and
   * makes every analysis fail with "exec: no command". Resolving it here (same
   * order the main process uses: configured path, else bundled) means the app
   * works without having to visit the System page first.
   */
  const syncPythonEnv = async () => {
    const settings = await ipcRenderer.invoke("get-settings")
    const pythonPath = settings?.condaPath || (await ipcRenderer.invoke("getBundledPythonEnvironment"))
    if (!pythonPath) {
      toast.warn("No python environment is configured — set one in System before running an analysis")
      return
    }
    requestBackend(
      port,
      "update_python_env",
      { pythonPath: pythonPath, pageId: "appShell" },
      (data) => {
        if (data?.error) console.warn("Python environment rejected by the server: ", data.error)
      },
      (error) => console.error("Failed to set the python environment on the server: ", error)
    )
  }

  // Ping the Go server once the port is known, and retry a few times while it boots
  useEffect(() => {
    if (!port) return
    let attempt = 0
    let cancelled = false

    const ping = () => {
      if (cancelled) return
      requestBackend(
        port,
        "clearAll",
        { data: "clearAll" },
        () => {
          if (cancelled) return
          setServerIsUp(true)
          if (attempt > 0) toast.success("Go server is connected and ready")
          syncPythonEnv()
        },
        () => {
          if (cancelled) return
          setServerIsUp(false)
          attempt += 1
          if (attempt === 1) {
            // The server may simply not have finished starting: ask the main
            // process to (re)start it, then keep retrying for a short while.
            ipcRenderer.invoke("getBundledPythonEnvironment").then((pythonPath) => {
              ipcRenderer.invoke("start-server", pythonPath)
            })
          }
          if (attempt <= 5) setTimeout(ping, 2000)
          else toast.error("Go server is not responding — check the python environment in the logs")
        }
      )
    }
    ping()
    return () => {
      cancelled = true
    }
  }, [port])

  if (!workspaceIsSet) return <WorkspaceGate />

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily: "sans-serif" }}>
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "8px 16px",
          borderBottom: "1px solid #E9ECEF",
          background: "#fff"
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, color: "#185FA5" }}>MED3pa</span>
        <span style={{ fontSize: 11, color: "#6C757D", flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {workspace.workingDirectory?.path}
        </span>
        <NotificationOverlay />
        {/* Clicking the status light jumps to System settings, where the server can be started */}
        <span
          onClick={() => setView("settings")}
          title="Open System settings"
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#6C757D", cursor: "pointer" }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: serverIsUp ? "#0F6E56" : "#C92A2A", display: "inline-block" }} />
          {serverIsUp ? "Server ready" : "Server down"}
        </span>
        <button
          onClick={() => setPanelVisible(true)}
          style={{ padding: "5px 14px", background: "transparent", color: "#185FA5", border: "1px solid #185FA5", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
        >
          Data &amp; Models
        </button>
        <button
          onClick={() => setView(view === "settings" ? "med3pa" : "settings")}
          style={{
            padding: "5px 14px",
            background: view === "settings" ? "#185FA5" : "transparent",
            color: view === "settings" ? "#fff" : "#185FA5",
            border: "1px solid #185FA5",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12
          }}
        >
          {view === "settings" ? "← Back to MED3pa" : "System"}
        </button>
        <button
          onClick={() => ipcRenderer.send("messageFromNext", "requestDialogFolder")}
          style={{ padding: "5px 14px", background: "transparent", color: "#6C757D", border: "1px solid #DEE2E6", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
        >
          Change workspace
        </button>
      </div>

      {/* Both pages stay mounted: MED3pa keeps its in-progress configuration and
          results while you go fix the server or swap the python environment. */}
      <div style={{ flexGrow: 1, minHeight: 0 }}>
        <div style={{ height: "100%", display: view === "med3pa" ? "block" : "none" }}>
          <MED3paPage pageId="med3pa" />
        </div>
        <div style={{ height: "100%", display: view === "settings" ? "block" : "none" }}>
          <SettingsPage />
        </div>
      </div>

      <DataAndModelsPanel visible={panelVisible} onHide={() => setPanelVisible(false)} />
    </div>
  )
}

export default AppShell
