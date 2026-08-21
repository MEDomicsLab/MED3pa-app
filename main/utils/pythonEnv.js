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
 * @description The python-build-standalone target triple for the running machine.
 * @returns {String} the triple to download
 */
function pythonBuildTriple() {
  const isArm64 = process.arch === "arm64"
  if (process.platform === "win32") {
    // Windows on ARM runs the x86_64 build under emulation; there is no
    // guarantee an aarch64 asset exists for every release tag.
    return "x86_64-pc-windows-msvc"
  }
  if (process.platform === "darwin") {
    return isArm64 ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
  }
  // The baseline x86_64 build is used rather than the x86_64_v3 variant:
  // v3 requires AVX2, so it faults on older CPUs.
  return isArm64 ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"
}

// pip installing torch/ray prints far more than exec's 1 MB default buffer, and
// blowing the buffer kills the child mid-install.
const EXEC_OPTIONS = { maxBuffer: 256 * 1024 * 1024 }

// Set while installBundledPythonExecutable() is running so the "empty python
// folder" cleanup below cannot delete the directory tar is extracting into.
let installInProgress = false

/**
 * @description Wraps a path/URL for the shell. Home directories and the app
 * bundle path can both contain spaces.
 * @param {String} value
 * @returns {String} the quoted value
 */
function shellQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`
}

/**
 * @description Sends a single notification to the setup modal, if it is still open.
 */
function sendNotification(mainWindow, id, message, header) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("notification", { id: id, message: message, header: header })
  }
}

/**
 * @description Runs one setup command, streams its output to the setup modal and
 * throws if it exits non-zero.
 *
 * Every step used to be fire-and-forget: a failing download reported "exited
 * with code 0" and the next step then failed on a file that was never there.
 * @param {BrowserWindow} mainWindow
 * @param {String} id the notification id shown in the setup modal
 * @param {String} command the command to run
 */
async function runSetupStep(mainWindow, id, command, options = {}) {
  console.log(`${id}: ${command}`)
  const execution = exec(command, { ...EXEC_OPTIONS, ...options })
  execCallbacksForChildWithNotifications(execution.child, id, mainWindow)
  try {
    return await execution
  } catch (error) {
    const details = (error.stderr || error.message || "").toString().trim()
    throw new Error(`${id} failed (exit code ${error.code}): ${details}`)
  }
}

/**
 * @description Resolves where the bundled python lives for the current run.
 * @returns {{medomicsPath: String, bundledPythonPath: String, pythonExecutablePath: String}}
 */
function resolveBundledPythonPaths() {
  let medomicsPath = path.join(getHomePath(), ".medomics")
  let bundledPythonPath = path.join(medomicsPath, "python")

  if (process.env.NODE_ENV !== "production" && !fs.existsSync(bundledPythonPath)) {
    // In dev, fall back to a ./python folder next to the sources.
    bundledPythonPath = path.join(process.cwd(), "python")
    medomicsPath = process.cwd()
  }

  let pythonExecutablePath = path.join(bundledPythonPath, "bin", "python")
  if (process.platform === "win32") {
    pythonExecutablePath = path.join(bundledPythonPath, "python.exe")
  }
  return { medomicsPath, bundledPythonPath, pythonExecutablePath }
}

/**
 * @description Absolute path of the requirements file the packaged app installs from.
 * @returns {String} the path to requirements.txt
 */
function getRequirementsFilePath() {
  if (process.env.NODE_ENV === "production") {
    // process.resourcesPath, not process.cwd(): a packaged app launched from
    // Finder/Explorer has no meaningful working directory (on macOS it is "/").
    return path.join(process.resourcesPath, "pythonEnv", "requirements.txt")
  }
  return path.join(process.cwd(), "pythonEnv", "requirements.txt")
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
        // An install in flight has just created the folder tar is about to fill;
        // deleting it from under the extraction is how partial installs happen.
        if (installInProgress || !fs.existsSync(directoryPath)) {
            return
        }
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
  const { medomicsPath, bundledPythonPath, pythonExecutablePath } = resolveBundledPythonPaths()

  if (!fs.existsSync(medomicsPath)) {
    fs.mkdirSync(medomicsPath, { recursive: true })
  }

  // Check if the python folder is empty, if yes, delete it
  checkSizeAndDeleteIfZero(bundledPythonPath)

  return fs.existsSync(pythonExecutablePath) ? pythonExecutablePath : null
}

export async function installRequiredPythonPackages(mainWindow, pythonPath = null) {
  if (pythonPath === null) {
    // The old code referenced an undefined `pythonExecutablePath` here, so this
    // whole path threw a ReferenceError whenever python was installed but its
    // packages were not.
    pythonPath = resolveBundledPythonPaths().pythonExecutablePath
  }
  if (!fs.existsSync(pythonPath)) {
    throw new Error(`Cannot install the python packages: no python interpreter at ${pythonPath}`)
  }
  await installPythonPackage(mainWindow, pythonPath, null, getRequirementsFilePath())
}

/**
 * @description Normalises a distribution name the way PEP 503 does, so that
 * scikit_learn / scikit-learn / Scikit-Learn all compare equal.
 * @param {String} name
 * @returns {String} the normalised name
 */
function normalizePackageName(name) {
  return name.trim().toLowerCase().replace(/[-_.]+/g, "-")
}

/**
 * @description Parses a requirements file into {name, version} pins.
 *
 * Comments have to be stripped: the old parser fed whole comment lines and
 * trailing `# ...` notes straight into the version comparison, so every comment
 * counted as a missing package and checkPythonRequirements() could never return
 * true — the setup modal spun forever on a perfectly good install.
 * @param {String} requirementsFilePath
 * @returns {Array<{name: String, version: String}>} the parsed pins
 */
