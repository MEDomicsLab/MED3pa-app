import { app, ipcMain, Menu, dialog, BrowserWindow, protocol, shell, nativeTheme } from "electron"
import axios from "axios"
import os from "os"
import serve from "electron-serve"
import { createWindow } from "./helpers"
import MEDconfig from "../medomics.dev"
import { runServer, findAvailablePort } from "./utils/server"
import { setWorkingDirectory, getRecentWorkspacesOptions, loadWorkspaces, createMedomicsDirectory, updateWorkspace, createWorkingDirectory } from "./utils/workspace"
import {
  getBundledPythonEnvironment,
  getInstalledPythonPackages,
  installPythonPackage,
  installBundledPythonExecutable,
  checkPythonRequirements,
  installRequiredPythonPackages
} from "./utils/pythonEnv"
import { installMongoDB, checkRequirements } from "./utils/installation"

const fs = require("fs")
const net = require("net")
var path = require("path")
let mongoProcess = null
// Set while startMongoDB is in flight so concurrent callers (workspace change,
// a renderer asking for a reconnect) share one attempt instead of racing to
// spawn several mongod processes against the same dbPath.
let mongoStarting = null
const dirTree = require("directory-tree")
const { exec, spawn, execSync } = require("child_process")
let serverProcess = null
const serverState = { serverIsRunning: false }
var serverPort = MEDconfig.defaultPort
var hasBeenSet = false
const isProd = process.env.NODE_ENV === "production"
let splashScreen // The splash screen is the window that is displayed while the application is loading
export var mainWindow // The main window is the window of the application

//**** AUTO UPDATER ****//
const { autoUpdater } = require("electron-updater")
const log = require("electron-log")

autoUpdater.logger = log
autoUpdater.logger.transports.file.level = "info"
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

//*********** LOG **************// This is used to send the console.log messages to the main window
//**** ELECTRON-LOG ****//
// Electron log path
// By default, it writes logs to the following locations:
// on Linux: ~/.config/{app name}/logs/main.log
// on macOS: ~/Library/Logs/{app name}/main.log
// on Windows: %USERPROFILE%\AppData\Roaming\{app name}\logs\main.log
const APP_NAME = isProd ? "med3pa-app" : "med3pa-app (development)"

const originalConsoleLog = console.log
/**
 * @description Sends the console.log messages to the main window
 * @param {*} message The message to send
 * @summary We redefine the console.log function to send the messages to the main window
 */
console.log = function () {
  try {
    originalConsoleLog(...arguments)
    log.log(...arguments)
    if (mainWindow !== undefined) {
      // Safely serialize all arguments to a string
      const msg = Array.from(arguments)
        .map((arg) => {
          if (typeof arg === "string") return arg
          try {
            return JSON.stringify(arg)
          } catch {
            return util.inspect(arg, { depth: 2 })
          }
        })
        .join(" ")
      mainWindow.webContents.send("log", msg)
    }
  } catch (error) {
    console.error(error)
  }
}

//**** AUTO-UPDATER ****//

function sendStatusToWindow(text) {
  // BrowserWindow has no showMessage method, so the previous call threw a
  // TypeError from inside the autoUpdater "error" handler — which fires on every
  // launch of a build without a publish feed, turning a harmless "no update
  // configured" into an unhandled error. "log" is the channel the renderer
  // already listens on.
  log.info(text)
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send("log", text)
  }
}

autoUpdater.on("checking-for-update", () => {
  sendStatusToWindow("Checking for update...")
})

autoUpdater.on("update-available", (info) => {
  log.info("Update available:", info)

  // Show a dialog to ask the user if they want to download the update
  const dialogOpts = {
    type: "info",
    buttons: ["Download", "Later"],
    title: "Application Update",
    message: "A new version is available",
    detail: `MED3pa ${info.version} is available. You have ${app.getVersion()}. Would you like to download it now?`
  }

  dialog.showMessageBox(mainWindow, dialogOpts).then((returnValue) => {
    if (returnValue.response === 0) {
      // If the user clicked "Download"
      sendStatusToWindow("Downloading update...")
      autoUpdater.downloadUpdate()
    }
  })
})

autoUpdater.on("update-not-available", (info) => {
  info = JSON.stringify(info)
  sendStatusToWindow(`Update not available. ${info}`)
  sendStatusToWindow(`Current version: ${app.getVersion()}`)
})

autoUpdater.on("error", (err) => {
  sendStatusToWindow("Error in auto-updater. " + err)
})

