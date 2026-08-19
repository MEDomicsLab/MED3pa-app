import { app, dialog } from "electron"
const fs = require("fs")
var path = require("path")
const { join } = require("path")
const { readdir, stat, rm } = require("fs/promises")
const util = require("util")
const { execSync } = require("child_process")
const exec = util.promisify(require("child_process").exec)

// Bundled CPython, taken from one python-build-standalone release so every
// platform lands on the same interpreter.
//
// 3.12 is a hard floor, not a preference: MED3pa uses typing.Self (PEP 673,
// 3.11+) and PEP 604 `X | Y` unions evaluated at def time (3.10+), and it pins
// checkpointer behind a `python_version >= "3.12"` marker. macOS and Linux used
// to bundle 3.9.18, which could not import the library at all.
const PYTHON_VERSION = "3.12.13"
const PYTHON_BUILD_TAG = "20260623"
const PYTHON_BUILD_BASE = `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_BUILD_TAG}`

/**
 * @description Filename of the standalone CPython build for a platform triple
 * @param {String} triple e.g. "x86_64-pc-windows-msvc"
 * @returns {String} the release asset filename
 */
function pythonBuildFile(triple) {
  return `cpython-${PYTHON_VERSION}+${PYTHON_BUILD_TAG}-${triple}-install_only.tar.gz`
}

/**
 * Recursively calculates the size of a directory in bytes.
 * @param {string} dir - The directory path.
 * @returns {Promise<number>} The total size in bytes.
 */
async function getDirectorySize(dir) {
    const files = await readdir(dir, { withFileTypes: true })

    const paths = files.map(async file => {
        const path = join(dir, file.name)
        if (file.isDirectory()) {
            // Recurse into subdirectories
            return await getDirectorySize(path)
        } else if (file.isFile()) {
            // Get size of files
            const { size } = await stat(path)
            return size
        }
        return 0
    })

    // Await all paths, flatten the array of sizes (due to recursion), and sum them up
    const sizes = await Promise.all(paths)
    return sizes.flat(Infinity).reduce((accumulator, size) => accumulator + size, 0)
}

/**
 * Checks a directory's size and deletes it if it is empty.
 * @param {string} directoryPath - The path to the directory to check and potentially delete.
 */
async function checkSizeAndDeleteIfZero(directoryPath) {
    try {
        const size = await getDirectorySize(directoryPath)
        console.log(`Directory size is: ${size} bytes`)

        if (size === 0) {
            console.log(`Directory is empty. Deleting...`)
            // The { recursive: true } option allows deleting a directory and its contents (even if empty)
            await rm(directoryPath, { recursive: true, force: true }) 
            console.log(`Directory deleted: ${directoryPath}`)
        } else {
            console.log(`Directory is not empty (size: ${size} bytes). Not deleting.`)
        }
    } catch (error) {
        console.error(`Error processing directory ${directoryPath}:`, error.message)
    }
}

export function getPythonEnvironment(medCondaEnv = "med_conda_env") {
  // Returns the python environment
  let pythonEnvironment = process.env.MED_ENV

  // Retrieve the path to the conda environment from the settings file
  let userDataPath = app.getPath("userData")
  let settingsFilePath = path.join(userDataPath, "settings.json")
  let settingsFound = fs.existsSync(settingsFilePath)
  let settings = {}
  if (settingsFound) {
    let settings = JSON.parse(fs.readFileSync(settingsFilePath, "utf8"))
    // Check if the conda environment is defined in the settings file
    if (settings.condaPath !== undefined) {
      pythonEnvironment = settings.condaPath
    }
  }

  if (pythonEnvironment === undefined) {
    if (pythonEnvironment === undefined || pythonEnvironment === null) {
      let userPath = process.env.HOME
      let anacondaPath = getCondaPath(userPath)
      if (anacondaPath !== null) {
        // If a python environment is found, the path to the python executable is returned
        if (checkCondaEnvs(anacondaPath).includes(medCondaEnv)) {
          pythonEnvironment = getThePythonExecutablePath(anacondaPath, medCondaEnv)
        }
      }
    }
  }
  // If the python environment is found, the conda path is saved in the settings file if it is not already defined
  if (pythonEnvironment) {
    if (settingsFound && (settings.condaPath === undefined || settings.condaPath !== pythonEnvironment)) {
      settings.condaPath = pythonEnvironment
      fs.writeFileSync(settingsFilePath, JSON.stringify(settings))
    }
  }
  return pythonEnvironment
}

