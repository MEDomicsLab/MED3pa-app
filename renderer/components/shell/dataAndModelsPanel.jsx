import React, { useContext, useState } from "react"
import { ipcRenderer } from "electron"
import { Dialog } from "primereact/dialog"
import { Button } from "primereact/button"
import { toast } from "react-toastify"
import { DataContext } from "../workspace/dataContext"
import { MEDDataObject } from "../workspace/NewMedDataObject"
import ExternalModelImport from "../models/ExternalModelImport"

/**
 * @description Everything MED3pa needs to get *into* the workspace: datasets and base models.
 *
 * In MEDomicsLab this was spread across the file-explorer sidebar and the Input
 * module. The standalone app only needs two operations, so they live together here.
 *
 * @param {Boolean} visible whether the dialog is shown
 * @param {Function} onHide called when the dialog is dismissed
 */
const DataAndModelsPanel = ({ visible, onHide }) => {
  const { globalData } = useContext(DataContext)
  const [tab, setTab] = useState("datasets")

  const listByType = (types) =>
    Object.keys(globalData || {})
      .filter((id) => types.includes(globalData[id].type))
      .map((id) => globalData[id])
      .sort((a, b) => a.name.localeCompare(b.name))

  const datasets = listByType(["csv"])
  const models = listByType(["medmodel"])

  /**
   * @description Copy CSV files into the workspace DATA folder and re-scan so they
   * are recensed into MongoDB and become selectable in the configuration page.
   */
  const importCsv = async () => {
    const copied = await ipcRenderer.invoke("import-csv-files")
    if (!copied || copied.length === 0) return
    toast.success(`Imported ${copied.length} dataset${copied.length > 1 ? "s" : ""}`)
    MEDDataObject.updateWorkspaceDataObject()
  }

  const tabBtn = (key, label) => (
    <div
      onClick={() => setTab(key)}
      style={{
        padding: "6px 14px",
        fontSize: 12,
        cursor: "pointer",
        borderRadius: "6px 6px 0 0",
        background: tab === key ? "#fff" : "transparent",
        color: tab === key ? "#185FA5" : "#6C757D",
        fontWeight: tab === key ? 600 : 400,
        border: tab === key ? "1px solid #E9ECEF" : "1px solid transparent",
        borderBottom: "none"
      }}
    >
      {label}
    </div>
  )

  return (
    <Dialog header="Data & Models" visible={visible} onHide={onHide} style={{ width: "62vw", maxWidth: 900 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {tabBtn("datasets", `Datasets (${datasets.length})`)}
        {tabBtn("models", `Base models (${models.length})`)}
      </div>
      <div style={{ border: "1px solid #E9ECEF", borderRadius: "0 6px 6px 6px", padding: 16, background: "#fff" }}>
        {tab === "datasets" ? (
          <>
            <p style={{ fontSize: 12, color: "#6C757D", marginTop: 0 }}>
              Datasets are copied into <code>DATA/</code> in your workspace and loaded into the local MongoDB so MED3pa can read them.
            </p>
            <Button label="Import CSV…" icon="pi pi-upload" onClick={importCsv} size="small" />
            <div style={{ marginTop: 14 }}>
              {datasets.length === 0 ? (
                <div style={{ fontSize: 12, color: "#6C757D" }}>No dataset in this workspace yet.</div>
              ) : (
                datasets.map((dataset) => (
                  <div key={dataset.id} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid #F1F3F5" }}>
                    {dataset.name}
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            {models.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Already imported</div>
                {models.map((model) => (
                  <div key={model.id} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid #F1F3F5" }}>
                    {model.name}
                  </div>
                ))}
              </div>
            )}
            <ExternalModelImport />
          </>
        )}
      </div>
    </Dialog>
  )
}

export default DataAndModelsPanel