autoUpdater.on("download-progress", (progressObj) => {
  let log_message = `Download speed: ${progressObj.bytesPerSecond} - `
  log_message += `Downloaded ${progressObj.percent.toFixed(2)}% `
  log_message += `(${progressObj.transferred}/${progressObj.total})`
  log.info(log_message)
  sendStatusToWindow(log_message)
  mainWindow.webContents.send("update-download-progress", progressObj)
})

autoUpdater.on("update-downloaded", (info) => {
  log.info("Update downloaded:", info)
  let downloadPath, debFilePath
  let dialogOpts = {
    type: "info",
    buttons: ["Restart", "Later"],
    title: "Application Update",
    message: "Update Downloaded",
    detail: `MED3pa ${info.version} has been downloaded. Restart the application to apply the updates.`
  }

  // For Linux, provide additional instructions
  if (process.platform === "linux") {
    downloadPath = path.join(process.env.HOME, ".cache", "med3pa-app-updater", "pending")
    debFilePath = info.files[0].url.split("/").pop()
    dialogOpts = {
      type: "info",
      buttons: ["Copy Command & Quit", "Copy Command", "Later"],
      title: "Application Update",
      message: "Update Downloaded",
      detail: `MED3pa ${info.version} has been downloaded. On Linux, you may need to run the installer with sudo:\n\nsudo dpkg -i ${path.join(downloadPath, debFilePath)} \n\nClick 'Copy Command & Restart' to copy this command to your clipboard and restart the application, or 'Copy Command' to just copy it.`
    }
  }

  dialog.showMessageBox(mainWindow, dialogOpts).then((returnValue) => {
    if (process.platform === "linux") {
      if (returnValue.response === 0 || returnValue.response === 1) {
        // Construct the command to install the deb file
        const command = `sudo dpkg -i "${path.join(downloadPath, debFilePath)}"`

        // Copy to clipboard
        require("electron").clipboard.writeText(command)

        if (returnValue.response === 0) {
          autoUpdater.quitAndInstall()
        }
      }
    } else if (returnValue.response === 0) {
      autoUpdater.quitAndInstall()
    }
  })
})

if (isProd) {
  serve({ directory: "app" })
} else {
  app.setPath("userData", `${app.getPath("userData")} (development)`)
}