/**
 * @description Returns the path to the conda directory
 * @param {String} parentPath The path to the parent directory
 * @returns {String} The path to the conda directory
 */
function getCondaPath(parentPath) {
  let condaPath = null
  const possibleCondaPaths = ["anaconda3", "miniconda3", "anaconda", "miniconda", "Anaconda3", "Miniconda3", "Anaconda", "Miniconda"]
  condaPath = checkDirectories(parentPath, possibleCondaPaths)
  if (condaPath === null) {
    if (process.platform !== "win32") {
      let condaPathTemp = path.join(parentPath, "opt")
      condaPath = checkDirectories(condaPathTemp, possibleCondaPaths)
      if (condaPath === null) {
        condaPathTemp = path.join(parentPath, "bin")
        condaPath = checkDirectories(condaPathTemp, possibleCondaPaths)
      }
    } else {
      parentPath = "C:\\"
      let condaPathTemp = path.join(parentPath, "ProgramData")
      condaPath = checkDirectories(condaPathTemp, possibleCondaPaths)
      if (condaPath === null) {
        condaPathTemp = path.join(parentPath, "Program Files")
        condaPath = checkDirectories(condaPathTemp, possibleCondaPaths)
        if (condaPath === null) {
          condaPathTemp = path.join(parentPath, "Program Files (x86)")
          condaPath = checkDirectories(condaPathTemp, possibleCondaPaths)
        }
      }
    }
    if (process.platform == "darwin" && condaPath === null) {
      parentPath = "/opt/homebrew"
      condaPath = checkDirectories(parentPath, possibleCondaPaths)
    }
    if (condaPath === null && process.platform !== "darwin") {
      console.log("No conda environment found")
    }
  }
  return condaPath
}

/**
 * Checks if a list of directories exists from a parent directory
 * @param {String} parentPath The path to the parent directory
 * @param {Array} directories The list of directories to check
 * @returns {String} The path to the directory that exists
 */
function checkDirectories(parentPath, directories) {
  let directoryPath = null
  directories.forEach((directory) => {
    if (directoryPath === null) {
      let directoryPathTemp = path.join(parentPath, directory)
      console.log("directoryPathTemp: ", directoryPathTemp)
      if (fs.existsSync(directoryPathTemp)) {
        console.log("directoryPathTemp EXISTS: ", directoryPathTemp)
        directoryPath = directoryPathTemp
      }
    }
  })
  return directoryPath
}

/**
 * @description Returns the condas environments
 * @param {String} condaPath The path to the conda environment
 * @returns {Array} The condas environments
 */
function checkCondaEnvs(condaPath) {
  let envsPath = path.join(condaPath, "envs")
  let envs = []
  if (fs.existsSync(envsPath)) {
    envs = fs.readdirSync(envsPath)
  }
  return envs
}

/**
 * @description Returns the path to the python executable
 * @param {String} condaPath The path to the conda environment
 * @param {String} envName The name of the conda environment
 * @returns {String} The path to the python executable
 */
function getThePythonExecutablePath(condaPath, envName) {
  // Returns the path to the python executable
  let pythonExecutablePath = null
  if (process.platform == "win32") {
    pythonExecutablePath = path.join(condaPath, "envs", envName, "python.exe")
  } else {
    pythonExecutablePath = path.join(condaPath, "envs", envName, "bin", "python")
  }
  return pythonExecutablePath
}

export function getBundledPythonEnvironment() {
  let pythonEnvironment = null

  let bundledPythonPath = null

  if (process.env.NODE_ENV === "production") {
    // Get the user path followed by .medomics
    let userPath = getHomePath()
    let medomicsPath = path.join(userPath, ".medomics")

    // Check if the .medomics directory exists
    if (fs.existsSync(medomicsPath)) {
      // Check if the python directory exists
      let pythonPath = path.join(medomicsPath, "python")
      if (fs.existsSync(pythonPath)) {
        bundledPythonPath = pythonPath
      }
    } else {
      // Create the .medomics directory
      fs.mkdirSync(medomicsPath)
    }

    bundledPythonPath = path.join(userPath, ".medomics", "python")
  } else {
    // Check if the python path can be found in the .medomics directory
    let medomicsDirExists = fs.existsSync(path.join(app.getPath("home"), ".medomics", "python"))
    if (medomicsDirExists) {
      bundledPythonPath = path.join(getHomePath(), ".medomics", "python")
    } else {
      bundledPythonPath = path.join(process.cwd(), "python")
    }
  }

  // Check if the python folder is empty, if yes, delete it
  checkSizeAndDeleteIfZero(bundledPythonPath)

  pythonEnvironment = path.join(bundledPythonPath, "bin", "python")
  if (process.platform == "win32") {
    pythonEnvironment = path.join(bundledPythonPath, "python.exe")
  }
  if (!fs.existsSync(pythonEnvironment)) {
    pythonEnvironment = null
  }
  return pythonEnvironment
}

