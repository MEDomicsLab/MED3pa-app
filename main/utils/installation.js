import { app } from "electron"
import { execCallbacksForChildWithNotifications } from "../utils/pythonEnv"
import { mainWindow, getMongoDBPath } from "../background"
import { getBundledPythonEnvironment } from "../utils/pythonEnv"
import fs from "fs"

//**** LOG ****// This is used to send the console.log messages to the main window
const originalConsoleLog = console.log
/**
 * @description Sends the console.log messages to the main window
 * @param {*} message The message to send
 * @summary We redefine the console.log function to send the messages to the main window
 */
console.log = function () {
  try {
    originalConsoleLog(...arguments)
    if (mainWindow !== undefined) {
      mainWindow.webContents.send("log", ...arguments)
    }
  } catch (error) {
    console.error(error)
  }
}


export const checkIsBrewInstalled = async () => {
  let isBrewInstalled = false
  try {
    let { stdout, stderr } = await exec(`brew --version`)
    isBrewInstalled = stdout !== "" && stderr === ""
  } catch (error) {
    isBrewInstalled = false
  }
  return isBrewInstalled
}

export const checkIsXcodeSelectInstalled = async () => {
  let isXcodeSelectInstalled = false
  try {
    let { stdout, stderr } = await exec(`xcode-select -p`)
    isXcodeSelectInstalled = stdout !== "" && stderr === ""
  } catch (error) {
    isXcodeSelectInstalled = false
  }
}

export const installBrew = async () => {
  let installBrewPromise = exec(`/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`)
  execCallbacksForChildWithNotifications(installBrewPromise.child, "Installing Homebrew", mainWindow)
  await installBrewPromise
  return true
}

export const installXcodeSelect = async () => {
  let installXcodeSelectPromise = exec(`xcode-select --install`)
  execCallbacksForChildWithNotifications(installXcodeSelectPromise.child, "Installing Xcode Command Line Tools", mainWindow)
  await installXcodeSelectPromise
  return true
}


var path = require("path")
const util = require("util")
const exec = util.promisify(require("child_process").exec)

// Downloads and tar output overflow exec's 1 MB default buffer, which kills the
// child part-way through.
const EXEC_OPTIONS = { maxBuffer: 256 * 1024 * 1024 }

export const checkRequirements = async () => {
  // Check if .medomics directory exists
  let medomicsDirExists = fs.existsSync(path.join(app.getPath("home"), ".medomics"))
  if (!medomicsDirExists) {
    fs.mkdirSync(path.join(app.getPath("home"), ".medomics"))
  }
  let mongoDBInstalled = getMongoDBPath()
  let pythonInstalled = getBundledPythonEnvironment()

  console.log("MongoDB installed: " + mongoDBInstalled)
  console.log("Python installed: " + pythonInstalled)
  return { pythonInstalled: pythonInstalled, mongoDBInstalled: mongoDBInstalled }
}