;(async () => {
  await app.whenReady()

  protocol.registerFileProtocol("local", (request, callback) => {
    const url = request.url.replace(/^local:\/\//, "")
    const decodedUrl = decodeURI(url)
    try {
      return callback(decodedUrl)
    } catch (error) {
      console.error("ERROR: registerLocalProtocol: Could not get file path:", error)
    }
  })

  ipcMain.on("get-file-path", (event, configPath) => {
    event.reply("get-file-path-reply", path.resolve(configPath))
  })

  splashScreen = new BrowserWindow({
    icon: path.join(__dirname, "../resources/MED3paLogo.png"),
    width: 700,
    height: 700,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    center: true,
    show: true
  })

  mainWindow = createWindow("main", {
    width: 1500,
    height: 1000,
    show: false
  })

  if (isProd) {
    splashScreen.loadFile(path.join(__dirname, "splash.html"))
  } else {
    splashScreen.loadFile(path.join(__dirname, "../main/splash.html"))
  }
  splashScreen.once("ready-to-show", () => {
    splashScreen.show()
    splashScreen.focus()
    splashScreen.setAlwaysOnTop(true)
  })
  const openRecentWorkspacesSubmenuOptions = getRecentWorkspacesOptions(null, mainWindow, hasBeenSet, serverPort)
  console.log("openRecentWorkspacesSubmenuOptions", JSON.stringify(openRecentWorkspacesSubmenuOptions, null, 2))
  const menuTemplate = [
    {
      label: "File",
      submenu: [{ label: "Open recent", submenu: getRecentWorkspacesOptions(null, mainWindow, hasBeenSet, serverPort) }, { type: "separator" }, { role: "quit" }]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { type: "separator" },
        {
          role: "preferences",
          label: "Preferences",
          click: () => {
            console.log("👋")
          },
          submenu: [
            {
              label: "Toggle dark mode",
              click: () => app.emit("toggleDarkMode")
            }
          ]
        }
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Report an issue",
          click() {
            openWindowFromURL("https://forms.office.com/r/8tbTBHL4bv")
          }
        },
        {
          label: "Contact us",
          click() {
            openWindowFromURL("https://forms.office.com/r/Zr8xJbQs64")
          }
        },
        {
          label: "Join Us on Discord !",
          click() {
            openWindowFromURL("https://discord.gg/ZbaGj8E6mP")
          }
        },
        {
          label: "Documentation",
          click() {
            openWindowFromURL("https://medomics-udes.gitbook.io/medomics-docs")
          }
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forcereload" },
        { role: "toggledevtools" },
        { type: "separator" },
        { role: "resetzoom" },
        { role: "zoomin" },
        { role: "zoomout" },
        { type: "separator" }
      ]
    }
  ]

  console.log("running mode:", isProd ? "production" : "development")
  console.log("process.resourcesPath: ", process.resourcesPath)
  console.log(MEDconfig.runServerAutomatically ? "Server will start automatically here (in background of the application)" : "Server must be started manually")
  let bundledPythonPath = getBundledPythonEnvironment()
  // The user-defined python path (condaPath in settings.json) takes precedence over the bundled python
  let resolvedPythonPath = bundledPythonPath
  try {
    const settingsFilePath = path.join(app.getPath("userData"), "settings.json")
    if (fs.existsSync(settingsFilePath)) {
      const savedSettings = JSON.parse(fs.readFileSync(settingsFilePath, "utf8"))
      if (savedSettings.condaPath) {
        resolvedPythonPath = savedSettings.condaPath
      }
    }
  } catch (error) {
    console.warn("Could not read settings.json to resolve the python path: ", error)
  }
  console.log("Python path passed to the server: ", resolvedPythonPath)
  if (MEDconfig.runServerAutomatically) {
    // Start the Go server – Python path is optional (passed if available)
    runServer(isProd, serverPort, serverProcess, serverState, resolvedPythonPath)
      .then((process) => {
        serverProcess = process
        console.log("Server process started: ", serverProcess)
      })
      .catch((err) => {
        console.error("Failed to start server: ", err)
      })
  } else {
    //**** NO SERVER ****//
    findAvailablePort(MEDconfig.defaultPort)
      .then((port) => {
        serverPort = port
      })
      .catch((err) => {
        console.error(err)
      })
  }
  const menu = Menu.buildFromTemplate(menuTemplate)
  Menu.setApplicationMenu(menu)

  ipcMain.on("getRecentWorkspaces", (event, data) => {
    // Receives a message from Next.js
    console.log("GetRecentWorkspaces : ", data)
    if (data === "requestRecentWorkspaces") {
      // If the message is "requestRecentWorkspaces", the function getRecentWorkspaces is called
      getRecentWorkspacesOptions(event, mainWindow, hasBeenSet, serverPort)
    }
  })

  ipcMain.handle("updateWorkspace", async (event, data) => {
    // Receives a message from Next.js to update workspace
    console.error("updateWorkspace : ", data)
    console.error("updateWorkspace event : ", event)
    updateWorkspace(data)
  })

  ipcMain.handle("setWorkingDirectory", async (event, data) => {
    app.setPath("sessionData", data)
    createWorkingDirectory() // Create DATA & EXPERIMENTS directories
    console.log(`setWorkingDirectory : ${data}`)
    createMedomicsDirectory(data)
    hasBeenSet = true
    try {
      // Stop MongoDB if it's running
      await stopMongoDB(mongoProcess)
      if (process.platform === "win32") {
        // Kill the process on the port
        // killProcessOnPort(serverPort)
      } else if (process.platform === "darwin") {
        await new Promise((resolve) => {
          exec("pkill -f mongod", (error, stdout, stderr) => {
            resolve()
          })
        })
      } else {
        try {
          execSync("killall mongod")
        } catch (error) {
          console.warn("Failed to kill mongod: ", error)
        }
      }
      // Start MongoDB with the new configuration and WAIT for it to be
      // reachable. Returning before that let the renderer start recensing the
      // workspace against a database that was not listening yet.
      const mongoStatus = await startMongoDB(data)
      if (!mongoStatus.started) {
        // Not fatal — the workspace is still usable for everything that does not
        // touch the database — but it must be visible, because every consumer
        // swallows the failure (loadMEDDataObjects returns {} on error, so the
        // workspace merely looks empty).
        notifyMongoUnavailable(mongoStatus)
      }
      return {
        workingDirectory: dirTree(app.getPath("sessionData")),
        hasBeenSet: hasBeenSet,
        newPort: serverPort,
        mongoStarted: mongoStatus.started
      }
    } catch (error) {
      console.error("Failed to change workspace: ", error)
    }
  })

  /**
   * @description Bring MongoDB back up for the current workspace, on demand.
   *
   * The renderer calls this when a query fails: rather than every caller
   * guessing, there is one owner of the process. Returns the same status object
   * as startMongoDB.
   */
  ipcMain.handle("ensureMongoRunning", async () => {
    const workspacePath = app.getPath("sessionData")
    if (!workspacePath || !hasBeenSet) {
      return { started: false, error: "No workspace has been opened yet." }
    }
    const status = await startMongoDB(workspacePath)
    if (!status.started) notifyMongoUnavailable(status)
    return status
  })

  /**
   * @description Returns the path of the specified directory of the app
   * @param {String} path The path to get
   * @returns {Promise<String>} The path of the specified directory of the app
   */
  ipcMain.handle("appGetPath", async (_event, path) => {
    return app.getPath(path)
  })

  /**
   * @description Returns the version of the app
   * @returns {Promise<String>} The version of the app
   */
  ipcMain.handle("getAppVersion", async () => {
    return app.getVersion()
  })

  /**
   * @description Copies the source file to the destination file set by the user in the dialog
   * @param {String} source The source file to copy
   * @param {String} defaultPath The default path to set in the dialog - If null, the default path will be the user's home directory
   * @returns {Promise<String>} The destination file
   */
  ipcMain.handle("appCopyFile", async (_event, source) => {
    // Get the filename from the source path
    let filename = path.basename(source)
    let extension = path.extname(source).slice(1)
    console.log("extension", extension)
    const { filePath } = await dialog.showSaveDialog({
      title: "Save file",
      defaultPath: filename.length > 0 ? filename : source,
      filters: [{ name: extension, extensions: [extension] }]
    })
    if (filePath) {
      fs.copyFileSync(source, filePath)
      return filePath
    }
  })

  /**
   * @description select path to folder
   * @returns {String} path to the selected folder
   */
  ipcMain.handle("select-folder-path", async (event) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"]
    })
    return result
  })

  /**
   * @description Select one or more CSV files and copy them into the workspace DATA folder.
   *              The renderer then re-scans the workspace so the datasets show up in MongoDB.
   * @returns {Array<String>} the destination paths of the copied files (empty if cancelled)
   */
  ipcMain.handle("import-csv-files", async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: "Select the dataset(s) to import",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "CSV files", extensions: ["csv"] }]
    })
    if (canceled || !filePaths || filePaths.length === 0) return []
    const dataDir = path.join(app.getPath("sessionData"), "DATA")
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
    const copied = []
    for (const source of filePaths) {
      const destination = path.join(dataDir, path.basename(source))
      fs.copyFileSync(source, destination)
      copied.push(destination)
    }
    console.log("Imported CSV files: ", copied)
    return copied
  })

  /**
   * @description Select a model file trained outside of the app to import
   * @returns {String|null} path to the selected file, or null if cancelled
   */
  ipcMain.handle("select-model-file", async (event) => {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "Select a model file",
      properties: ["openFile"],
      filters: [
        { name: "Model files", extensions: ["pkl", "pickle", "joblib", "onnx"] },
        { name: "All files", extensions: ["*"] }
      ]
    })
    return filePaths && filePaths.length > 0 ? filePaths[0] : null
  })

  /**
   * @description Returns the settings
   * @returns {Object} The settings
   * @summary Returns the settings from the settings file if it exists, otherwise returns an empty object
   */
  ipcMain.handle("get-settings", async () => {
    const userDataPath = app.getPath("userData")
    const settingsFilePath = path.join(userDataPath, "settings.json")
    if (fs.existsSync(settingsFilePath)) {
      const settings = JSON.parse(fs.readFileSync(settingsFilePath, "utf8"))
      return settings
    } else {
      return {}
    }
  })

  /**
   * @description Saves the settings
   * @param {*} event The event
   * @param {*} settings The settings to save
   */
  ipcMain.on("save-settings", async (_event, settings) => {
    const userDataPath = app.getPath("userData")
    const settingsFilePath = path.join(userDataPath, "settings.json")
    console.log("settings to save : ", settingsFilePath, settings)
    fs.writeFileSync(settingsFilePath, JSON.stringify(settings))
  })

  /**
   * @description Returns the server status
   * @returns {Boolean} True if the server is running, false otherwise
   */
  ipcMain.handle("server-is-running", async () => {
    return serverState.serverIsRunning
  })

  /**
   * @description Kills the server
   * @returns {Boolean} True if the server was killed successfully, false otherwise
   * @summary Kills the server if it is running
   */
  ipcMain.handle("kill-server", async () => {
    if (serverProcess) {
      let success = await serverProcess.kill()
      serverState.serverIsRunning = false
      return success
    } else {
      return null
    }
  })

  /**
   * @description Starts the server
   * @param {*} event The event
   * @param {*} pythonPath The path to the python executable (optional) - If null, the default python executable will be used (see environment variables MED_ENV)
   * @returns {Boolean} True if the server is running, false otherwise
   */
  ipcMain.handle("start-server", async (_event, pythonPath = null) => {
    if (serverProcess) {
      // kill the server if it is already running
      serverProcess.kill()
    }
    console.log("Received Python path: ", pythonPath)
    if (MEDconfig.runServerAutomatically) {
      runServer(isProd, serverPort, serverProcess, serverState, pythonPath)
        .then((process) => {
          serverProcess = process
          console.log(`success: ${serverState.serverIsRunning}`)
          return serverState.serverIsRunning
        })
        .catch((err) => {
          console.error("Failed to start server: ", err)
          serverState.serverIsRunning = false
          return false
        })
    }
    return serverState.serverIsRunning
  })

  /**
   * @description Opens the dialog to select the python executable path and returns the path to Next.js
   * @param {*} event
   * @param {*} data
   * @returns {String} The path to the python executable
   */
  ipcMain.handle("open-dialog-exe", async (event, data) => {
    if (process.platform !== "win32") {
      const { filePaths } = await dialog.showOpenDialog({
        title: "Select the path to the python executable",
        properties: ["openFile"],
        filters: [{ name: "Python Executable", extensions: ["*"] }]
      })
      return filePaths[0]
    } else {
      const { filePaths } = await dialog.showOpenDialog({
        title: "Select the path to the python executable",
        properties: ["openFile"],
        filters: [{ name: "Executable", extensions: ["exe"] }]
      })
      return filePaths[0]
    }
  })

  ipcMain.on("messageFromNext", (event, data, args) => {
    // Receives a message from Next.js
    console.log("messageFromNext : ", data)
    if (data === "requestDialogFolder") {
      // If the message is "requestDialogFolder", the function setWorkingDirectory is called
      setWorkingDirectory(event, mainWindow)
    } else if (data === "getRecentWorkspaces") {
      let recentWorkspaces = loadWorkspaces()
      event.reply("recentWorkspaces", recentWorkspaces)
    } else if (data === "updateWorkingDirectory") {
      // dirTree walks the workspace synchronously and can throw on a path this
      // app does not control. An ipcMain listener has no caller to catch that,
      // so the throw reached Electron's uncaught handler and took the whole app
      // down -- which is what importing a base model triggers, since the import
      // ends by asking for exactly this refresh.
      try {
        event.reply("updateDirectory", {
          workingDirectory: dirTree(app.getPath("sessionData")),
          hasBeenSet: hasBeenSet,
          newPort: serverPort
        }) // Sends the folder structure to Next.js
      } catch (error) {
        console.error("Failed to read the working directory: ", error)
        sendStatusToWindow(`Could not read the workspace folder: ${error.message}`)
      }
    } else if (data === "getServerPort") {
      event.reply("getServerPort", {
        newPort: serverPort
      }) // Sends the folder structure to Next.js
    } else if (data === "requestAppExit") {
      app.exit()
    }
  })

  app.on("toggleDarkMode", () => {
    console.log("toggleDarkMode")
    mainWindow.webContents.send("toggleDarkMode")
  })

  if (isProd) {
    await mainWindow.loadURL("app://./index.html")
  } else {
    const port = process.argv[2]
    await mainWindow.loadURL(`http://localhost:${port}/`)
    mainWindow.webContents.openDevTools()
  }

  splashScreen.destroy()
  mainWindow.maximize()
  mainWindow.show()
})()