export async function installRequiredPythonPackages(mainWindow) {
  let requirementsFileName = "requirements.txt"
  if (process.env.NODE_ENV === "production") {
    installPythonPackage(mainWindow, pythonExecutablePath, null, path.join(process.cwd(), "resources", "pythonEnv", requirementsFileName))
  } else {
    installPythonPackage(mainWindow, pythonExecutablePath, null, path.join(process.cwd(), "pythonEnv", requirementsFileName))
  }
}

function comparePythonInstalledPackages(pythonPackages, requirements) {
  let missingPackages = []
  for (let i = 0; i < requirements.length; i++) {
    let requirement = requirements[i]
    let requirementParts = requirement.split("==")
    let requirementName = requirementParts[0]
    let requirementVersion = requirementParts[1]
    let found = false
    for (let j = 0; j < pythonPackages.length; j++) {
      let pythonPackage = pythonPackages[j]
      if (pythonPackage.name === requirementName && pythonPackage.version === requirementVersion) {
        found = true
        break
      } else if (pythonPackage.name.replace('-', '_') === requirementName && pythonPackage.version === requirementVersion) {
        found = true
        break
      } else if (pythonPackage.name.replace('_', '-') === requirementName && pythonPackage.version === requirementVersion) {
        found = true
        break
      }
    }
    if (!found) {
      missingPackages.push({ name: requirementName, version: requirementVersion })
    }
  }
  console.log("Missing packages: " + JSON.stringify(missingPackages))
  return missingPackages
}

export function checkPythonRequirements(pythonPath = null, requirementsFilePath = null) {
  let pythonRequirementsMet = false
  if (pythonPath === null) {
    // pythonPath = getPythonEnvironment()
    pythonPath = getBundledPythonEnvironment()
  }
  if (requirementsFilePath === null) {
    if (process.env.NODE_ENV === "production") {
      requirementsFilePath = path.join(process.resourcesPath, "pythonEnv", "requirements.txt")
    } else {
      requirementsFilePath = path.join(process.cwd(), "pythonEnv", "requirements.txt")
    }
  }
  let pythonPackages = getInstalledPythonPackages(pythonPath)
  let requirements = fs.readFileSync(requirementsFilePath, "utf8").split("\n")
  // # Remove empty lines and \r
  requirements = requirements.filter((line) => line.trim() !== "")
  requirements = requirements.map((line) => line.replace("\r", ""))

  let missingPackages = comparePythonInstalledPackages(pythonPackages, requirements)
  if (missingPackages.length === 0) {
    pythonRequirementsMet = true
  }
  return pythonRequirementsMet
}

export function getInstalledPythonPackages(pythonPath = null) {
  let pythonPackages = []
  if (pythonPath === null) {
    pythonPath = getPythonEnvironment()
  }

  let pythonPackagesOutput = ""
  try {
    pythonPackagesOutput = execSync(`${pythonPath} -m pip list --format=json`).toString()
  } catch (error) {
    console.warn("Error retrieving python packages:", error)
  }
  try {
    pythonPackages = JSON.parse(pythonPackagesOutput)
  } catch (error) {
    console.warn(error)
  }
  return pythonPackages
}