function parseRequirements(requirementsFilePath) {
  return fs
    .readFileSync(requirementsFilePath, "utf8")
    .split("\n")
    .map((line) => line.replace("\r", "").split("#")[0].trim())
    .filter((line) => line !== "")
    .map((line) => {
      const [name, version] = line.split("==")
      return { name: name.trim(), version: version === undefined ? undefined : version.trim() }
    })
}

function comparePythonInstalledPackages(pythonPackages, requirements) {
  const installed = new Map(pythonPackages.map((pythonPackage) => [normalizePackageName(pythonPackage.name), pythonPackage.version]))

  let missingPackages = []
  for (const requirement of requirements) {
    // An unpinned requirement only has to be present, at any version.
    const installedVersion = installed.get(normalizePackageName(requirement.name))
    const found = installedVersion !== undefined && (requirement.version === undefined || installedVersion === requirement.version)
    if (!found) {
      missingPackages.push(requirement)
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
    requirementsFilePath = getRequirementsFilePath()
  }
  if (pythonPath === null || !fs.existsSync(requirementsFilePath)) {
    return false
  }
  let pythonPackages = getInstalledPythonPackages(pythonPath)
  if (pythonPackages.length === 0) {
    // pip could not be queried at all: treat that as "not ready" rather than
    // "nothing is missing".
    return false
  }
  let requirements = parseRequirements(requirementsFilePath)

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
    pythonPackagesOutput = execSync(`${shellQuote(pythonPath)} -m pip list --format=json`, EXEC_OPTIONS).toString()
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
  // --no-input keeps pip from blocking forever on a prompt no one can answer,
  // since the child has no terminal attached.
  const pip = `${shellQuote(pythonPath)} -m pip --no-input --disable-pip-version-check`

  await runSetupStep(mainWindow, "Python pip Upgrade", `${pip} install --upgrade pip`)

  if (requirementsFilePath !== null) {
    await runSetupStep(mainWindow, "Python Package Installation from requirements", `${pip} install -r ${shellQuote(requirementsFilePath)}`)
  } else {
    await runSetupStep(mainWindow, "Python Package Installation", `${pip} install ${packageName}`)
  }
}

export function execCallbacksForChildWithNotifications(child, id, mainWindow) {
  sendNotification(mainWindow, id, `Starting...`, `${id} in progress`)
  child.stdout.on("data", (data) => {
    sendNotification(mainWindow, id, `stdout: ${data}`, `${id} in progress`)
  })
  child.stderr.on("data", (data) => {
    sendNotification(mainWindow, id, `stderr: ${data}`, `${id} Error`)
  })
  child.on("close", (code) => {
    sendNotification(mainWindow, id, `${id} exited with code ${code}`, `${id} Finished`)
  })
}

function getHomePath() {
  let homePath = process.platform === "win32" ? process.env.USERPROFILE : process.env.HOME
  if (!homePath) {
    homePath = app.getPath("home")
  }
  return homePath
}


/**
 * @description Downloads and installs the bundled CPython, then installs the
 * required packages into it.
 *
 * Everything runs against absolute paths. The previous version relied on the
 * process working directory (`curl -O`, `tar -xvf <relative file>`), which is
 * meaningless for a packaged app: on macOS a bundle launched from Finder starts
 * with cwd "/", so curl could not write the archive and tar then had nothing to
 * extract.
 * @param {BrowserWindow} mainWindow The window that shows the setup progress
 * @returns {Promise<Boolean>} true when python and its packages are ready
 */
export async function installBundledPythonExecutable(mainWindow) {
  const { medomicsPath, bundledPythonPath, pythonExecutablePath } = resolveBundledPythonPaths()

  if (fs.existsSync(pythonExecutablePath)) {
    // The interpreter is already there; only the packages may be missing.
    // This runs before the try block below, so a throw here used to escape the
    // function entirely: no notification reached the setup modal and nothing was
    // logged, leaving an interpreter with no packages and no explanation. Any
    // second launch takes this path, so that is the common case, not the rare one.
    try {
      await installRequiredPythonPackages(mainWindow, pythonExecutablePath)
      return true
    } catch (error) {
      console.error("Installing the python packages failed: ", error)
      sendNotification(mainWindow, "Python Installation", error.message, "Python Installation Error")
      return false
    }
  }

  const requirementsFilePath = getRequirementsFilePath()
  if (!fs.existsSync(requirementsFilePath)) {
    const message = `Cannot find the requirements file at ${requirementsFilePath}`
    console.error(message)
    sendNotification(mainWindow, "Python Installation", message, "Python Installation Error")
    return false
  }

  const archiveFileName = pythonBuildFile(pythonBuildTriple())
  const archivePath = path.join(medomicsPath, archiveFileName)
  const url = `${PYTHON_BUILD_BASE}/${archiveFileName}`

  installInProgress = true
  try {
    fs.mkdirSync(medomicsPath, { recursive: true })

    // A previous failed attempt can leave a truncated archive behind, and curl
    // would happily extend it into something tar cannot read.
    if (fs.existsSync(archivePath)) {
      fs.rmSync(archivePath, { force: true })
    }

    // curl ships with macOS, with Windows 10 1803+ and is a declared dependency
    // of the .deb, so it is the one downloader available on all three platforms.
    // -f makes HTTP errors non-zero exits instead of a saved error page.
    await runSetupStep(mainWindow, "Python Downloading", `curl -fsSL --retry 3 --retry-delay 2 -o ${shellQuote(archivePath)} ${shellQuote(url)}`)

    if (!fs.existsSync(archivePath)) {
      throw new Error(`The download reported success but ${archivePath} is missing`)
    }

    // The archive holds a single top-level "python/" directory, so extracting
    // into .medomics is what produces .medomics/python.
    await runSetupStep(mainWindow, "Python Exec. Extracting", `tar -xzf ${shellQuote(archivePath)} -C ${shellQuote(medomicsPath)}`)

    if (!fs.existsSync(pythonExecutablePath)) {
      throw new Error(`Extraction finished but no python interpreter was found at ${pythonExecutablePath}`)
    }

    fs.rmSync(archivePath, { force: true })
    sendNotification(mainWindow, "Python Exec. Removing", "Python Exec. Removing exited with code 0", "Python Exec. Removing Finished")

    await installRequiredPythonPackages(mainWindow, pythonExecutablePath)
    console.log("Bundled python installed at: ", pythonExecutablePath)
    return true
  } catch (error) {
    console.error("Bundled python installation failed: ", error)
    sendNotification(mainWindow, "Python Installation", error.message, "Python Installation Error")
    // Leave nothing half-installed: a partial tree would make the next launch
    // believe python is present.
    try {
      fs.rmSync(archivePath, { force: true })
      if (!fs.existsSync(pythonExecutablePath) && fs.existsSync(bundledPythonPath)) {
        fs.rmSync(bundledPythonPath, { recursive: true, force: true })
      }
    } catch (cleanupError) {
      console.warn("Could not clean up after the failed python installation: ", cleanupError)
    }
    return false
  } finally {
    installInProgress = false
  }
}