ipcMain.handle("request", async (_, axios_request) => {
  const result = await axios(axios_request)
  return { data: result.data, status: result.status }
})

// Python environment handling
ipcMain.handle("getInstalledPythonPackages", async (event, pythonPath) => {
  return getInstalledPythonPackages(pythonPath)
})

ipcMain.handle("installMongoDB", async (event) => {
  // Check if MongoDB is installed
  let mongoDBInstalled = getMongoDBPath()
  if (mongoDBInstalled === null) {
    // If MongoDB is not installed, install it
    return installMongoDB()
  } else {
    return true
  }
})

ipcMain.handle("getBundledPythonEnvironment", async (event) => {
  return getBundledPythonEnvironment()
})

ipcMain.handle("installBundledPythonExecutable", async (event) => {
  // Any throw here would surface in the renderer as an unhandled rejection, and
  // the setup modal has no catch: report failure as `false` instead.
  try {
    // Check if Python is installed
    let pythonInstalled = getBundledPythonEnvironment()
    if (pythonInstalled === null) {
      // If Python is not installed, install it
      return await installBundledPythonExecutable(mainWindow)
    }
    // Check if the required packages are installed
    if (checkPythonRequirements()) {
      return true
    }
    await installRequiredPythonPackages(mainWindow, pythonInstalled)
    return true
  } catch (error) {
    console.error("Python setup failed: ", error)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("notification", { id: "Python Installation", message: error.message, header: "Python Installation Error" })
    }
    return false
  }
})