export async function installPythonPackage(mainWindow, pythonPath, packageName = null, requirementsFilePath = null) {
  console.log("Installing python package: ", packageName, requirementsFilePath, " with pythonPath: ", pythonPath)
  let execSyncResult = null
  let pipUpgradePromise = exec(`${pythonPath} -m pip install --upgrade pip`)
  execCallbacksForChildWithNotifications(pipUpgradePromise.child, "Python pip Upgrade", mainWindow)
  await pipUpgradePromise
  if (requirementsFilePath !== null) {
    let installPythonPackagePromise = exec(`${pythonPath} -m pip install -r ${requirementsFilePath}`)
    execCallbacksForChildWithNotifications(installPythonPackagePromise.child, "Python Package Installation from requirements", mainWindow)
    await installPythonPackagePromise
  } else {
    let installPythonPackagePromise = exec(`${pythonPath} -m pip install ${packageName}`)
    execCallbacksForChildWithNotifications(installPythonPackagePromise.child, "Python Package Installation", mainWindow)
    await installPythonPackagePromise
  }
}

export function execCallbacksForChildWithNotifications(child, id, mainWindow) {
  mainWindow.webContents.send("notification", { id: id, message: `Starting...`, header: `${id} in progress` })
  child.stdout.on("data", (data) => {
    mainWindow.webContents.send("notification", { id: id, message: `stdout: ${data}`, header: `${id} in progress` })
  })
  child.stderr.on("data", (data) => {
    mainWindow.webContents.send("notification", { id: id, message: `stderr: ${data}`, header: `${id} Error` })
  })
  child.on("close", (code) => {
    mainWindow.webContents.send("notification", { id: id, message: `${id} exited with code ${code}`, header: `${id} Finished` })
  })
}

function getHomePath() {
  let homePath = null
  if (process.platform === "win32") {
    homePath = process.env.USERPROFILE
  } else {
    homePath = process.env.HOME
  }
  return homePath
}

