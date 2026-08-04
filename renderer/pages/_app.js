import { ipcRenderer } from "electron"
import Head from "next/head"
import { ConfirmDialog } from "primereact/confirmdialog"
import { ConfirmPopup } from "primereact/confirmpopup"
import React, { useEffect, useState } from "react"
import { ToastContainer } from "react-toastify"
import AppShell from "../components/shell/appShell"
import { NotificationContextProvider } from "../components/generalPurpose/notificationContext"
import { DataContextProvider } from "../components/workspace/dataContext"
import { MEDDataObject } from "../components/workspace/NewMedDataObject"
import { WorkspaceProvider } from "../components/workspace/workspaceContext"
import { loadMEDDataObjects, updateGlobalData } from "../utilities/appUtils/globalDataUtils"

// CSS
import "bootstrap/dist/css/bootstrap.min.css"
import "react-toastify/dist/ReactToastify.css"

// --primereact
import "primeicons/primeicons.css"
import "primereact/resources/primereact.min.css"
import "primereact/resources/themes/lara-light-blue/theme.css"

// --app styles
import "../styles/globals.css"

/**
 * Root component of the standalone MED3pa application.
 *
 * It owns the two pieces of state everything else reads: the workspace (which
 * determines where MongoDB runs and which files exist) and the global data
 * object (the MEDDataObjects recensed from that workspace).
 */
function App() {
  const [workspaceObject, setWorkspaceObject] = useState({
    hasBeenSet: false,
    workingDirectory: ""
  })
  const [recentWorkspaces, setRecentWorkspaces] = useState([])
  const [port, setPort] = useState() // The port of the Go server
  const [globalData, setGlobalData] = useState({})

  // Wire up the main-process channels once, at launch
  useEffect(() => {
    localStorage.clear()

    ipcRenderer.on("setWorkingDirectoryInApp", (event, data) => {
      ipcRenderer.invoke("setWorkingDirectory", data).then((newWorkspace) => {
        if (newWorkspace) setWorkspaceObject({ ...newWorkspace })
      })
      ipcRenderer.invoke("updateWorkspace", data)
    })

    ipcRenderer.on("setRecentWorkspacesInApp", (event, data) => {
      ipcRenderer.invoke("updateWorkspace", data)
    })

    ipcRenderer.on("updateDirectory", (event, data) => {
      setWorkspaceObject({ ...data })
    })

    ipcRenderer.on("getServerPort", (event, data) => {
      console.log("server port update from Electron:", data)
      setPort(data.newPort)
    })

    ipcRenderer.on("recentWorkspaces", (event, data) => {
      setRecentWorkspaces(data)
    })

    ipcRenderer.on("log", (event, data) => {
      console.log("log", data)
    })

    ipcRenderer.send("messageFromNext", "getServerPort")

    return () => {
      ipcRenderer.removeAllListeners("setWorkingDirectoryInApp")
      ipcRenderer.removeAllListeners("setRecentWorkspacesInApp")
      ipcRenderer.removeAllListeners("updateDirectory")
      ipcRenderer.removeAllListeners("getServerPort")
      ipcRenderer.removeAllListeners("recentWorkspaces")
      ipcRenderer.removeAllListeners("log")
    }
  }, [])

  useEffect(() => {
    MEDDataObject.verifyLockedObjects(globalData)
  }, [globalData])

  // Whenever the workspace changes, recense it into MongoDB and reload globalData
  useEffect(() => {
    async function getGlobalData() {
      await updateGlobalData(workspaceObject)
      const newGlobalData = await loadMEDDataObjects()
      setGlobalData(newGlobalData)
    }
    if (workspaceObject.hasBeenSet == true) {
      getGlobalData()
    }
  }, [workspaceObject])

  return (
    <>
      <Head>
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
        <title>MED3pa</title>
      </Head>
      <div style={{ height: "100%", width: "100%" }}>
        <NotificationContextProvider>
          <DataContextProvider globalData={globalData} setGlobalData={setGlobalData}>
            <WorkspaceProvider
              workspace={workspaceObject}
              setWorkspace={setWorkspaceObject}
              port={port}
              setPort={setPort}
              recentWorkspaces={recentWorkspaces}
              setRecentWorkspaces={setRecentWorkspaces}
            >
              <AppShell />
            </WorkspaceProvider>
          </DataContextProvider>
        </NotificationContextProvider>
        <ConfirmPopup />
        <ConfirmDialog />
        <ToastContainer position="bottom-right" autoClose={2000} limit={3} newestOnTop={false} closeOnClick pauseOnFocusLoss draggable pauseOnHover theme="light" />
      </div>
    </>
  )
}

export default App