ipcMain.handle("checkRequirements", async (event) => {
  return checkRequirements()
})

ipcMain.handle("checkPythonRequirements", async (event) => {
  return checkPythonRequirements()
})

ipcMain.handle("checkMongoDBisInstalled", async (event) => {
  return getMongoDBPath()
})

ipcMain.on("restartApp", (event, data, args) => {
  app.relaunch()
  app.quit()
})

ipcMain.handle("checkMongoIsRunning", async (event) => {
  // Check if something is running on the port MEDconfig.mongoPort
  let port = MEDconfig.mongoPort
  let isRunning = false
  if (process.platform === "win32") {
    isRunning = exec(`netstat -ano | findstr :${port}`).toString().trim() !== ""
  } else if (process.platform === "darwin") {
    isRunning = exec(`lsof -i :${port}`).toString().trim() !== ""
  } else {
    isRunning = exec(`netstat -tuln | grep ${port}`).toString().trim() !== ""
  }

  return isRunning
})

let isQuitting = false

app.on("before-quit", async (event) => {
  if (isQuitting) return // Already handling quit
  
  event.preventDefault()
  isQuitting = true
  
  console.log("App quitting — cleaning up services...")
  
  // Stop MongoDB
  try {
    await stopMongoDB(mongoProcess)
  } catch (error) {
    console.warn("Error stopping MongoDB:", error)
  }
  
  // Stop the server
  if (MEDconfig.runServerAutomatically) {
    try {
      serverProcess.kill()
      console.log("serverProcess killed")
    } catch (error) {
      console.log("serverProcess already killed")
    }
  }
  
  console.log("Cleanup complete, quitting app")
  app.quit()
})