export const installMongoDB = async () => {
  if (process.platform === "win32") {
    // Download MongoDB installer
    const downloadUrl = "https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-7.0.12-signed.msi"
    // The download folder is quoted throughout: it sits under the user profile,
    // which routinely contains a space.
    const downloadDir = app.getPath("downloads")
    fs.mkdirSync(downloadDir, { recursive: true })
    const downloadPath = path.join(downloadDir, "mongodb-windows-x86_64-7.0.12-signed.msi")
    // -f so an HTTP error is a failed download rather than an error page saved
    // under the .msi name.
    let downloadMongoDBPromise = exec(`curl -fsSL --retry 3 --retry-delay 2 -o "${downloadPath}" "${downloadUrl}"`, EXEC_OPTIONS)
    execCallbacksForChildWithNotifications(downloadMongoDBPromise.child, "Downloading MongoDB installer", mainWindow)
    await downloadMongoDBPromise
    // Install MongoDB
    // msiexec.exe /l*v mdbinstall.log /qb /i mongodb-windows-x86_64-7.0.12-signed.msi ADDLOCAL="ServerNoService" SHOULD_INSTALL_COMPASS="0"
    let installMongoDBPromise = exec(`msiexec.exe /l*v mdbinstall.log /qb /i "${downloadPath}" ADDLOCAL="ServerNoService" SHOULD_INSTALL_COMPASS="0"`, EXEC_OPTIONS)
    execCallbacksForChildWithNotifications(installMongoDBPromise.child, "Installing MongoDB", mainWindow)
    await installMongoDBPromise

    fs.rmSync(downloadPath, { force: true })
    mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.webContents.send("notification", {
        id: "Removing MongoDB installer",
        message: "Removing MongoDB installer exited with code 0",
        header: "Removing MongoDB installer Finished"
      })

    return getMongoDBPath() !== null
  } else if (process.platform === "darwin") {
    // The official tarball is used instead of Homebrew. getMongoDBPath() only
    // ever looks in ~/.medomics/mongodb on macOS, so a brew install could never
    // be detected and the first-setup modal waited on it forever. Homebrew also
    // has to be present, prompts for a sudo password no one can type from here,
    // and the formula that was requested (mongodb-community@7.0.12) does not
    // exist — the tap only publishes major.minor formulas.
    const medomicsPath = path.join(process.env.HOME, ".medomics")
    const mongoPath = path.join(medomicsPath, "mongodb")
    const architecture = process.arch === "arm64" ? "arm64" : "x86_64"
    const mongoDBVersion = "8.0.9"
    const archiveName = `mongodb-macos-${architecture}-${mongoDBVersion}.tgz`
    const archivePath = path.join(medomicsPath, archiveName)
    const downloadUrl = `https://fastdl.mongodb.org/osx/${archiveName}`

    try {
      fs.mkdirSync(medomicsPath, { recursive: true })
      if (fs.existsSync(archivePath)) {
        fs.rmSync(archivePath, { force: true })
      }

      let downloadMongoDBPromise = exec(`curl -fsSL --retry 3 --retry-delay 2 -o "${archivePath}" "${downloadUrl}"`, EXEC_OPTIONS)
      execCallbacksForChildWithNotifications(downloadMongoDBPromise.child, "Downloading MongoDB", mainWindow)
      await downloadMongoDBPromise

      // --strip-components=1 drops the archive's own top-level folder so the
      // tree lands directly in ~/.medomics/mongodb, which is the only place
      // getMongoDBPath() looks. Its name cannot be predicted from the URL
      // anyway: the arm64 download unpacks to a "mongodb-macos-aarch64-*" dir.
      fs.rmSync(mongoPath, { recursive: true, force: true })
      fs.mkdirSync(mongoPath, { recursive: true })
      let installMongoDBPromise = exec(`tar -xzf "${archivePath}" --strip-components=1 -C "${mongoPath}"`, EXEC_OPTIONS)
      execCallbacksForChildWithNotifications(installMongoDBPromise.child, "Installing MongoDB", mainWindow)
      await installMongoDBPromise

      fs.rmSync(archivePath, { force: true })

      let removed = { id: "Removing MongoDB installer", header: "Removing MongoDB installer Finished" }
      mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send("notification", { ...removed, message: "Removing MongoDB installer exited with code 0" })
    } catch (error) {
      console.error("MongoDB installation failed: ", error)
      mainWindow &&
        !mainWindow.isDestroyed() &&
        mainWindow.webContents.send("notification", { id: "MongoDB Installation", message: error.message, header: "MongoDB Installation Error" })
      return false
    }

    return getMongoDBPath() !== null
  } else if (process.platform === "linux") {
    const linuxURLDict = {
      "Ubuntu 24.04 x86_64": "https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2404-8.0.9.tgz",
      "Ubuntu 20.04 x86_64": "https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2004-7.0.15.tgz",
      "Ubuntu 22.04 x86_64": "https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2204-7.0.15.tgz",
      "Ubuntu 20.04 aarch64": "https://fastdl.mongodb.org/linux/mongodb-linux-aarch64-ubuntu2004-7.0.15.tgz",
      "Ubuntu 22.04 aarch64": "https://fastdl.mongodb.org/linux/mongodb-linux-aarch64-ubuntu2204-7.0.15.tgz",
      "Debian 10 x86_64": "https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-debian10-7.0.15.tgz",
      "Debian 11 x86_64": "https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-debian11-7.0.15.tgz",
    }
    // Check if MongoDB is installed
    if (getMongoDBPath() !== null) {
      return true
    }
    // Check which Linux distribution is being used
    let { stdout, stderr } = await exec(`cat /etc/os-release`)
    let osRelease = stdout
    let isUbuntu = osRelease.includes("Ubuntu")
    if (!isUbuntu) {
      return false
    } else {
      // osRelease is a string with the contents of /etc/os-release
      // Get the version of Ubuntu
      let ubuntuVersion = osRelease.match(/VERSION_ID="(.*)"/)[1]
      // Get the architecture of the system
      let architecture = "x86_64"
      if (process.arch === "arm64") {
        architecture = "aarch64"
      }
      // Get the download URL
      let downloadUrl = linuxURLDict[`Ubuntu ${ubuntuVersion} ${architecture}`]
      // Download MongoDB installer
      let mongoDBVersion = "7.0.15"
      if (ubuntuVersion === "24.04") {
        mongoDBVersion = "8.0.9"
      }
      if (!downloadUrl) {
        console.error(`No MongoDB build is published for Ubuntu ${ubuntuVersion} ${architecture}`)
        return false
      }
      const medomicsPath = path.join(process.env.HOME, ".medomics")
      fs.mkdirSync(medomicsPath, { recursive: true })
      const downloadPath = path.join(medomicsPath, `mongodb-linux-${architecture}-ubuntu${ubuntuVersion}-${mongoDBVersion}.tgz`)
      let downloadMongoDBPromise = exec(`curl -fsSL --retry 3 --retry-delay 2 -o "${downloadPath}" "${downloadUrl}"`, EXEC_OPTIONS)
      execCallbacksForChildWithNotifications(downloadMongoDBPromise.child, "Downloading MongoDB installer", mainWindow)
      await downloadMongoDBPromise
      // Install MongoDB in the .medomics directory in the user's home directory.
      // --strip-components=1 unpacks straight into ~/.medomics/mongodb, so the
      // archive's top-level folder name never has to be reconstructed, and a
      // leftover tree from a previous attempt cannot end up nested inside the
      // new one.
      const mongoPath = path.join(medomicsPath, "mongodb")
      fs.rmSync(mongoPath, { recursive: true, force: true })
      fs.mkdirSync(mongoPath, { recursive: true })
      let installMongoDBPromise = exec(`tar -xzf "${downloadPath}" --strip-components=1 -C "${mongoPath}"`, EXEC_OPTIONS)
      execCallbacksForChildWithNotifications(installMongoDBPromise.child, "Installing MongoDB", mainWindow)
      await installMongoDBPromise

      fs.rmSync(downloadPath, { force: true })

      return getMongoDBPath() !== null
    }
  }
}
