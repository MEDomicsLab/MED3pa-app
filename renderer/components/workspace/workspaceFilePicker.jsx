import React, { useContext, useEffect, useMemo } from "react"
import { Dropdown } from "primereact/dropdown"
import { DataContext } from "./dataContext"

/**
 * File-type extensions backing each pickable kind.
 * `medmodel` objects are produced by the external-model import; `csv` objects
 * are recensed from the workspace DATA folder.
 */
const KIND_EXTENSIONS = {
  model: ["medmodel"],
  dataset: ["csv"]
}

/**
 * @typedef {React.FunctionComponent} WorkspaceFilePicker
 * @description Selects a workspace object (dataset or model) from the DataContext
 * and hands back its MongoDB id and display name.
 *
 * This replaces MEDomicsLab's `components/learning/input.jsx` (`data-input` /
 * `models-input` cases), which pulled the whole learning module in as a
 * dependency for what is, in practice, a filtered select over `globalData`.
 *
 * @param {String} label Text shown above the select
 * @param {"model"|"dataset"} kind What to list
 * @param {String} currentValue Currently selected object id
 * @param {Function} onChange Called with `{id, name}` (or `null` when cleared)
 * @param {Function} setHasWarning Optional; called with `{state, tooltip}` like the original Input
 * @param {Boolean} disabled Disables the select
 */
const WorkspaceFilePicker = ({ label, kind = "dataset", currentValue, onChange, setHasWarning, disabled = false }) => {
  const { globalData } = useContext(DataContext)
  const acceptedExtensions = KIND_EXTENSIONS[kind] || KIND_EXTENSIONS.dataset

  // Build the list of selectable objects from the global data context
  const options = useMemo(() => {
    if (!globalData) return []
    return Object.keys(globalData)
      .filter((id) => acceptedExtensions.includes(globalData[id].type))
      .map((id) => ({ label: globalData[id].name, value: id }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [globalData, kind])

  // Keep the parent's warning state in sync with the current selection
  useEffect(() => {
    if (!setHasWarning) return
    if (!currentValue) {
      setHasWarning({ state: true, tooltip: <p>No {kind} selected</p> })
    } else {
      setHasWarning({ state: false })
    }
  }, [currentValue, kind])

  const handleChange = (e) => {
    const id = e.value
    if (!id) {
      onChange(null)
      return
    }
    onChange({ id: id, name: globalData[id]?.name || "" })
  }

  return (
    <div style={{ marginBottom: 8 }}>
      {label && <label style={{ fontSize: 12, color: "#6C757D", display: "block", marginBottom: 4 }}>{label}</label>}
      <Dropdown
        style={{ width: "100%" }}
        disabled={disabled}
        value={currentValue ?? null}
        options={options}
        onChange={handleChange}
        showClear
        placeholder={options.length ? `Select a ${kind}…` : `No ${kind} in the workspace yet`}
        emptyMessage={kind === "model" ? "Import a model from the Models panel first" : "Drop a .csv in the workspace DATA folder first"}
      />
    </div>
  )
}

export default WorkspaceFilePicker