app.on("window-all-closed", () => {
  // On macOS, apps typically stay open until Cmd+Q.
  // On other platforms, close all windows to quit.
  if (process.platform !== "darwin") {
    app.quit()
  } else {
    app.quit()
  }
})

app.on("ready", async () => {
  // React DevTools are a development-only convenience, so the installer is a
  // devDependency and is required lazily: production builds prune it, and a
  // missing module must never take the app down at startup.
  if (MEDconfig.useReactDevTools) {
    try {
      const { installExtension, REACT_DEVELOPER_TOOLS } = require("electron-extension-installer")
      await installExtension(REACT_DEVELOPER_TOOLS, {
        loadExtensionOptions: {
          allowFileAccess: true
        }
      })
    } catch (error) {
      console.warn("Could not install React DevTools (set useReactDevTools to false to skip): ", error)
    }
  }
  autoUpdater.checkForUpdatesAndNotify()
})

// Handle theme toggle
ipcMain.handle("toggle-theme", (event, theme) => {
  if (theme === "dark") {
    nativeTheme.themeSource = "dark"
  } else if (theme === "light") {
    nativeTheme.themeSource = "light"
  } else {
    nativeTheme.themeSource = "system"
  }
  return nativeTheme.shouldUseDarkColors
})

ipcMain.handle("get-theme", () => {
  return nativeTheme.themeSource // Return the themeSource instead of shouldUseDarkColors
})

// Forward nativeTheme updated event to renderer
nativeTheme.on("updated", () => {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send("theme-updated")
  }
})

/**
 * @description Open a new window from an URL
 * @param {*} url The URL of the page to open
 * @returns {BrowserWindow} The new window
 */
function openWindowFromURL(url) {
  let window = new BrowserWindow({
    icon: path.join(__dirname, "../resources/MED3paLogo.png"),
    width: 700,
    height: 700,
    transparent: true,
    center: true
  })

  window.loadURL(url)
  window.once("ready-to-show", () => {
    window.show()
    window.focus()
  })
}

// Function to start MongoDB
/**
 * @description Tell the renderer MongoDB is unreachable, with the reason.
 * @param {{error?: String, details?: String}} status from startMongoDB
 */
function notifyMongoUnavailable(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("mongoUnavailable", {
      message: status.error || "MongoDB is not reachable.",
      details: status.details || ""
    })
  }
}