export async function installBundledPythonExecutable(mainWindow) {
  let bundledPythonPath = null

  let medomicsPath = null
  let pythonParentFolderExtractString = ""
  if (process.env.NODE_ENV === "production") {
    console.log("getHomePath(): ", getHomePath())
    let userPath = getHomePath()

    medomicsPath = path.join(userPath, ".medomics")
    pythonParentFolderExtractString = medomicsPath
    let pythonPath = path.join(medomicsPath, "python")
    // Check if the .medomics directory exists
    if (fs.existsSync(medomicsPath)) {
      // Check if the python directory exists
      if (fs.existsSync(pythonPath)) {
        bundledPythonPath = pythonPath
      } else {
        fs.mkdirSync(pythonPath)
      }
    } else {
      // Create the .medomics directory
      fs.mkdirSync(medomicsPath)
      fs.mkdirSync(pythonPath)
    }
    bundledPythonPath = pythonPath
  } else {
    // Check if the python path can be found in the .medomics directory
    let medomicsDirExists = fs.existsSync(path.join(app.getPath("home"), ".medomics", "python"))
    if (medomicsDirExists) {
      bundledPythonPath = path.join(getHomePath(), ".medomics", "python")
    } else {
      bundledPythonPath = path.join(process.cwd(), "python")
    }
    pythonParentFolderExtractString = bundledPythonPath.split("python")[0]
  }
  // Check if the python executable is already installed
  let pythonExecutablePath = null
  if (process.platform == "win32") {
    pythonExecutablePath = path.join(bundledPythonPath, "python.exe")
  } else {
    pythonExecutablePath = path.join(bundledPythonPath, "bin", "python")
  }
  if (!fs.existsSync(pythonExecutablePath)) {
    // If the python executable is not installed, download the python executable
    if (process.platform == "win32") {
      // Download the python executable
      let outputFileName = pythonBuildFile("x86_64-pc-windows-msvc")
      let url = `${PYTHON_BUILD_BASE}/${outputFileName}`

      let downloadPromise = exec(`wget ${url} -O ${outputFileName}`, { shell: "powershell.exe" })

      execCallbacksForChildWithNotifications(downloadPromise.child, "Python Downloading", mainWindow)

      const { stdout, stderr } = await downloadPromise
      let extractCommand = `tar -xvf ${outputFileName} -C ${pythonParentFolderExtractString}`
      let extractionPromise = exec(extractCommand, { shell: "powershell.exe" })
      execCallbacksForChildWithNotifications(extractionPromise.child, "Python Exec. Extracting", mainWindow)

      const { stdout: extrac, stderr: extracErr } = await extractionPromise

      // Install the required python packages
      if (process.env.NODE_ENV === "production") {
        installPythonPackage(mainWindow, pythonExecutablePath, null, path.join(process.cwd(), "resources", "pythonEnv", "requirements.txt"))
      } else {
        installPythonPackage(mainWindow, pythonExecutablePath, null, path.join(process.cwd(), "pythonEnv", "requirements.txt"))
      }
      let removeCommand = `rm ${outputFileName}`
      let removePromise = exec(removeCommand, { shell: "powershell.exe" })
      execCallbacksForChildWithNotifications(removePromise.child, "Python Exec. Removing", mainWindow)
      const { stdout: remove, stderr: removeErr } = await removePromise
    } else if (process.platform == "darwin") {
      // Download the right python executable (arm64 or x86_64)
      // isArm64 is a boolean; the old code compared it to the string "arm64",
      // which is never true, so Apple Silicon machines silently got the x86_64
      // build and ran python under Rosetta.
      let isArm64 = process.arch === "arm64"
      let file = pythonBuildFile(isArm64 ? "aarch64-apple-darwin" : "x86_64-apple-darwin")

      let url = `${PYTHON_BUILD_BASE}/${file}`
      let extractCommand = `tar -xvf ${file} -C ${pythonParentFolderExtractString}`
      let downloadPromise = exec(`/bin/bash -c "$(curl -fsSLO ${url})"`)
      execCallbacksForChildWithNotifications(downloadPromise.child, "Python Downloading", mainWindow)
      const { stdout, stderr } = await downloadPromise

      // Extract the python executable
      let extractionPromise = exec(extractCommand)
      execCallbacksForChildWithNotifications(extractionPromise.child, "Python Exec. Extracting", mainWindow)
      const { stdout: extrac, stderr: extracErr } = await extractionPromise

      // Remove the downloaded file
      let removeCommand = `rm ${file}`
      let removePromise = exec(removeCommand)
      execCallbacksForChildWithNotifications(removePromise.child, "Python Exec. Removing", mainWindow)
      const { stdout: remove, stderr: removeErr } = await removePromise

      // Install the required python packages
      // requirements_mac.txt does not exist in this repo; every platform now
      // installs the same requirements.txt.
      if (process.env.NODE_ENV === "production") {
        installPythonPackage(mainWindow, pythonExecutablePath, null, path.join(process.resourcesPath, "pythonEnv", "requirements.txt"))
      } else {
        installPythonPackage(mainWindow, pythonExecutablePath, null, path.join(process.cwd(), "pythonEnv", "requirements.txt"))
      }
    } else if (process.platform == "linux") {
      // Download the right python executable (arm64 or x86_64).
      // The baseline x86_64 build is used rather than the x86_64_v3 variant the
      // old code picked: v3 requires AVX2, so it faults on older CPUs.
      let file = pythonBuildFile(process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu")

      let url = `${PYTHON_BUILD_BASE}/${file}`

      // Download the python executable
      let downloadPromise = exec(`wget ${url} -P ${pythonParentFolderExtractString}`)
      execCallbacksForChildWithNotifications(downloadPromise.child, "Python Downloading", mainWindow)
      const { stdout: download, stderr: downlaodErr } = await downloadPromise
      // Extract the python executable
      let extractCommand = `tar -xvf ${path.join(pythonParentFolderExtractString, file)} -C ${pythonParentFolderExtractString}`
      let extractionPromise = exec(extractCommand)
      execCallbacksForChildWithNotifications(extractionPromise.child, "Python Exec. Extracting", mainWindow)
      const { stdout: extrac, stderr: extracErr } = await extractionPromise

      // Remove the downloaded file
      let removeCommand = `rm ${path.join(pythonParentFolderExtractString, file)}`
      let removePromise = exec(removeCommand)
      execCallbacksForChildWithNotifications(removePromise.child, "Python Exec. Removing", mainWindow)
      const { stdout: remove, stderr: removeErr } = await removePromise

      console.log("pythonExecutablePath: ", pythonExecutablePath)
      console.log("process.cwd(): ", process)
      console.log("process.resourcesPath: ", process.resourcesPath)
      // Install the required python packages
      if (process.env.NODE_ENV === "production") {
        installPythonPackage(mainWindow, pythonExecutablePath, null, path.join(process.resourcesPath, "pythonEnv", "requirements.txt"))
      } else {
        installPythonPackage(mainWindow, pythonExecutablePath, null, path.join(process.cwd(), "pythonEnv", "requirements.txt"))
      }
    }
  }
}
