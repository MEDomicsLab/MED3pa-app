/* eslint-disable no-unused-vars */
import React, { useEffect, useState, useContext } from "react"
var path = require("path")
import fs from "fs"
const { spawn } = require("child_process")
import { ipcRenderer } from "electron"
import ModulePage from "../generalPurpose/modulePage"
import { Button } from "primereact/button"
import { TabView, TabPanel } from "primereact/tabview"
import { Col } from "react-bootstrap"
import { Check2Circle, Folder2Open, XCircleFill } from "react-bootstrap-icons"
import { InputText } from "primereact/inputtext"
import { InputNumber } from "primereact/inputnumber"
import { DataTable } from "primereact/datatable"
import { Column } from "primereact/column"
import { WorkspaceContext } from "../workspace/workspaceContext"
import FirstSetupModal from "../generalPurpose/installation/firstSetupModal"
import { requestBackend } from "../../utilities/requests"
import MEDconfig from "../../../medomics.dev"

/**
 * System settings page.
 *
 * Ported from MEDomicsLab's `mainPages/settings.jsx`, minus the Jupyter server
 * controls (this app has no notebook editor). This is where you start/stop the
 * Go server, point the app at a different python interpreter, and check on
 * MongoDB — all of which MED3pa needs in order to run anything.
 *
 * @returns {JSX.Element} Settings page
 */