/**
 * @description Resolves once something accepts a TCP connection on the port.
 *
 * Spawning mongod returns immediately, but it needs anywhere from a few hundred
 * milliseconds to several seconds to bind — longer on a fresh dbPath, which it
 * has to initialise first. Anything that talked to the database in that window
 * got ECONNREFUSED.
 * @param {Number} port
 * @param {Number} timeoutMs give up after this long
 * @returns {Promise<void>} resolves when the port accepts a connection
 */
function waitForPort(port, timeoutMs = 30000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port: port, host: "127.0.0.1" })
      const done = (fn, arg) => {
        socket.removeAllListeners()
        socket.destroy()
        fn(arg)
      }
      socket.once("connect", () => done(resolve))
      socket.once("error", () => {
        socket.removeAllListeners()
        socket.destroy()
        if (Date.now() >= deadline) {
          reject(new Error(`Nothing accepted a connection on port ${port} within ${Math.round(timeoutMs / 1000)}s`))
        } else {
          setTimeout(attempt, intervalMs)
        }
      })
    }
    attempt()
  })
}

/**
 * @description Last lines of the workspace's mongod.log.
 *
 * mongod writes startup failures (a stale lock, an unwritable dbPath, a port
 * already taken) to its log file and not to stderr, so without this the process
 * just exits and the reason is invisible.
 * @param {String} workspacePath
 * @returns {String} the tail of the log, or "" if unreadable
 */
function readMongoLogTail(workspacePath, lines = 15) {
  try {
    const logPath = path.join(workspacePath, ".med3pa", "mongod.log")
    if (!fs.existsSync(logPath)) return ""
    return fs.readFileSync(logPath, "utf8").trim().split("\n").slice(-lines).join("\n")
  } catch (error) {
    return ""
  }
}

/**
 * @description Start the workspace's MongoDB and wait until it is actually reachable.
 *
 * Returns a status object rather than throwing, so callers can surface the
 * reason. Concurrent calls share one attempt via `mongoStarting`: this is the
 * single owner of the mongod process, which matters because a mongod spawned
 * anywhere else is not tracked in `mongoProcess`, is never stopped on quit, and
 * keeps the dbPath lock — after which the next launch cannot start at all.
 * @param {String} workspacePath
 * @returns {Promise<{started: Boolean, error?: String, details?: String}>}
 */
function startMongoDB(workspacePath) {
  if (mongoStarting) return mongoStarting

  mongoStarting = (async () => {
    const mongoConfigPath = path.join(workspacePath, ".med3pa", "mongod.conf") // see APP_WORKSPACE_DIR in main/utils/workspace.js
    if (!fs.existsSync(mongoConfigPath)) {
      const error = `MongoDB config file does not exist: ${mongoConfigPath}`
      console.error(error)
      return { started: false, error: error }
    }

    // Already up (a previous run, or another owner): nothing to do.
    try {
      await waitForPort(MEDconfig.mongoPort, 1000, 200)
      console.log(`MongoDB already listening on port ${MEDconfig.mongoPort}`)
      return { started: true }
    } catch (notRunning) {
      // expected — carry on and start it
    }

    const mongod = getMongoDBPath()
    if (!mongod) {
      // spawn(null, ...) throws an opaque ERR_INVALID_ARG_TYPE; say what is wrong.
      const error = "Could not find a mongod executable. Install MongoDB, or use System > Run first-time setup."
      console.error(error)
      return { started: false, error: error }
    }

    console.log("Starting MongoDB with config: " + mongoConfigPath)
    let output = ""
    try {
      if (process.platform !== "darwin") {
        mongoProcess = spawn(mongod, ["--config", mongoConfigPath, "--port", MEDconfig.mongoPort])
      } else if (fs.existsSync(mongod)) {
        mongoProcess = spawn(mongod, ["--config", mongoConfigPath])
      } else {
        mongoProcess = spawn("/opt/homebrew/Cellar/mongodb-community/7.0.12/bin/mongod", ["--config", mongoConfigPath], { shell: true })
      }
    } catch (error) {
      console.error("Failed to spawn MongoDB: ", error)
      return { started: false, error: `Could not start MongoDB: ${error.message}` }
    }

    mongoProcess.stdout.on("data", (data) => {
      output += data
      console.log(`MongoDB stdout: ${data}`)
    })
    mongoProcess.stderr.on("data", (data) => {
      output += data
      console.error(`MongoDB stderr: ${data}`)
    })
    mongoProcess.on("close", (code) => {
      console.log(`MongoDB process exited with code ${code}`)
    })

    // Race readiness against the process dying, so a mongod that exits on
    // startup reports immediately rather than waiting out the full timeout.
    const exited = new Promise((resolve) => {
      mongoProcess.once("close", (code) => resolve(`mongod exited with code ${code}`))
      mongoProcess.once("error", (error) => resolve(`mongod could not be started: ${error.message}`))
    })

    try {
      const outcome = await Promise.race([waitForPort(MEDconfig.mongoPort).then(() => null), exited])
      if (outcome !== null) throw new Error(outcome)
      console.log(`MongoDB is accepting connections on port ${MEDconfig.mongoPort}`)
      return { started: true }
    } catch (error) {
      const details = [output.trim(), readMongoLogTail(workspacePath)].filter((part) => part !== "").join("\n")
      console.error("MongoDB did not become reachable: ", error.message, details)
      return { started: false, error: error.message, details: details }
    }
  })()

  return mongoStarting.finally(() => {
    mongoStarting = null
  })
}

