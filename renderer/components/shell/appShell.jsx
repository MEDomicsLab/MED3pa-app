import React, { useContext, useEffect, useState } from "react"
import { ipcRenderer } from "electron"
import { toast } from "react-toastify"
import { WorkspaceContext } from "../workspace/workspaceContext"
import { requestBackend } from "../../utilities/requests"
import MED3paPage from "../med3pa/med3paPage"
import WorkspaceGate from "./workspaceGate"
import DataAndModelsPanel from "./dataAndModelsPanel"

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

  const workspaceIsSet = workspace?.hasBeenSet === true

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
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#6C757D" }}>
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
          onClick={() => ipcRenderer.send("messageFromNext", "requestDialogFolder")}
          style={{ padding: "5px 14px", background: "transparent", color: "#6C757D", border: "1px solid #DEE2E6", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
        >
          Change workspace
        </button>
      </div>

      {/* MED3pa */}
      <div style={{ flexGrow: 1, minHeight: 0 }}>
        <MED3paPage pageId="med3pa" />
      </div>

      <DataAndModelsPanel visible={panelVisible} onHide={() => setPanelVisible(false)} />
    </div>
  )
}

export default AppShell