const SettingsPage = ({ pageId = "settings" }) => {
  const { workspace, port } = useContext(WorkspaceContext)
  const [settings, setSettings] = useState(null) // Settings object
  const [serverIsRunning, setServerIsRunning] = useState(false) // Boolean to know if the Go server is running
  const [mongoServerIsRunning, setMongoServerIsRunning] = useState(false) // Boolean to know if MongoDB is running
  const [activeIndex, setActiveIndex] = useState(0) // Index of the active tab
  const [condaPath, setCondaPath] = useState("") // Path to the python executable
  const [seed, setSeed] = useState(54388) // Seed for random number generation
  const [pythonEmbedded, setPythonEmbedded] = useState({}) // Bundled python environment + its packages
  const [showPythonPackages, setShowPythonPackages] = useState(false)
  const [firstSetupModalVisible, setFirstSetupModalVisible] = useState(false)

  /**
   * Check if the mongo server is running and set the state
   * @returns {void}
   */
  const checkMongoIsRunning = () => {
    ipcRenderer.invoke("checkMongoIsRunning").then((status) => {
      setMongoServerIsRunning(status)
    })
  }

  /**
   * Check if the Go server is responding
   */
  const checkServer = () => {
    requestBackend(
      port,
      "get_server_health",
      { pageId: pageId },
      (data) => {
        if (data) setServerIsRunning(true)
      },
      () => {
        setServerIsRunning(false)
      }
    )
  }

  /**
   * Get the settings from the main process on mount
   *
   * The resolved interpreter is also pushed to the Go server here. The server is
   * given a python path as a launch argument, but that comes from settings.json —
   * which does not exist on a fresh install, leaving MED_ENV empty and every
   * script failing with "exec: no command". Re-sending it on mount makes the
   * running server agree with what this page displays.
   */
  useEffect(() => {
    checkServer()
    checkMongoIsRunning()
    let condaCustomPath = null
    ipcRenderer.invoke("get-settings").then((receivedSettings) => {
      setSettings(receivedSettings)
      if (receivedSettings?.condaPath && receivedSettings?.condaPath !== condaPath) {
        condaCustomPath = receivedSettings?.condaPath
        setCondaPath(receivedSettings?.condaPath)
        updatePythonEnvOnServer(receivedSettings.condaPath)
      }
      if (receivedSettings?.seed) {
        setSeed(receivedSettings?.seed)
      }
    })
    ipcRenderer.invoke("getBundledPythonEnvironment").then((res) => {
      if (res !== null && !condaCustomPath) {
        updatePythonEnvOnServer(res)
        ipcRenderer.invoke("getInstalledPythonPackages", res).then((pythonPackages) => {
          setPythonEmbedded({ pythonEmbedded: res, pythonPackages: pythonPackages })
        })
      }
    })
  }, [])

  useEffect(() => {
    if (pythonEmbedded.pythonEmbedded && !condaPath) {
      setCondaPath(pythonEmbedded.pythonEmbedded)
    }
  }, [pythonEmbedded])

  /**
   * Save the settings in the main process
   * @param {Object} newSettings - New settings object
   * @returns {void}
   * Creates a timeout to avoid too many calls when the user is typing
   */
  const saveSettings = (newSettings) => {
    clearTimeout(window.saveSettingsTimeout)
    window.saveSettingsTimeout = setTimeout(() => {
      ipcRenderer.send("save-settings", newSettings)
    }, 1000)
  }

  /**
   * Notify the running Go server that the python environment changed (updates its MED_ENV),
   * so that python scripts launched after this call use the new interpreter
   * @param {String} newPath - Path to the python executable
   * @returns {void}
   */
  const updatePythonEnvOnServer = (newPath) => {
    if (!newPath) return
    requestBackend(
      port,
      "update_python_env",
      { pythonPath: newPath, pageId: pageId },
      (data) => {
        if (data?.error) {
          console.warn("Python environment update rejected by the server: ", data.error)
        }
      },
      (error) => {
        console.error("Failed to update the python environment on the server: ", error)
      }
    )
  }

  /**
   * Poll the server, MongoDB and the python environment every 5 seconds
   */
  useEffect(() => {
    const interval = setInterval(() => {
      checkServer()
      checkMongoIsRunning()
      ipcRenderer.invoke("getBundledPythonEnvironment").then((res) => {
        if (res !== null && res !== pythonEmbedded && !condaPath) {
          ipcRenderer.invoke("getInstalledPythonPackages", res).then((pythonPackages) => {
            setPythonEmbedded({ pythonEmbedded: res, pythonPackages: pythonPackages })
          })
        } else if (condaPath && condaPath !== pythonEmbedded?.pythonEmbedded) {
          setPythonEmbedded({ ...pythonEmbedded, pythonEmbedded: condaPath })
        }
      })
    }, 5000)
    return () => clearInterval(interval)
  })

  /**
   * Start MongoDB against the config written into the current workspace
   */
  const startMongo = () => {
    let workspacePath = workspace.workingDirectory.path
    const mongoConfigPath = path.join(workspacePath, ".med3pa", "mongod.conf") // see APP_WORKSPACE_DIR in main/utils/workspace.js
    let mongod = getMongoDBPath()
    let mongoResult = spawn(mongod, ["--config", mongoConfigPath])

    mongoResult.stdout.on("data", (data) => {
      console.log(`MongoDB stdout: ${data}`)
    })

    mongoResult.stderr.on("data", (data) => {
      console.error(`MongoDB stderr: ${data}`)
    })

    mongoResult.on("close", (code) => {
      console.log(`MongoDB process exited with code ${code}`)
    })

    mongoResult.on("error", (err) => {
      console.error("Failed to start MongoDB: ", err)
    })
  }

  /**
   * Locate the mongod executable for the current platform
   * @returns {String|null} path to mongod, or null if it could not be found
   */
  function getMongoDBPath() {
    if (process.platform === "win32") {
      const paths = process.env.PATH.split(path.delimiter)
      for (let i = 0; i < paths.length; i++) {
        const binPath = path.join(paths[i], "mongod.exe")
        if (fs.existsSync(binPath)) {
          return binPath
        }
      }

      const programFilesPath = process.env["ProgramFiles"]
      if (programFilesPath) {
        const mongoPath = path.join(programFilesPath, "MongoDB", "Server")
        const dirs = fs.readdirSync(mongoPath)
        for (let i = 0; i < dirs.length; i++) {
          const binPath = path.join(mongoPath, dirs[i], "bin", "mongod.exe")
          if (fs.existsSync(binPath)) {
            return binPath
          }
        }
      }
      console.error("mongod not found")
      return null
    } else if (process.platform === "darwin") {
      if (process.env.NODE_ENV === "production") {
        if (fs.existsSync(path.join(process.env.HOME, ".medomics", "mongodb", "bin", "mongod"))) {
          return path.join(process.env.HOME, ".medomics", "mongodb", "bin", "mongod")
        }
      } else {
        return "mongod"
      }
    } else if (process.platform === "linux") {
      const paths = process.env.PATH.split(path.delimiter)
      for (let i = 0; i < paths.length; i++) {
        const binPath = path.join(paths[i], "mongod")
        if (fs.existsSync(binPath)) {
          return binPath
        }
      }
      if (fs.existsSync("/usr/bin/mongod")) {
        return "/usr/bin/mongod"
      }
      if (fs.existsSync("/home/" + process.env.USER + "/.medomics/mongodb/bin/mongod")) {
        return "/home/" + process.env.USER + "/.medomics/mongodb/bin/mongod"
      }
      return null
    }
  }

  const rowStyle = { display: "flex", flexDirection: "row", justifyContent: "flex-start", alignItems: "center", flexWrap: "wrap", marginTop: ".75rem" }

  return (
    <>
      <ModulePage pageId="Settings">
        <TabView panelContainerStyle={{ padding: "0rem" }} className="settingsTab" activeIndex={activeIndex} onTabChange={(e) => setActiveIndex(e.index)}>
          <TabPanel index={0} headerStyle={{ padding: "0rem", color: "black" }} style={{ padding: "0rem" }} header="System" leftIcon="pi pi-fw pi-cog">
            <div className="settings-user" style={{ marginTop: "1rem" }}>
              <Col>
                {/* Go server */}
                <Col xs={12} md={10} style={{ ...rowStyle, marginTop: 0 }}>
                  <h5 style={{ marginBottom: "0rem" }}>Go server status : </h5>
                  <h5 style={{ marginBottom: "0rem", marginLeft: "1rem", color: serverIsRunning ? "green" : "#d55757" }}>{serverIsRunning ? "Running" : "Stopped"}</h5>
                  {serverIsRunning ? <Check2Circle size="30" style={{ marginInline: "1rem", color: "green" }} /> : <XCircleFill size="25" style={{ marginInline: "1rem", color: "#d55757" }} />}
                  <Button
                    label="Start server"
                    className=" p-button-success"
                    onClick={() => {
                      ipcRenderer.invoke("start-server", condaPath).then((status) => {
                        console.log("Server started manually", status)
                      })
                    }}
                    style={{ backgroundColor: serverIsRunning ? "grey" : "#54a559", borderColor: serverIsRunning ? "grey" : "#54a559", marginRight: "1rem" }}
                    disabled={serverIsRunning}
                  />
                  <Button
                    label="Stop server"
                    className="p-button-danger"
                    onClick={() => {
                      ipcRenderer.invoke("kill-server").then((stopped) => {
                        if (stopped) setServerIsRunning(false)
                      })
                    }}
                    style={{ backgroundColor: serverIsRunning ? "#d55757" : "grey", borderColor: serverIsRunning ? "#d55757" : "grey" }}
                    disabled={!serverIsRunning}
                  />
                  <h6 style={{ marginBottom: 0, marginLeft: "1rem", color: "#6C757D" }}>port {port ?? MEDconfig.defaultPort}</h6>
                </Col>

                {/* Python environment */}
                <Col xs={12} md={12} style={rowStyle}>
                  <Col xs={12} md="auto" style={{ display: "flex", flexDirection: "row", justifyContent: "flex-start", alignItems: "center", flexWrap: "wrap" }}>
                    <h5>Python environment path : </h5>
                  </Col>
                  <Col xs={12} md="auto" style={{ display: "flex", flexDirection: "row", justifyContent: "flex-start", alignItems: "center", flexWrap: "nowrap", flexGrow: "1" }}>
                    <InputText
                      style={{ marginInline: "0.5rem", width: "90%" }}
                      placeholder={settings?.condaPath ? settings?.condaPath : "Not defined"}
                      value={condaPath}
                      onChange={(e) => {
                        setCondaPath(e.target.value)
                        saveSettings({ ...settings, condaPath: e.target.value })
                        clearTimeout(window.updatePythonEnvTimeout)
                        window.updatePythonEnvTimeout = setTimeout(() => {
                          updatePythonEnvOnServer(e.target.value)
                        }, 1000)
                      }}
                    />
                    <a
                      onClick={() => {
                        ipcRenderer.invoke("open-dialog-exe").then((selectedPath) => {
                          setCondaPath(selectedPath)
                          setPythonEmbedded({ ...pythonEmbedded, pythonEmbedded: selectedPath })
                          saveSettings({ ...settings, condaPath: selectedPath })
                          updatePythonEnvOnServer(selectedPath)
                        })
                      }}
                    >
                      <Folder2Open size="30" style={{ marginLeft: "0rem" }} />
                    </a>
                  </Col>
                </Col>
                <Col xs={12} md={12} style={{ marginTop: "0.25rem" }}>
                  <h6 style={{ color: "#6C757D", fontSize: 12 }}>
                    This interpreter must have MED3pa installed — see <code>pythonEnv/requirements.txt</code>. Changing it takes effect for scripts launched after the change.
                  </h6>
                </Col>

                {/* Seed */}
                <Col xs={12} md={12} style={rowStyle}>
                  <Col xs={12} md="auto" style={{ display: "flex", flexDirection: "row", justifyContent: "flex-start", alignItems: "center", flexWrap: "wrap" }}>
                    <h5>General Seed for Random Number Generation: </h5>
                  </Col>
                  <Col xs={12} md="auto" style={{ display: "flex", flexDirection: "row", justifyContent: "flex-start", alignItems: "center", flexWrap: "nowrap", flexGrow: "1" }}>
                    <InputNumber
                      style={{ marginInline: "0.5rem", width: "90%" }}
                      value={seed}
                      onChange={(e) => {
                        setSeed(e.value)
                        saveSettings({ ...settings, seed: e.value })
                      }}
                    />
                  </Col>
                </Col>

                {/* MongoDB */}
                <Col xs={12} md={10} style={rowStyle}>
                  <h5 style={{ marginBottom: "0rem" }}>MongoDB status : </h5>
                  <h5 style={{ marginBottom: "0rem", marginLeft: "1rem", color: mongoServerIsRunning ? "green" : "#d55757" }}>{mongoServerIsRunning ? "Running" : "Stopped"}</h5>
                  {mongoServerIsRunning ? <Check2Circle size="30" style={{ marginInline: "1rem", color: "green" }} /> : <XCircleFill size="25" style={{ marginInline: "1rem", color: "#d55757" }} />}
                  <Button
                    label="Start server"
                    className=" p-button-success"
                    onClick={() => startMongo()}
                    style={{ backgroundColor: mongoServerIsRunning ? "grey" : "#54a559", borderColor: mongoServerIsRunning ? "grey" : "#54a559", marginRight: "1rem" }}
                    disabled={mongoServerIsRunning}
                  />
                  <Button label="Run first-time setup" className="p-button-info" onClick={() => setFirstSetupModalVisible(true)} />
                  <h6 style={{ marginBottom: 0, marginLeft: "1rem", color: "#6C757D" }}>port {MEDconfig.mongoPort}</h6>
                </Col>

                {/* Bundled python */}
                <Col xs={12} md={12} style={rowStyle}>
                  <Col xs={12} md="auto" style={{ display: "flex", flexDirection: "row", justifyContent: "flex-start", alignItems: "center", flexWrap: "wrap" }}>
                    <h5>Python bundled : &nbsp;</h5>
                  </Col>
                  <Col xs={12} md="auto" style={{ display: "flex", flexDirection: "row", justifyContent: "flex-start", alignItems: "center", flexWrap: "nowrap", flexGrow: "1" }}>
                    {pythonEmbedded.pythonEmbedded && <Check2Circle size="25" style={{ marginInline: "1rem", color: "green" }} />}
                    {!pythonEmbedded.pythonEmbedded && <XCircleFill size="25" style={{ marginInline: "1rem", color: "#d55757" }} />}
                    <h5>{pythonEmbedded.pythonEmbedded ? `Yes` : "No"} &nbsp;</h5>

                    {!pythonEmbedded.pythonEmbedded && <Button label="Install Python" onClick={() => ipcRenderer.invoke("installBundledPythonExecutable")} />}
                    {pythonEmbedded.pythonEmbedded && (
                      <Button label={showPythonPackages ? "Hide Python Packages" : "Show Python Packages"} onClick={() => setShowPythonPackages(!showPythonPackages)} />
                    )}
                    {pythonEmbedded.pythonEmbedded && typeof pythonEmbedded.pythonEmbedded === "string" && (
                      <h6 style={{ marginTop: "0.5rem", marginLeft: "0.75rem" }}>at {pythonEmbedded.pythonEmbedded}</h6>
                    )}
                  </Col>
                </Col>
                {showPythonPackages && (
                  <DataTable value={pythonEmbedded.pythonPackages} size="small" scrollable scrollHeight="25rem" style={{ marginTop: "1rem" }}>
                    <Column field="name" header="Name" />
                    <Column field="version" header="Version" />
                  </DataTable>
                )}
              </Col>
            </div>
          </TabPanel>
        </TabView>
      </ModulePage>
      <FirstSetupModal visible={firstSetupModalVisible} onHide={() => setFirstSetupModalVisible(false)} closable={true} />
    </>
  )
}

export default SettingsPage