// Function to stop MongoDB
async function stopMongoDB(mongoProcess) {
  return new Promise((resolve, reject) => {
    if (mongoProcess) {
      mongoProcess.on("exit", () => {
        mongoProcess = null
        resolve()
      })
      try {
        mongoProcess.kill()
        resolve()
      } catch (error) {
        console.log("Error while stopping MongoDB ", error)
        // reject()
      }
    } else {
      resolve()
    }
  })
}

export function getMongoDBPath() {
  if (process.platform === "win32") {
    // Check if mongod is in the process.env.PATH
    const paths = process.env.PATH.split(path.delimiter)
    for (let i = 0; i < paths.length; i++) {
      const binPath = path.join(paths[i], "mongod.exe")
      if (fs.existsSync(binPath)) {
        console.log("mongod found in PATH")
        return binPath
      }
    }
    // Check if mongod is in the default installation path on Windows - C:\Program Files\MongoDB\Server\<version to establish>\bin\mongod.exe
    const programFilesPath = process.env["ProgramFiles"]
    if (programFilesPath) {
      const mongoPath = path.join(programFilesPath, "MongoDB", "Server")
      // Check if the MongoDB directory exists
      if (!fs.existsSync(mongoPath)) {
        console.error("MongoDB directory not found")
        return null
      }
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
    // Check if it is installed in the .medomics directory
    const binPath = path.join(process.env.HOME, ".medomics", "mongodb", "bin", "mongod")
    if (fs.existsSync(binPath)) {
      console.log("mongod found in .medomics directory")
      return binPath
    }
    if (process.env.NODE_ENV !== "production") {
      // Check if mongod is in the process.env.PATH
      const paths = process.env.PATH.split(path.delimiter)
      for (let i = 0; i < paths.length; i++) {
        const binPath = path.join(paths[i], "mongod")
        if (fs.existsSync(binPath)) {
          console.log("mongod found in PATH")
          return binPath
        }
      }
      // Check if mongod is in the default installation path on macOS - /usr/local/bin/mongod
      const binPath = "/usr/local/bin/mongod"
      if (fs.existsSync(binPath)) {
        return binPath
      }
    }
    console.error("mongod not found")
    return null
  } else if (process.platform === "linux") {
    // Check if mongod is in the process.env.PATH
    const paths = process.env.PATH.split(path.delimiter)
    for (let i = 0; i < paths.length; i++) {
      console.log(`Checking for mongod in: index ${i}, path ${paths[i]}`)
      const binPath = path.join(paths[i], "mongod")
      console.log(`Checking if mongod exists at: ${binPath}`)
      if (fs.existsSync(binPath)) {
        return binPath
      }
    }
    console.error("mongod not found in PATH" + paths)
    // Check if mongod is in the default installation path on Linux - /usr/bin/mongod
    if (fs.existsSync("/usr/bin/mongod")) {
      return "/usr/bin/mongod"
    }

    // Check the tarball install location used by after-install.sh
    if (fs.existsSync("/usr/local/bin/mongod")) {
      return "/usr/local/bin/mongod"
    }

    if (fs.existsSync("/usr/local/lib/mongodb/bin/mongod")) {
      return "/usr/local/lib/mongodb/bin/mongod"
    }

    if (fs.existsSync(process.env.HOME + "/.medomics/mongodb/bin/mongod")) {
      return process.env.HOME + "/.medomics/mongodb/bin/mongod"
    }
    return null
  } else {
    return "mongod"
  }
}
