import React, { useEffect, useState } from "react"
import { ipcRenderer } from "electron"

/**
 * @description Landing screen shown until a workspace folder has been chosen.
 *
 * The workspace folder is what MongoDB is started against (`.medomics/mongod.conf`)
 * and what the DATA folder is scanned from, so nothing in MED3pa can run before
 * one is selected.
 */
const WorkspaceGate = () => {
  const [recentWorkspaces, setRecentWorkspaces] = useState([])

  useEffect(() => {
    ipcRenderer.on("recentWorkspaces", (event, data) => setRecentWorkspaces(data || []))
    ipcRenderer.send("getRecentWorkspaces", "requestRecentWorkspaces")
    return () => ipcRenderer.removeAllListeners("recentWorkspaces")
  }, [])

  const openWorkspaceDialog = () => ipcRenderer.send("messageFromNext", "requestDialogFolder")

  const openWorkspace = (workspacePath) => {
    ipcRenderer.invoke("updateWorkspace", workspacePath).then(() => {
      ipcRenderer.invoke("setWorkingDirectory", workspacePath)
    })
  }

  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8F9FA", fontFamily: "sans-serif" }}>
      <div style={{ width: 520, background: "#fff", border: "1px solid #E9ECEF", borderRadius: 10, padding: "28px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: "#185FA5" }}>MED3pa</span>
          <span style={{ background: "#185FA5", color: "#E6F1FB", borderRadius: 10, fontSize: 10, fontWeight: 700, padding: "1px 8px" }}>v1</span>
        </div>
        <p style={{ fontSize: 13, color: "#6C757D", marginTop: 0, marginBottom: 20 }}>
          Predictive Performance Precision Analysis — uncertainty, problematic profiles and declaration-rate driven deployment.
        </p>

        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Choose a workspace folder to begin</div>
        <p style={{ fontSize: 11, color: "#6C757D", lineHeight: 1.6, marginTop: 0 }}>
          The workspace holds your datasets (<code>DATA/</code>), your imported models and the local MongoDB instance that stores MED3pa sessions,
          deployments and patient records.
        </p>
        <button
          onClick={openWorkspaceDialog}
          style={{ padding: "9px 20px", background: "#185FA5", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500 }}
        >
          Open workspace…
        </button>

        {recentWorkspaces.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 500, margin: "22px 0 6px", color: "#495057" }}>Recent</div>
            {recentWorkspaces.map((workspace) => (
              <div
                key={workspace.path}
                onClick={() => openWorkspace(workspace.path)}
                style={{ fontSize: 12, color: "#185FA5", cursor: "pointer", padding: "4px 0", wordBreak: "break-all" }}
              >
                {workspace.path}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

export default WorkspaceGate
